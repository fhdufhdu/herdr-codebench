// Mod-owned source editing. CodeView remains the single source renderer; the
// native input is only an OS/IME commit boundary, never a second document.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { readTextFile, writeTextFile, watchFolder, theme, shared, setShared, run, keys } from "herdr";
import CodeView from "./code.js";
import { EditorBuffer } from "./editor-buffer.js";
import { EditorInput } from "./editor-input.js";
import { EditorCommands } from "./editor-commands.js";
import { actionShortcut } from "./actions.js";
import { lsp, peek } from "./lsp.js";
import { navigationMarkers, documentIdentity, definitionGesture } from "./editor-model.js";
import { editorKey, editorSpec, setEditorSpec, displayWidth, wordAt, codeFont, iconButton } from "./common.js";
import { IDEA, ideaUI, uiColors, uiButton } from "./idea-design.js";

const sessionId = () => `editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const semantic = new Set(["hover", "symbols", "definition", "references", "diagnostics", "workspace_symbols", "related"]);

export default class EditableCode extends CodeView {
  init(p, cx) {
    this.documents = new Map(); this.workspaces = new Map(); this.closingDocuments = new Map();
    this.probe = p?.editorProbe ? { kind: "file", path: p.path, root: p.root, line: 1 } : null;
    this.lspEnabled = !p?.disableLsp;
    super.init(p, cx);
    this.input = new EditorInput();
    this.input.init(cx, { onCommit: (text, cx) => this.commit(text, cx), onCommand: (command, cx) => this.inputCommand(command, cx) });
    this.commandKeys = new EditorCommands();
    this.commandKeys.init(cx, { pending: () => this.input.pending(), onCommand: (command, _event, eventCx) => this.command(command === "preview" ? "rich-view" : "save", eventCx) });
  }
  render(cx) { return this.commandKeys.render(super.render(cx), cx); }
  get lineLimit() { return Infinity; }
  get buffer() { return this.document?.buffer; }
  get dirty() { return Boolean(this.document && this.buffer.text !== this.document.original); }
  identity(spec = this.shown, space = this.documentSpace) { return documentIdentity(spec, space); }
  documentKey(spec) { return JSON.stringify([spec?.on ?? null, spec?.path]); }
  activeSpec() { return this.probe ?? editorSpec(); }
  activeSpace() { return this.probe ? "editor-probe" : editorKey(); }
  requestContext() { return { identity: this.identity(), space: this.documentSpace, seq: this.seq, revision: this.buffer?.revision }; }
  currentRequest(r) {
    return !this.released && r.seq === this.seq && r.space === this.activeSpace()
      && r.identity === this.identity() && (r.revision === undefined || r.revision === this.buffer?.revision);
  }
  sync(cx) {
    const spec = this.activeSpec(), space = this.activeSpace();
    const key = JSON.stringify([space, spec]);
    if (key === this.loadedKey) return;
    const workspaceChanged = this.documentSpace !== space;
    // A workspace can retain its dirty document. Within a workspace, make the
    // save/discard decision before replacing it or changing the editor child.
    if (!workspaceChanged && this.document && (this.dirty || this.document.saving) && this.identity(spec, space) !== this.identity()) {
      this.pending = spec; this.hasPending = true; return;
    }
    if (this.document) this.document.scroll = { top: this.scroll.top, left: this.scroll.left };
    const retained = workspaceChanged && this.workspaces.get(space);
    const wanted = retained && (retained.buffer.text !== retained.original || retained.saving) ? retained.spec : spec;
    if (this.document && !this.dirty && !this.document.saving && this.documentKey(wanted) !== this.documentKey(this.shown)) this.retireDocument(this.document);
    if (!wanted || wanted.kind !== "file") {
      this.shown = null; this.document = null; this.documentSpace = space; this.loadedKey = key;
      this.seq = (this.seq ?? 0) + 1; this.lines = []; this.sel = null; this.loading = false; return;
    }
    const same = this.identity(wanted, space) === this.identity();
    this.loadedKey = key; this.documentSpace = space; this.shown = wanted;
    this.hasPending = wanted !== spec; this.pending = this.hasPending ? spec : null;
    if (same && this.buffer) { this.reveal(wanted.line, wanted.col); return; }
    this.document = this.documents.get(this.documentKey(wanted)) ?? null;
    cx.timer.after(0, cx => { if (!this.released && this.loadedKey === key) this.load(wanted, cx); });
  }
  async readDocument(spec) {
    const id = this.documentKey(spec);
    await this.closingDocuments.get(id);
    let doc = this.documents.get(id);
    if (!doc) {
      const text = await readTextFile(spec.path, { on: spec.on });
      if (text === null || text.includes("\0")) return text;
      doc = { spec, buffer: new EditorBuffer(text, { readOnly: Boolean(spec.on) }), original: text,
        owner: sessionId(), saving: false, scroll: { top: 0, left: 0 } };
      this.documents.set(id, doc);
    }
    return doc.buffer.text;
  }
  didLoadDocument(spec, cx) {
    this.document = this.documents.get(this.documentKey(spec));
    if (!this.document) return;
    this.workspaces.set(this.documentSpace, this.document);
    this.document.spec = spec;
    this.width = Math.max(40, ...this.lines.slice(0, 20000).map(line => displayWidth(line)));
    this.scroll.setTop(this.document.scroll.top); this.scroll.left = this.document.scroll.left;
    if (spec.line) this.buffer.select(this.buffer.offset(Math.min(this.buffer.lineCount - 1, Math.max(0, spec.line - 1)), spec.col ?? 0));
    this.selectionFromBuffer(); this.publishState();
    cx.timer.after(0, () => { if (!this.released && this.document?.spec === spec) this.input.focus(); });
  }
  retireDocument(doc) {
    const key = this.documentKey(doc.spec);
    if (this.documents.get(key) === doc) this.documents.delete(key);
    for (const [space, value] of this.workspaces) if (value === doc) this.workspaces.delete(space);
    if (this.lspEnabled && doc.leaseRevision !== undefined) {
      const closing = peek("document_close", { path: doc.spec.path, document_owner: doc.owner, revision: doc.leaseRevision });
      this.closingDocuments.set(key, closing);
      closing.finally(() => { if (this.closingDocuments.get(key) === closing) this.closingDocuments.delete(key); });
    }
  }
  selectionFromBuffer() {
    if (!this.buffer) return;
    const a = this.buffer.position(this.buffer.anchor), b = this.buffer.position(this.buffer.head);
    this.selection = this.buffer.from === this.buffer.to ? null : { a, b };
    const word = wordAt(this.lines[b.line] ?? "", b.col);
    this.sel = { ...b, ...(word ?? { start: b.col, end: b.col, word: null }) };
    this.flash = null;
  }
  changed(cx, previousRevision) {
    const doc = this.document;
    if (!doc) return;
    const edited = this.buffer.revision !== previousRevision;
    if (edited) {
      this.seq = (this.seq ?? 0) + 1;
      this.text = this.buffer.text; this.lines = this.text.split("\n"); this.toks = null; this.diags = []; this.symbols = [];
      this.navigation = navigationMarkers(this.lines, this.shown.path); this.hover = null;
      this.width = Math.max(40, ...this.lines.slice(0, 20000).map(line => displayWidth(line)));
      this.publishState(); this.analyze(cx);
    }
    this.selectionFromBuffer(); this.items(); this.scrollTo(this.sel.line);
    // Keep the owned caret visible horizontally, using the same measured font
    // and tab expansion as row rendering and pointer hit testing.
    const x = displayWidth(this.lines[this.sel.line].slice(0, this.sel.col)) * this.cw + this.textOrigin();
    const available = Math.max(40, (this.scroll.viewW ?? 600) - this.textOrigin() - 30);
    if (x - this.scroll.left > this.textOrigin() + available) this.scroll.left = x - this.textOrigin() - available;
    else if (x - this.scroll.left < this.textOrigin()) this.scroll.left = Math.max(0, x - this.textOrigin());
    cx.notify();
  }
  commit(text, cx) {
    if (!this.buffer || this.buffer.readOnly || this.richView()) return false;
    const before = this.buffer.revision, now = Date.now();
    // Paste, line breaks, cursor movement and a pause split undo groups.
    const typing = !/[\r\n]/.test(text) && text.length <= 4;
    if (!typing || now - (this.typedAt ?? 0) > 750) this.typingGroup = sessionId();
    this.buffer.replace(text, { group: typing ? this.typingGroup : undefined }); this.typedAt = now;
    this.changed(cx, before); return true;
  }
  inputCommand(command, cx) {
    const b = this.buffer;
    if (!b) return;
    const before = b.revision;
    this.typedAt = 0;
    let direction = command.replace(/^(move|select)-/, "");
    const extend = command.startsWith("select-");
    if (command === "select-all") b.select(0, b.length);
    else if (/^(move|select)-/.test(command)) {
      if (direction.startsWith("word-")) { direction = direction.slice(5); b.move(direction, { extend, word: true }); }
      else if (direction === "pageup" || direction === "pagedown") {
        const count = Math.max(1, Math.floor((this.scroll.viewH ?? 400) / codeFont().row) - 1);
        for (let i = 0; i < count; i++) b.move(direction === "pageup" ? "up" : "down", { extend });
      } else b.move(direction, { extend });
    } else if (command === "word-left" || command === "word-right") b.move(command.slice(5), { word: true });
    else if (command === "delete-backward" || command === "delete-forward") b.erase(command === "delete-backward" ? "left" : "right");
    else if (command === "delete-word-backward" || command === "delete-word-forward") b.erase(command === "delete-word-backward" ? "left" : "right", { word: true });
    else if (command === "enter") b.replace(this.document.original.includes("\r\n") ? "\r\n" : "\n");
    else if (command === "indent" || command === "outdent") this.indent(command === "outdent");
    else if (command === "undo") b.undo();
    else if (command === "redo") b.redo();
    else if (command === "copy" || command === "cut") {
      cx.write_to_clipboard(b.selectedText || b.line(b.position(b.head).line).text);
      if (command === "cut" && b.selectedText) b.replace("");
    } else if (command === "save") { this.save(cx); return; }
    this.changed(cx, before);
  }
  indent(outdent) {
    const b = this.buffer, first = b.position(b.from).line, end = b.position(b.to);
    if (!outdent && first === end.line) { b.replace("  "); return; }
    const last = end.col === 0 && end.line > first ? end.line - 1 : end.line;
    const edits = [];
    for (let i = first; i <= last; i++) {
      const line = b.line(i), prefix = line.text.match(/^(\t| {1,2})/)?.[0];
      if (!outdent) edits.push({ from: line.from, to: line.from, insert: "  " });
      else if (prefix) edits.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    }
    if (edits.length) b.apply(edits);
  }
  inlineCaret(line) {
    if (!this.buffer || this.buffer.readOnly || this.sel?.line !== line || this.richView()) return null;
    const pending = this.input.pendingText();
    const input = this.input.render(null, { id: "owned-editor-input", inline: true, font: codeFont().family,
      size: codeFont().size, width: pending ? Math.max(this.cw, displayWidth(pending) * this.cw + 4) : 2,
      height: codeFont().row, viewportWidth: this.scroll.viewW });
    return { offset: this.sel.col, element: input };
  }
  press(line, e, cx) {
    if (!this.buffer) return;
    if (this.input.pending()) { this.input.focus(); cx.notify(); return; }
    const x = e.local_position?.x ?? 0, mods = e.modifiers ?? {};
    if (x < this.gutter()) { super.press(line, e, cx); this.selectionToBuffer(); this.input.focus(); return; }
    const p = this.pointAt(line, x), offset = this.buffer.offset(line, p.col);
    if (e.click_count >= 3) { this.selectLines(line, line); this.selectionToBuffer(); this.input.focus(); cx.notify(); return; }
    const word = e.click_count === 2 ? wordAt(this.lines[line] ?? "", p.col) : null;
    if (word) this.buffer.select(this.buffer.offset(line, word.start), this.buffer.offset(line, word.end));
    else this.buffer.select(mods.shift ? this.buffer.anchor : offset, offset);
    this.dragging = { a: p, x, mods, moved: false };
    this.selectionFromBuffer(); this.input.focus(); cx.notify();
  }
  selectionToBuffer() {
    if (!this.buffer) return;
    const r = this.selection;
    if (r) this.buffer.select(this.buffer.offset(r.a.line, r.a.col), this.buffer.offset(r.b.line, r.b.col));
    else if (this.sel) this.buffer.select(this.buffer.offset(this.sel.line, this.sel.col));
    this.selectionFromBuffer();
  }
  dragTo(line, e, cx) { super.dragTo(line, e, cx); if (this.dragging?.moved || this.gutterSelection) this.selectionToBuffer(); }
  pointerRelease(line, cx) {
    const d = this.dragging;
    this.dragging = null; this.gutterDrag = null; this.gutterSelection = null;
    if (d && !d.moved) {
      const kind = definitionGesture(d.mods, true);
      if (kind) this.definition(cx, kind);
    }
    if (this.buffer) this.input.focus(); cx.notify();
  }
  pick(line, x, cx) { const p = this.pointAt(line, x); if (this.buffer) { this.buffer.select(this.buffer.offset(line, p.col)); this.selectionFromBuffer(); } return this.sel; }
  reveal(line, col) {
    if (!this.buffer || !line) return;
    const i = Math.min(this.buffer.lineCount - 1, Math.max(0, line - 1));
    this.buffer.select(this.buffer.offset(i, col ?? 0)); this.selectionFromBuffer(); this.items(); this.scrollTo(i, "center");
  }
  findNext(dir) { super.findNext(dir); if (this.buffer && this.sel) { const at = this.buffer.offset(this.sel.line, this.sel.col); this.buffer.select(at, at + (this.findQuery?.length ?? 0)); this.selectionFromBuffer(); } }
  closeInfo() { const current = this.sel; super.closeInfo(); this.sel = current; this.selectionFromBuffer(); }
  edit() { if (this.shown?.on) super.edit(); else this.input.focus(); }
  command(command, cx) {
    if (command === "save") this.save(cx);
    else if (command === "focus") this.richView() ? this.focus.focus() : this.input.focus();
    else if (command === "retry-lsp") { this.lspError = null; if (this.document) this.document.retry = true; this.analyze(cx); }
    else super.command(command, cx);
  }
  async languageRequest(method, args) {
    if (!this.lspEnabled) return method === "tokens" ? null : method === "info" ? { installed: false } : null;
    const doc = this.document;
    if (method === "tokens") return lsp(method, { ...args, text: doc?.buffer.text ?? this.text }, this.sleep);
    if (method === "spring_project" || method === "spring_markers") return lsp(method, { ...args, text: doc?.buffer.text ?? this.text }, this.sleep);
    if (method === "related" && args.kind !== "super") return lsp(method, { ...args, text: doc?.buffer.text ?? this.text }, this.sleep);
    if (!semantic.has(method) || !doc || args.path !== doc.spec.path || doc.spec.on) return lsp(method, args, this.sleep);
    const revision = doc.buffer.revision;
    // Sync is idempotent and validates the current owner/revision on the server.
    doc.leaseRevision = Math.max(doc.leaseRevision ?? -1, revision);
    await lsp("document_sync", { path: args.path, document_owner: doc.owner, revision, text: doc.buffer.text, retry: args.retry || doc.retry }, this.sleep);
    doc.retry = false;
    if (doc.buffer.revision !== revision || doc !== this.document) throw new Error("Document changed during language request");
    const result = await lsp(method, { ...args, document_owner: doc.owner, revision }, this.sleep);
    if (doc.buffer.revision !== revision || result?.document_owner !== doc.owner || result.revision !== revision) throw new Error("Stale language response");
    return result.value;
  }
  analyze(cx) {
    const doc = this.document, revision = this.buffer?.revision;
    cx.timer.after(180, cx => {
      if (doc !== this.document || doc.buffer.revision !== revision || this.released || doc.spec.on) return;
      const context = this.requestContext();
      cx.spawn(async cx => {
        try {
          const tokens = await this.languageRequest("tokens", { path: doc.spec.path });
          if (!this.currentRequest(context)) return;
          this.toks = tokens;
          if (/\.(java|kt|kts)$/.test(doc.spec.path)) {
            const markers = await this.languageRequest("spring_markers", { path: doc.spec.path, root: this.repo ?? doc.spec.root }).catch(() => []);
            if (!this.currentRequest(context)) return;
            this.navigation = [...navigationMarkers(this.lines, doc.spec.path), ...markers];
          }
          this.info = await this.languageRequest("info", { path: doc.spec.path });
          if (!this.currentRequest(context) || !this.info?.installed) return;
          const symbols = await this.languageRequest("symbols", { path: doc.spec.path });
          if (!this.currentRequest(context)) return;
          this.symbols = symbols ?? []; this.lspError = null;
          for (const wait of [200, 1000, 2500]) {
            await cx.sleep(wait); if (!this.currentRequest(context)) return;
            await this.loadDiagnostics(cx);
          }
        } catch (error) { if (this.currentRequest(context)) this.lspError = String(error.message ?? error); }
        finally { if (this.currentRequest(context)) cx.notify(); }
      });
    });
  }
  async loadDiagnostics(cx) {
    const r = this.requestContext();
    if (!this.document || this.shown.on || !this.info?.installed) return;
    try {
      const result = await this.languageRequest("diagnostics", { path: this.shown.path });
      if (!this.currentRequest(r) || !result) return;
      this.diags = result.items ?? []; this.busy = result.busy;
      this.diagnosticConfidence = result.version_confidence; cx.notify();
    } catch { /* Superseded edits never restore old diagnostics. */ }
  }
  watch(spec, cx) {
    if (spec.on || this.probe) return;
    const doc = this.document, key = doc.owner, dir = spec.path.replace(/\/[^/]*$/, "");
    if (this.watched === key) return;
    this.watched = key;
    cx.spawn(async cx => {
      try {
        while (!this.released && this.watched === key) {
          const paths = await watchFolder(dir);
          if (this.watched !== key || this.document !== doc) return;
          if (!paths.includes(spec.path) && !paths.includes(dir)) continue;
          const text = await readTextFile(spec.path).catch(() => null);
          if (this.document !== doc || text === null || text === doc.original) continue;
          if (this.dirty || doc.saving) { doc.note = "디스크의 파일이 변경됐습니다. 저장 시 충돌을 확인합니다."; cx.notify(); continue; }
          const caret = doc.buffer.head;
          doc.original = text; doc.buffer.apply([{ from: 0, to: doc.buffer.length, insert: text }]);
          doc.buffer.select(Math.min(caret, doc.buffer.length)); this.changed(cx, -1);
        }
      } catch { /* Save still uses compare-and-swap if watching is unavailable. */ }
    });
  }
  publishState() {
    if (this.probe || !this.document) return;
    const key = this.documentSpace, all = shared("activity.editorState") ?? {};
    const next = { path: this.shown.path, on: this.shown.on ?? null, dirty: this.dirty, saving: this.document.saving, owner: "codenav", session: this.document.owner };
    if (JSON.stringify(all[key]) !== JSON.stringify(next)) setShared("activity.editorState", { ...all, [key]: next });
  }
  publish(cx) { if (!this.probe) super.publish(cx); }
  closeRequest() {
    const request = (shared("activity.closeRequest") ?? {})[this.documentSpace];
    return request?.status === "pending" && request.path === this.shown?.path && (request.on ?? null) === (this.shown?.on ?? null) ? request : null;
  }
  finishClose(request, approved) {
    if (!request || this.probe || this.dirty || this.document?.saving) return;
    const all = shared("activity.closeRequest") ?? {};
    if (all[this.documentSpace]?.token !== request.token) return;
    if (approved) {
      setShared("activity.closeRequest", { ...all, [this.documentSpace]: { ...request, status: "approved" } });
      run(`codenav.close-approved:${JSON.stringify({ key: this.documentSpace, token: request.token })}`);
    } else { const next = { ...all }; delete next[this.documentSpace]; setShared("activity.closeRequest", next); }
  }
  save(cx) {
    const doc = this.document, request = this.closeRequest();
    if (!doc || doc.buffer.readOnly || doc.saving) return;
    if (!this.dirty) { this.finishClose(request, true); return; }
    const text = doc.buffer.text, original = doc.original, space = this.documentSpace;
    doc.saving = true; doc.note = null; this.publishState(); cx.notify();
    cx.spawn(async cx => {
      try {
        await writeTextFile(doc.spec.path, text, original);
        doc.original = text; doc.note = "저장됨";
        if (!this.probe) {
          const all = shared("codenav.editedFiles") ?? {}, key = space;
          setShared("codenav.editedFiles", { ...all, [key]: [doc.spec.path, ...(all[key] ?? []).filter(p => p !== doc.spec.path)].slice(0, 200) });
        }
      } catch (error) { doc.note = `저장하지 못했습니다: ${error.message ?? error}`; }
      finally {
        doc.saving = false;
        if (this.document === doc && !this.released) {
          this.publishState(); if (!this.dirty) { this.finishClose(request, true); if (this.hasPending) { this.loadedKey = null; this.sync(cx); } }
          cx.notify();
        }
      }
    });
  }
  discard(cx) {
    if (!this.document || this.document.saving) return;
    this.buffer.apply([{ from: 0, to: this.buffer.length, insert: this.document.original }]);
    this.changed(cx, -1); this.publishState(); this.finishClose(this.closeRequest(), true);
    if (this.hasPending) { this.loadedKey = null; this.sync(cx); }
  }
  cancelPending(cx) {
    const request = this.closeRequest();
    if (request) {
      const all = { ...(shared("activity.closeRequest") ?? {}) }; delete all[this.documentSpace]; setShared("activity.closeRequest", all);
    }
    if (this.hasPending && !this.probe) setEditorSpec(this.documentSpace, this.shown);
    this.hasPending = false; this.pending = null; this.loadedKey = null; cx.notify();
  }
  header() {
    if (!this.shown) return null;
    const doc = this.document, colors = uiColors();
    return ideaUI(v_flex()).flex_none()
      .child(h_flex().h(IDEA.editorBreadcrumbHeight).px(8).gap(8).items_center().border_b(1).border_color(colors.separator).bg(colors.editor)
        .child(div().flex_1().min_w(0).truncate().text_color(colors.secondary).child(this.shown.rel ?? this.shown.path))
        .child(div().flex_none().text_color(this.dirty ? colors.accent : colors.secondary).child(doc?.saving ? "저장 중…" : this.dirty ? "수정됨" : ""))
        .when(this.diags.length > 0, el => el.child(div().child(`⚠ ${this.diags.length}`)))
        .when(this.diags.length > 0 && this.diagnosticConfidence === "unversioned", el => el.child(div().text_color(colors.secondary).tooltip("이 언어 서버는 진단 버전을 제공하지 않습니다.").child("버전 미제공")))
        .children([this.markdownButton(theme())].filter(Boolean))
        .when(Boolean(this.shown.on), el => el.child(iconButton("owned-editor-remote", "pencil", "원격 파일 편집", () => this.edit(), { size: 24 })))
        .child(iconButton("owned-editor-save", "save", ["저장", actionShortcut("activity.save", keys(), { layout: "idea", mod: "codenav" })].filter(Boolean).join(" · "), (_e, cx) => this.save(cx), { disabled: !this.dirty || doc?.saving, size: 24 })))
      .when(Boolean(doc?.note || this.lspError), el => el.child(div().px(10).py(4).text_color(colors.secondary).child(doc?.note ?? this.lspError)))
      .when(Boolean(this.closeRequest()) || this.hasPending, el => el.child(h_flex().px(10).py(6).gap(6).items_center().bg(colors.surface)
        .child(div().flex_1().child("열린 파일의 변경 내용을 저장할까요?"))
        .child(uiButton("owned-save-pending", "저장", (_e, cx) => this.save(cx), { small: true, primary: true, disabled: doc?.saving }))
        .child(uiButton("owned-discard-pending", "버리기", (_e, cx) => this.discard(cx), { small: true, disabled: doc?.saving }))
        .child(uiButton("owned-cancel-pending", "취소", (_e, cx) => this.cancelPending(cx), { small: true, disabled: doc?.saving }))));
  }
  async release() {
    super.release(); this.commandKeys.release(); this.input.release(); this.focus.release?.();
    // Close only our own leases; late requests from a disposed view cannot
    // resurrect these sessions. No source text enters persistent shared state.
    if (this.lspEnabled) await Promise.all([...this.documents.values()].filter(doc => !doc.spec.on && doc.leaseRevision !== undefined).map(doc =>
      peek("document_close", { path: doc.spec.path, document_owner: doc.owner, revision: doc.leaseRevision })));
  }
}

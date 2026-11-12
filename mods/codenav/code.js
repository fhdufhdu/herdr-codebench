// The code view: a read-only, VS Code–like view of a source file with language
// server help. Click a name for its type and docs, Cmd+click (F12) to go to its
// definition, Shift+F12 for references, an outline of the file's symbols,
// diagnostics under the code (hover for the message), Cmd+F
// to find, Ctrl+- / Ctrl+Shift+- (and the tab strip's arrows) for the tabs
// shown before, Alt+Left / Alt+Right for the jumps inside the file. "Edit"
// hands the file to the activity editor. Clicking a line number starts a
// comment (Shift+click for a range); comments join the repository's review
// comments (comments.js) and show inline. The gutter marks
// lines added, changed and removed since HEAD. Drag (or Shift+click) selects
// text; Cmd+C copies it, else the selected name, else the current line.
// Dragging over the line numbers comments on those lines. The rows are a
// Scroller's (scroller.js), so they take presses and drags.
import { div } from "gpui-kit";
import { T } from "./i18n.js";
import { IDEA, isIdea, uiSize, ideaUI, uiColors, MenuController, uiMenu, uiPopupSize,
  uiDiagnosticColors, uiDiagnosticUnderline, uiDiagnosticTooltip, uiModeSwitch } from "./idea-design.js";
import { editorGeometry, editorGutter, editorLine, editorViewport, editorSurface } from "./editor-surface.js";
import { v_flex, h_flex, v_virtual_list, Scrollbar, TextView, InputState, Input } from "gpui-base";
import { readTextFile, watchFolder, theme, run, exec, nextCommand, layout, setShared, shared, openOverlay, closeOverlay, props, keys, spaces } from "herdr";
import { uiNotify as notify } from "./idea-design.js";
import { lsp } from "./lsp.js";
import { openLspSetup } from "./lsp-setup.js";
import { diagnosticCardOptions, canAttachDiagnostics } from "./diagnostics.js";
import { CommentBox, commentCard, commentHeight, commentsOf, repoKey } from "./comments.js";
import { Scroller } from "./scroller.js";
import { tabBack, tabForward } from "./tabs.js";
import { openEverywhere } from "./everywhere.js";
import { toolImage } from "./ideaicons.js";
import { navigationMarkers, documentIdentity, sameDocument, definitionGesture } from "./editor-model.js";
import { ACTION_GROUPS, getAction, actionPresentation, effectiveShortcuts, formatShortcut, normalizeChord } from "./actions.js";
import { groupItems } from "./toolbar-model.js";
import { isHttp, httpRequests, httpEnvs, runHttp, httpBar } from "./http.js";
import {
  iconButton, button, editorKey, editorSpec, setEditorSpec, CHILD, STACK, hasArea, measureFont,
  syntaxColors, expandTabs, displayWidth, offsetAt, wordAt, tilde, sectionHeader, copyText, find, emptyEditor, codeFont, islandBottom,
} from "./common.js";

const PAD = 12;
const MAX_LINE = 2000;
const IDEA_KEY_ACTIONS = { "cmd-u": "super-declaration", "cmd-b": "definition", "cmd-alt-b": "implementation",
  "alt-f7": "usages", "alt-shift-f12": "usages", "cmd-alt-f7": "usages", "cmd-shift-b": "type-definition", "ctrl-shift-b": "type-definition",
  "cmd-f12": "file-structure", "cmd-l": "goto-line", f2: "next-error", "shift-f2": "prev-error", "cmd-shift-o": "find-file",
  "cmd-shift-e": "find-locations", "ctrl-shift-v": "rich-view", "alt-left": "nav-back", "alt-right": "nav-forward" };
export const KIND = { class: "C", struct: "S", interface: "I", enum: "E", function: "ƒ", method: "m", constructor: "c", field: "f", property: "p", variable: "v", constant: "K", module: "M", namespace: "N", package: "P", "type parameter": "T", "enum member": "e" };

export default class CodeView {
  init(_p, cx) {
    this.lines = []; this.toks = null; this.diags = []; this.symbols = []; this.refs = null;
    // The idea layout has a Structure tool window instead.
    this.cw = codeFont().size * 0.6; this.outline = !isIdea() && !find(layout(), "view-structure");
    this.scroll = new Scroller();
    this.focus = cx.focus_handle();
    this.find = InputState.new({ placeholder: T("Find") });
    this.find.on("change", (_e, cx) => { this.findQuery = this.find.value(); this.findAt = -1; cx.notify(); });
    this.find.on("submit", (e, cx) => { this.findNext(e?.shift ? -1 : 1); cx.notify(); });
    this.sleep = (ms) => cx.sleep(ms);
    this.comment = new CommentBox();
    // pane.go gives this view the keyboard; keys.json's mod:codenav keys arrive as commands.
    this.listenCommands(cx);
  }
  listenCommands(cx) { cx.spawn(async (cx) => { for (;;) { this.command(await nextCommand(), cx); cx.notify(); } }); }

  readDocument(spec) { return readTextFile(spec.path, { on: spec.on }); }
  didLoadDocument(_spec, _cx, _keepView) {}
  languageRequest(method, args) { return lsp(method, args, this.sleep); }
  inlineCaret(_line) { return null; }
  get lineLimit() { return MAX_LINE; }

  // Back / forward belong to the space whose editor this is.
  history() {
    const k = JSON.stringify([editorKey(), this.shown?.on ?? null]);
    this.histories ??= {};
    return (this.histories[k] ??= { back: [], fwd: [] });
  }
  get back() { return this.history().back; }
  set back(v) { this.history().back = v; }
  get fwd() { return this.history().fwd; }
  set fwd(v) { this.history().fwd = v; }

  sync(cx) {
    const spec = editorSpec(), space = editorKey();
    if (spec?.kind === "database") {
      if (this.shown) { this.seq = (this.seq ?? 0) + 1; this.watched = null; this.loadedKey = null; }
      this.shown = null; this.lines = []; this.loading = false; return;
    }
    const k = JSON.stringify([documentIdentity(spec, space), spec?.at ?? null]);
    if (k === this.loadedKey) return;
    const same = sameDocument(spec, space, this.shown, this.documentSpace);
    if (!same) { this.seq = (this.seq ?? 0) + 1; this.watched = null; }
    this.loadedKey = k;
    this.documentSpace = space;
    this.shown = spec;
    if (!spec) {
      this.seq = (this.seq ?? 0) + 1;
      this.lines = []; this.loading = false; this.http = null; this.finding = false;
      this.sel = null; this.hover = null; this.documentation = false; this.refs = null; this.symbols = []; this.diags = []; this.navigation = [];
      return;
    }
    if (same && this.lines.length) { this.reveal(spec.line, spec.col); return; }
    // Deferred: render must not start work that notifies before its first await.
    cx.timer.after(0, (cx) => { if (!this.released && this.loadedKey === k && editorKey() === space && JSON.stringify(editorSpec()) === JSON.stringify(spec)) this.load(spec, cx); });
  }

  requestContext() { return { space: this.documentSpace ?? editorKey(), identity: documentIdentity(this.shown, this.documentSpace ?? editorKey()), seq: this.seq }; }
  currentRequest(context) {
    return !this.released && context.seq === this.seq && editorKey() === context.space
      && documentIdentity(editorSpec(), editorKey()) === context.identity
      && documentIdentity(this.shown, this.documentSpace) === context.identity;
  }

  release() {
    this.released = true; this.seq = (this.seq ?? 0) + 1; this.watched = null;
    this.find?.release?.(); this.scroll?.release?.();
  }

  load(spec, cx, keepView = false) {
    const seq = (this.seq = (this.seq ?? 0) + 1);
    const request = this.requestContext(), alive = () => seq === this.seq && this.currentRequest(request);
    if (!keepView) { this.sel = null; this.hover = null; this.documentation = false; this.refs = null; this.symbols = []; this.diags = []; this.toks = null; this.info = null; }
    this.error = null; this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const text = await this.readDocument(spec).catch(() => null);
        if (!alive()) return;
        if (text === null) { this.error = T("This file can't be read as text (missing, or over 1 MB)."); return; }
        if (text.includes("\0")) { this.error = T("A binary file."); return; }
        this.text = text;
        this.lines = text.split("\n");
        this.navigation = navigationMarkers(this.lines, spec.path);
        this.width = Math.max(...this.lines.slice(0, 20000).map((l) => displayWidth(l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l)), 40);
        if (!keepView) { this.comment.close(); this.selection = null; this.scroll.setTop(0); this.reveal(spec.line, spec.col); }
        this.didLoadDocument(spec, cx, keepView);
        this.loading = false; cx.notify();
        this.watch(spec, cx);
        // The repository the file is in: its review comments are kept there.
        const dir = spec.path.replace(/\/[^/]*$/, "");
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: dir, on: spec.on }).catch(() => null);
        if (!alive()) return;
        this.repo = top?.code === 0 ? top.stdout.trim() : null;
        this.http = isHttp(spec.path) && !spec.on ? { envs: await httpEnvs(spec.path, this.repo) } : null;
        if (!alive()) return;
        await this.loadChanges(spec, alive);
        cx.notify();
        // Colors first (fast), then the language server.
        const toks = await this.languageRequest("tokens", spec.on ? { path: spec.path, text } : { path: spec.path }).catch(() => null);
        if (!alive()) return;
        this.toks = toks; cx.notify();
        if (spec.on) { this.info = { lang: null, remote: true }; return; }
        if (/\.(java|kt|kts)$/.test(spec.path)) {
          const spring = await this.languageRequest("spring_markers", { path: spec.path, root: this.repo ?? spec.root, text }).catch(() => []);
          if (!alive()) return;
          this.navigation = [...this.navigation.filter(marker => marker.kind === "super"), ...spring]; cx.notify();
        }
        const info = await this.languageRequest("info", { path: spec.path }).catch((e) => ({ error: String(e.message ?? e) }));
        if (!alive()) return;
        this.info = info;
        if (!this.info?.lang || !this.info.installed) return;
        cx.notify();
        const retry = this.retry; this.retry = false;
        const symbols = await this.languageRequest("symbols", { path: spec.path, retry }).catch((e) => { if (alive()) this.lspError = String(e.message ?? e); return null; });
        if (!alive()) return;
        if (symbols) { this.symbols = symbols; this.lspError = null; }
        const updatedInfo = await this.languageRequest("info", { path: spec.path }).catch(() => this.info);
        if (!alive()) return;
        this.info = updatedInfo;
        cx.notify();
        // Diagnostics arrive when the server has looked; ask a few times.
        for (const wait of [300, 1500, 4000, 8000]) {
          await cx.sleep(wait);
          if (!alive()) return;
          await this.loadDiagnostics(cx);
        }
      } catch (e) { if (alive()) this.error = String(e.message ?? e); }
      finally { if (alive()) { this.loading = false; cx.notify(); } }
    });
  }

  async loadDiagnostics(cx) {
    const s = this.shown, request = this.requestContext();
    if (!s || s.on || !this.info?.installed) return;
    const r = await this.languageRequest("diagnostics", { path: s.path }).catch(() => null);
    if (r && this.currentRequest(request)) { this.diags = r.items; this.busy = r.busy; cx.notify(); }
  }

  // Reloads when the file changes on disk (local files).
  watch(spec, cx) {
    if (spec.on) return;
    const dir = spec.path.replace(/\/[^/]*$/, ""), request = this.requestContext(), key = request.identity;
    if (this.watched === key) return;
    this.watched = key;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === key && this.currentRequest(request)) {
          const changed = await watchFolder(dir);
          if (this.watched !== key || !this.currentRequest(request)) break;
          if (!changed.includes(spec.path) && !changed.includes(dir)) continue;
          const text = await readTextFile(spec.path).catch(() => null);
          if (this.watched === key && this.currentRequest(request) && text !== null && text !== this.text) { this.watched = null; this.load(this.shown, cx, true); break; }
        }
      } catch { if (this.watched === key) this.watched = null; }
    });
  }

  // Scrolls to a 1-based line (as in specs) and selects the name at col.
  reveal(line, col) {
    if (!line) return;
    const i = Math.min(Math.max(line - 1, 0), Math.max(this.lines.length - 1, 0));
    this.items();
    this.scrollTo(i, "center");
    const w = col !== undefined ? wordAt(this.lines[i] ?? "", col) : null;
    this.sel = { line: i, col: col ?? 0, ...(w ?? { start: 0, end: 0, word: null }) };
    this.flash = i;
  }

  here() { const s = this.shown; return s ? { spec: s, line: (this.sel?.line ?? 0) + 1, col: this.sel?.col } : null; }

  // Opens a location: in this view when it's the same file, else as the editor's file.
  open(loc, cx) {
    const cur = this.here();
    if (cur) { this.back.push(cur); this.fwd = []; }
    this.goTo({ path: loc.path, line: loc.line + 1, col: loc.col }, cx);
  }

  goTo({ spec, path, line, col, on }, cx) {
    const s = this.shown;
    path = path ?? spec?.path;
    if (!path) return;
    const targetOn = spec ? spec.on ?? null : on !== undefined ? on : s?.on ?? null;
    if (s && path === s.path && targetOn === (s.on ?? null)) { this.reveal(line, col); this.hoverAt(cx); cx.notify(); return; }
    const root = spec?.root ?? (s?.root && path.startsWith(s.root + "/") ? s.root : path.replace(/\/[^/]*$/, ""));
    const rel = path.startsWith(root + "/") ? path.slice(root.length + 1) : tilde(path);
    setEditorSpec(editorKey(), { kind: "file", path, root, rel, on: targetOn, line, col });
  }

  goBack(cx) { const to = this.back.pop(); if (!to) return; const cur = this.here(); if (cur) this.fwd.push(cur); this.goTo(to, cx); }
  goForward(cx) { const to = this.fwd.pop(); if (!to) return; const cur = this.here(); if (cur) this.back.push(cur); this.goTo(to, cx); }

  // A press on the code: the row comes from the list, the column from where the pointer was.
  pick(line, x, cx) {
    const text = this.lines[line] ?? "";
    const { col } = this.pointAt(line, x);
    const w = wordAt(text, col);
    this.sel = { line, col: w ? w.start : col, ...(w ?? { start: col, end: col, word: null }) };
    this.documentation = false;
    this.flash = null;
    return this.sel;
  }

  // What changed since the last commit, by line of the file as it is now:
  // "add" (new lines), "mod" (changed lines), "del" (lines removed just below).
  async loadChanges(spec, alive) {
    this.changes = new Map();
    const rel = this.rel();
    if (!rel) return;
    const r = await exec("git", ["--no-optional-locks", "diff", "-U0", "--no-color", "--no-ext-diff", "HEAD", "--", rel], { cwd: this.repo, on: spec.on }).catch(() => null);
    if (!alive() || r?.code !== 0) return;
    const changes = new Map();
    for (const m of r.stdout.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const removed = m[1] === undefined ? 1 : +m[1], start = +m[2], added = m[3] === undefined ? 1 : +m[3];
      if (added === 0) changes.set(Math.max(start - 1, 0), "del");
      else for (let k = 0; k < added; k++) changes.set(start - 1 + k, k < removed ? "mod" : "add");
    }
    this.changes = changes;
  }

  // -- comments ------------------------------------------------------------------
  rkey() { return this.repo ? repoKey(this.shown?.on, this.repo) : null; }
  rel() { const p = this.shown?.path ?? ""; return this.repo && p.startsWith(this.repo + "/") ? p.slice(this.repo.length + 1) : null; }
  fileComments() { const rel = this.rel(); return rel ? commentsOf(this.rkey()).filter((c) => c.path === rel && c.side !== "old") : []; }

  // Lines and the comments under them, as the list shows them.
  // Kept until the file's lines or its comments change: renders come often.
  items() {
    const comments = this.fileComments();
    const key = JSON.stringify([uiSize(), comments.map((c) => [c.id, c.end, c.body])]);
    const rowH = codeFont().row;
    if (this.itemsCache?.lines === this.lines && this.itemsCache.key === key && this.itemsCache.rowH === rowH) return this.itemsCache.items;
    const after = new Map();
    for (const c of comments) {
      const at = Math.min(Math.max(c.end - 1, 0), Math.max(this.lines.length - 1, 0));
      if (!after.has(at)) after.set(at, []);
      after.get(at).push(c);
    }
    const items = [], index = [];
    this.lines.forEach((_, i) => {
      index[i] = items.length;
      items.push({ line: i });
      for (const c of after.get(i) ?? []) items.push({ c });
    });
    this.scroll.setHeights(items.map((it) => it.c ? commentHeight(it.c) : rowH));
    this.itemIndex = index;
    this.itemsCache = { lines: this.lines, key, items, rowH };
    return items;
  }

  scrollTo(line, how) { this.scroll.scrollTo(this.itemIndex?.[line] ?? line, how); }

  // Lines from..to (0-based) get a comment box.
  commentLines(from, to, cx, quote) {
    if (!this.rel()) { this.showNote(T("Comments need a file inside a git repository")); cx.notify(); return; }
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const code = (quote ?? this.lines.slice(lo, hi + 1)).slice(0, 30).map((l) => `  ${l}`);
    this.comment.open({ path: this.rel(), side: "new", start: lo + 1, end: hi + 1, code, kind: "file" });
    cx.notify();
  }
  // The selected text's lines, quoting just the selected part; else the name's line.
  commentSelection(cx) {
    const r = this.span();
    if (r) this.commentLines(r[0].line, r[1].line, cx, this.selectedText().split("\n"));
    else if (this.sel) this.commentLines(this.sel.line, this.sel.line, cx);
  }

  // -- pointer on the code ----------------------------------------------------------------
  pointAt(line, x) {
    const text = this.lines[line] ?? "";
    return { line, col: offsetAt(text, Math.max(0, Math.floor((x - this.textOrigin()) / this.cw))) };
  }
  // The selection from its earlier end to its later one, or null when empty.
  span() {
    const r = this.selection;
    if (!r) return null;
    const [a, b] = r.a.line < r.b.line || (r.a.line === r.b.line && r.a.col <= r.b.col) ? [r.a, r.b] : [r.b, r.a];
    return a.line === b.line && a.col === b.col ? null : [a, b];
  }

  press(line, e, cx) {
    const x = e.local_position?.x ?? 0, mods = e.modifiers ?? {};
    this.focus.focus();
    // The line numbers start a comment; Shift extends it from the last one.
    if (x < this.gutter()) {
      if (isIdea() && !mods.alt) {
        if (!mods.shift || this.lineAnchor === undefined) this.lineAnchor = mods.shift ? this.sel?.line ?? line : line;
        this.selectLines(this.lineAnchor, line); this.gutterSelection = { anchor: this.lineAnchor, to: line };
        cx.notify(); return;
      }
      if (!(mods.shift && this.commentAnchor !== undefined)) this.commentAnchor = line;
      this.commentLines(this.commentAnchor, line, cx);
      this.gutterDrag = { to: line };
      return;
    }
    const p = this.pointAt(line, x);
    if (mods.shift && (this.selection || this.sel)) {
      this.selection = { a: this.selection?.a ?? { line: this.sel.line, col: this.sel.col }, b: p };
      cx.notify();
      return;
    }
    this.dragging = { a: p, x, mods, moved: false };
  }

  dragTo(line, e, cx) {
    if (this.gutterSelection) {
      if (this.gutterSelection.to !== line) { this.gutterSelection.to = line; this.selectLines(this.gutterSelection.anchor, line); cx.notify(); }
      return;
    }
    const g = this.gutterDrag;
    if (g && g.to !== line) { g.to = line; this.commentLines(this.commentAnchor, line, cx); return; }
    const d = this.dragging;
    if (!d) return;
    const p = this.pointAt(line, e.local_position?.x ?? 0), b = this.selection?.b;
    if (!d.moved && p.line === d.a.line && p.col === d.a.col) return;
    if (d.moved && b && b.line === p.line && b.col === p.col) return;
    d.moved = true;
    this.selection = { a: d.a, b: p };
    cx.notify();
  }

  // Without a drag the press was a click: the name under it, its definition with Cmd.
  pointerRelease(line, cx) {
    const d = this.dragging;
    this.dragging = null; this.gutterDrag = null; this.gutterSelection = null;
    if (!d || d.moved) return;
    this.selection = null;
    this.pick(line, d.x, cx);
    const kind = definitionGesture(d.mods, isIdea());
    if (kind) this.definition(cx, kind);
    else this.hoverAt(cx);
    cx.notify();
  }

  selectedText() {
    const r = this.span();
    return r ? this.lines.slice(r[0].line, r[1].line + 1).map((l, k, all) =>
      l.slice(k === 0 ? r[0].col : 0, k === all.length - 1 ? r[1].col : l.length)).join("\n") : null;
  }

  selectLines(from, to) {
    const lo = Math.max(0, Math.min(from, to)), hi = Math.min(this.lines.length - 1, Math.max(from, to));
    this.selection = { a: { line: lo, col: 0 }, b: hi + 1 < this.lines.length ? { line: hi + 1, col: 0 } : { line: hi, col: this.lines[hi]?.length ?? 0 } };
    this.sel = { line: to, col: 0, start: 0, end: 0, word: null }; this.hover = null; this.documentation = false;
  }

  // What Cmd+C takes: the selected text, else the selected name, else the current line.
  copy() {
    const r = this.span(), sel = this.sel;
    if (!r && !sel) return;
    const text = r ? this.selectedText() : sel.word?.trim() ? sel.word : this.lines[sel.line] ?? "";
    const what = r ? T("the selection") : sel.word?.trim() ? sel.word : T("the line");
    copyText(text).then(() => notify({ title: T("Copied {what}", { what }), level: "success", timeout: 1500 }))
      .catch((e) => notify({ title: String(e.message ?? e), level: "error", timeout: 3000 }));
  }

  posArgs() { return { path: this.shown.path, line: this.sel.line, col: this.sel.col }; }
  lspReady() { return this.shown && !this.shown.on && this.info?.installed && this.sel; }

  hoverAt(cx, explicit = false) {
    this.hover = null;
    this.documentation = isIdea() && explicit;
    if (isIdea() && !explicit) return;
    if (!this.lspReady() || !this.sel.word) return;
    const sel = this.sel, args = this.posArgs(), request = this.requestContext(), generation = this.hoverGeneration = (this.hoverGeneration ?? 0) + 1;
    cx.spawn(async (cx) => {
      const r = await this.languageRequest("hover", args).catch((e) => ({ error: String(e.message ?? e) }));
      if (this.currentRequest(request) && this.sel === sel && generation === this.hoverGeneration) { this.hover = r ?? {}; cx.notify(); }
    });
  }

  showNote(message, level = "info") {
    this.note = message;
    if (isIdea()) notify({ title: message, level, timeout: 3500 });
  }

  definition(cx, kind = "definition") {
    if (!this.lspReady()) return;
    const sel = this.sel, args = { ...this.posArgs(), kind }, request = this.requestContext(), generation = this.definitionGeneration = (this.definitionGeneration ?? 0) + 1;
    this.note = T("Looking for the definition…"); cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await this.languageRequest("definition", args);
        if (!this.currentRequest(request) || this.sel !== sel || generation !== this.definitionGeneration) return;
        this.note = null;
        if (!r.length) this.showNote(T("No {kind} found for {word}", { kind: T(kind), word: sel.word ?? "" }));
        else if (r.length === 1) this.open(r[0], cx);
        else this.refs = { title: T("{n} results for {word}", { n: r.length, word: sel.word }), items: r };
      } catch (e) { if (!this.currentRequest(request) || generation !== this.definitionGeneration) return; this.showNote(String(e.message ?? e), "error"); }
      cx.notify();
    });
  }

  related(marker, cx) {
    if (!this.shown || this.shown.on) return;
    const path = this.shown.path, request = this.requestContext(), generation = this.relatedGeneration = (this.relatedGeneration ?? 0) + 1;
    this.note = T("Looking for navigation targets…"); cx.notify();
    cx.spawn(async cx => {
      try {
        const items = await this.languageRequest("related", { path, root: this.repo ?? this.shown.root, ...marker });
        if (!this.currentRequest(request) || generation !== this.relatedGeneration) return;
        this.note = null;
        if (!items.length) this.showNote(T("No navigation target found."));
        if (items.length === 1) this.open(items[0], cx);
        else if (items.length) this.refs = { title: T(marker.title), items };
      } catch (error) { if (!this.currentRequest(request) || generation !== this.relatedGeneration) return; this.showNote(String(error.message ?? error), "error"); }
      cx.notify();
    });
  }

  references(cx) {
    if (!this.lspReady()) return;
    const sel = this.sel, args = this.posArgs(), request = this.requestContext(), generation = this.referenceGeneration = (this.referenceGeneration ?? 0) + 1;
    this.refs = { title: T("References to {word}", { word: sel.word ?? "…" }), items: null };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const items = await this.languageRequest("references", args);
        if (!this.currentRequest(request) || generation !== this.referenceGeneration) return;
        this.refs = { title: T("{n} references to {word}", { n: items.length, word: sel.word }), items };
      } catch (e) { if (!this.currentRequest(request) || generation !== this.referenceGeneration) return; this.refs = { title: T("References"), items: [], error: String(e.message ?? e) }; }
      cx.notify();
    });
  }

  springList(kind, cx) {
    if (!this.shown || this.shown.on) return;
    const request = this.requestContext(), generation = this.springGeneration = (this.springGeneration ?? 0) + 1;
    const args = { path: this.shown.path, root: this.repo ?? this.shown.root, kind };
    const titles = { beans: "Spring Beans", endpoints: "Spring Endpoints", properties: "Spring Configuration Keys" };
    const title = T(titles[kind]);
    this.refs = { title, items: null }; cx.notify();
    cx.spawn(async cx => {
      try {
        const items = await this.languageRequest("spring_project", args);
        if (this.currentRequest(request) && generation === this.springGeneration) this.refs = { title, items };
      } catch (error) {
        if (this.currentRequest(request) && generation === this.springGeneration) this.refs = { title, items: [], error: String(error.message ?? error) };
      }
      cx.notify();
    });
  }

  findNext(dir) {
    const q = this.findQuery;
    if (!q) return;
    const hits = [];
    this.lines.forEach((l, i) => { if (l.includes(q)) hits.push(i); });
    if (!hits.length) return;
    const from = this.sel?.line ?? -1;
    const next = dir > 0 ? hits.find((i) => i > from) ?? hits[0] : [...hits].reverse().find((i) => i < from) ?? hits[hits.length - 1];
    const col = this.lines[next].indexOf(q);
    this.sel = { line: next, col, start: col, end: col + q.length, word: q };
    this.scrollTo(next, "center");
  }

  edit() {
    const s = this.shown;
    if (!s) return;
    setEditorSpec(editorKey(), { ...s, edit: true, line: (this.sel?.line ?? 0) + 1 });
    if (hasArea()) run("layout.select", { stack: STACK, child: CHILD.text });
  }

  command(c, cx) {
    if (c.startsWith("editor-action:")) {
      let data; try { data = JSON.parse(c.slice(14)); } catch { return; }
      if (data.identity !== documentIdentity(editorSpec(), editorKey()) || data.at !== (editorSpec()?.at ?? null)) return;
      const action = getAction(data.action);
      if (!action) return;
      if (action.owner === "code") this.command(action.command.replace(/^codenav\./, ""), cx);
      else run(actionPresentation(action, { layout: shared("layout"), document: editorSpec(), area: shared("codenav.area") }).command);
    }
    else if (c === "retry-lsp" && this.shown && !this.shown.on) { this.lspError = null; this.retry = true; this.load(this.shown, cx, true); }
    else if (c === "focus") this.focus.focus();
    else if (c === "editor-back") this.back.length ? this.goBack(cx) : tabBack();
    else if (c === "editor-forward") this.fwd.length ? this.goForward(cx) : tabForward();
    else if (c === "definition") this.definition(cx);
    else if (c === "implementation") this.definition(cx, "implementation");
    else if (c === "type-definition") this.definition(cx, "typeDefinition");
    else if (c === "super-declaration") { const marker = this.navigation?.find(item => item.kind === "super" && item.line === this.sel?.line); if (marker) this.related(marker, cx); }
    else if (c === "spring-beans") this.springList("beans", cx);
    else if (c === "spring-endpoints") this.springList("endpoints", cx);
    else if (c === "spring-properties") this.springList("properties", cx);
    else if (c === "usages") this.references(cx);
    else if (c === "next-error") this.nextProblem(1);
    else if (c === "prev-error") this.nextProblem(-1);
    else if (c === "file-structure") openEverywhere("structure");
    else if (c === "goto-line") openEverywhere("line");
    else if (c === "http-run-all" && this.currentRequest(this.requestContext()) && this.http && isHttp(this.shown?.path) && !this.shown.on)
      runHttp(this.shown.path, this.lines, this.http.envs, null, () => this.showTerminal());
    else if (c === "http-env" && this.currentRequest(this.requestContext()) && this.http && isHttp(this.shown?.path) && !this.shown.on)
      openOverlay({ mod: "codenav", props: { view: "httpenv", dir: this.shown.path.replace(/\/[^/]*$/, ""), names: this.http.envs.names }, kind: "popup", width: 220, height: Math.min(300, 50 + this.http.envs.names.length * 30) });
    else if (c === "rich-view" && this.isMarkdown()) this.toggleRich();
  }

  // F2 / Shift+F2: the next problem after the caret, round the file.
  nextProblem(dir) {
    const list = [...this.diags].sort((a, b) => a.line - b.line || a.col - b.col);
    if (!list.length) return;
    const at = this.sel?.line ?? -1, col = this.sel?.col ?? -1;
    const after = (d) => d.line > at || (d.line === at && d.col > col), before = (d) => d.line < at || (d.line === at && d.col < col);
    const d = dir > 0 ? list.find(after) ?? list[0] : [...list].reverse().find(before) ?? list[list.length - 1];
    this.reveal(d.line + 1, d.col);
  }

  // What the idea layout's Structure, Problems and status bar show, for the shown file.
  publish(cx) {
    const s = this.shown, request = this.requestContext(), space = request.space;
    if (!s || !find(layout(), "view-structure")) return;
    if (!this.currentRequest(request)) return;
    const scope = this.sel ? this.scope(this.sel.line).map((x) => x.name) : [];
    const caret = this.sel ? { path: s.path, on: s.on ?? null, line: this.sel.line, col: this.sel.col, scope } : null;
    const want = [["codenav.caret", caret, JSON.stringify(caret)], ["codenav.symbols", { path: s.path, items: this.symbols.slice(0, 1500) }, this.symbols],
      ["codenav.problems", { path: s.path, items: this.diags }, this.diags]];
    this.published ??= {};
    for (const [key, value, mark] of want) {
      const sig = [request.identity, mark];
      const last = this.published[key];
      if (last && last[0] === sig[0] && last[1] === sig[1]) continue;
      this.published[key] = sig;
      cx.timer.after(0, () => { if (this.currentRequest(request)) setShared(key, value ? { ...value, on: s.on ?? null, space } : null); });
    }
    if (this.problemSnapshot !== this.diags || this.problemIdentity !== request.identity) {
      this.problemSnapshot = this.diags;
      this.problemIdentity = request.identity;
      const file = { path: s.path, on: s.on ?? null, space, items: this.diags };
      cx.timer.after(0, () => { if (this.currentRequest(request)) setShared("codenav.problemFiles", Object.fromEntries(Object.entries({ ...(shared("codenav.problemFiles") ?? {}), [`${space}:${s.on ?? ""}:${s.path}`]: file }).slice(-100))); });
    }
  }

  // .http files: their requests, and running one.
  httpLines() {
    if (!this.http || !isHttp(this.shown?.path)) { this.httpLine = null; return; }
    if (this.httpFor !== this.lines) { this.httpFor = this.lines; this.httpReqs = httpRequests(this.lines); this.httpLine = new Set(this.httpReqs.map((r) => r.line)); }
  }
  showTerminal() { run("codenav.show-terminal"); }
  runRequest(line) {
    const req = this.httpReqs?.find((r) => r.line === line);
    if (req) runHttp(this.shown.path, this.lines, this.http.envs, req, () => this.showTerminal());
  }

  // Markdown: the rendered page (rich view) or the source with comments, per file.
  isMarkdown() { return /\.(md|markdown|mdx)$/i.test(this.shown?.path ?? ""); }
  richView() { return this.isMarkdown() && Boolean(this.rich?.has(this.shown.path)); }
  toggleRich() {
    this.rich ??= new Set();
    const p = this.shown?.path;
    if (p) this.rich.has(p) ? this.rich.delete(p) : this.rich.add(p);
  }

  closeInfo() {
    this.sel = null; this.selection = null; this.gutterSelection = null; this.hover = null; this.documentation = false; this.note = null;
    for (const key of ["hoverGeneration", "definitionGeneration", "referenceGeneration", "relatedGeneration"]) this[key] = (this[key] ?? 0) + 1;
  }

  openContext() {
    const context = { layout: "idea", document: this.shown, cwd: this.shown?.root, area: "code" };
    const items = groupItems("Editor.context", shared("codenav.customization") ?? {}, ACTION_GROUPS);
    openOverlay({ mod: "codenav", props: { view: "editorcontext", context,
      identity: documentIdentity(this.shown, this.documentSpace), at: this.shown?.at ?? null },
      kind: "popup", frame: "none", ...uiPopupSize(items.length, { width: 300, maxHeight: 460 }) });
  }

  findKey(e, cx) {
    if (this.comment.typing || (e.keystroke !== "cmd-g" && e.keystroke !== "cmd-shift-g")) return false;
    this.findNext(e.keystroke === "cmd-shift-g" ? -1 : 1);
    cx.stop_propagation(); cx.notify(); return true;
  }

  keyDown(e, cx) {
    if (this.findKey(e, cx)) return;
    const k = isIdea() ? normalizeChord(e.keystroke) : e.keystroke;
    const action = isIdea() ? IDEA_KEY_ACTIONS[k] : null;
    if (action && !effectiveShortcuts(action, keys(), { layout: "idea", mod: "codenav" }).some(chord => normalizeChord(chord) === k)) return;
    if (k === "cmd-u" && isIdea()) { const marker = this.navigation?.find(item => item.kind === "super" && item.line === this.sel?.line); if (marker) this.related(marker, cx); cx.stop_propagation(); return; }
    if (this.comment.typing || this.finding && k !== "escape") {
      // Typing a comment (or a search): only its own keys.
      if (!(this.comment.typing && this.comment.key(e, this.rkey()))) return;
      if (!this.comment.draft) this.focus.focus();
      cx.stop_propagation(); cx.notify(); return;
    }
    const idea = isIdea();
    if ((k === "f12" && !isIdea()) || k === "cmd-b") this.definition(cx);
    else if ((k === "shift-f12" && !isIdea()) || k === "alt-shift-f12" || k === "alt-f7") this.references(cx);
    else if (k === "cmd-alt-b" || !idea && k === "ctrl-alt-b") this.definition(cx, "implementation");
    else if (idea ? k === "cmd-alt-f7" : k === "ctrl-alt-f7") this.references(cx);
    else if ((k === "f1" || k === "ctrl-j") && idea) this.hoverAt(cx, true);
    else if (k === "cmd-shift-b" || k === "ctrl-shift-b") this.definition(cx, "typeDefinition");
    else if (k === "cmd-f12") idea ? openEverywhere("structure") : this.definition(cx, "implementation");
    else if (k === "cmd-l") openEverywhere("line");
    else if (k === "f2") this.nextProblem(1);
    else if (k === "shift-f2") this.nextProblem(-1);
    else if (k === "cmd-f" || !idea && k === "ctrl-f") { this.finding = true; this.find.focus(); }
    else if (k === "cmd-shift-o") { if (isIdea()) openEverywhere("files"); else this.outline = !this.outline; }
    else if (k === "cmd-shift-e" && idea) openEverywhere("locations");
    else if (k === "cmd-c" || !idea && k === "ctrl-c") this.copy();
    else if (k === "ctrl-shift-v" && this.isMarkdown()) this.toggleRich();
    else if (k === "ctrl--") tabBack();
    else if (k === "ctrl-shift--" || k === "ctrl-_") tabForward();
    else if (k === "alt-left") this.goBack(cx);
    else if (k === "alt-right") this.goForward(cx);
    else if (k === "escape") { this.springGeneration = (this.springGeneration ?? 0) + 1; this.refs = null; this.closeInfo(); this.finding = false; this.focus.focus(); }
    else if (k === "pageup" || k === "pagedown") this.scroll.page(k === "pageup" ? -1 : 1);
    else if (k === "up" || k === "down") {
      const line = Math.min(Math.max((this.sel?.line ?? 0) + (k === "up" ? -1 : 1), 0), this.lines.length - 1);
      this.sel = { line, col: 0, start: 0, end: 0, word: null };
      this.scrollTo(line);
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  geometry() {
    if (isIdea()) return editorGeometry(codeFont(), this.cw, { lineCount: this.lines.length });
    const numberWidth = Math.max(3, String(this.lines.length).length) * this.cw;
    const gutter = 25 + numberWidth + 12;
    return { row: codeFont().row, numberWidth, gutter, textInset: PAD, textOrigin: gutter + PAD };
  }
  gutter() { return this.geometry().gutter; }
  // Rendering, pointer hit tests and inline comments share one text origin.
  textOrigin() { return this.geometry().textOrigin; }

  // The change mark at the gutter's edge, as VS Code draws it.
  changeMark(i, t) {
    const c = this.changes?.get(i);
    const mark = div().w(3).h_full().flex_none().mr(1);
    if (c === "add") return mark.bg(t.ansi2);
    if (c === "mod") return mark.bg(t.ansi4);
    if (c === "del") return mark.flex().flex_col().justify_end().child(div().w(4).h(5).bg(t.ansi1).rounded(1));
    return mark;
  }

  changeEdge(i) {
    const kind = this.changes?.get(i);
    return kind ? { kind, start: this.changes.get(i - 1) !== kind, end: this.changes.get(i + 1) !== kind } : null;
  }

  // The symbols whose range holds a line, outermost first.
  scope(line) {
    return this.symbols.filter((s) => s.start <= line && line <= s.end && KIND[s.kind] && s.kind !== "variable" && s.kind !== "field");
  }

  // One line: token colors, the selected name's other uses, find hits and diagnostics.
  row(i, t, colors) {
    let text = this.lines[i] ?? "";
    if (text.length > this.lineLimit) text = text.slice(0, this.lineLimit);
    const diags = this.diags.filter((d) => d.line <= i && i <= d.end_line);
    // Point diagnostics still need an inline target after the gutter dot goes.
    if (isIdea() && !text && diags.some(d => d.line === i && d.end_line === i)) text = " ";
    const toks = this.toks?.[i];
    const cuts = new Set([0, text.length]);
    const caret = this.inlineCaret(i);
    if (caret) cuts.add(Math.min(caret.offset, text.length));
    const spans = [];
    if (toks) { let o = 0; for (const [n, cat] of toks) { spans.push([o, o + n, cat]); o += n; cuts.add(Math.min(o, text.length)); } }
    const marks = [];
    // Blank selections mark nothing (every space would light up).
    const word = this.sel?.word?.trim() ? this.sel.word : null;
    if (word) {
      const isWord = /^[\p{L}\p{N}_$]+$/u.test(word);
      for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
        const before = text[at - 1], after = text[at + word.length];
        if (isWord && ((before && /[\p{L}\p{N}_$]/u.test(before)) || (after && /[\p{L}\p{N}_$]/u.test(after)))) continue;
        marks.push([at, at + word.length, this.sel.line === i && at === this.sel.start ? "sel" : "use"]);
        cuts.add(at); cuts.add(at + word.length);
      }
    }
    const span = this.span();
    if (span && span[0].line <= i && i <= span[1].line) {
      const a = i === span[0].line ? Math.min(span[0].col, text.length) : 0, b = i === span[1].line ? Math.min(span[1].col, text.length) : text.length;
      if (b > a) { marks.push([a, b, "range"]); cuts.add(a); cuts.add(b); }
    }
    for (const d of diags) {
      let s = d.line === i ? Math.min(d.col, text.length) : 0, e = d.end_line === i ? Math.min(d.end_col, text.length) : text.length;
      if (isIdea() && s === e && d.line === d.end_line) { s = Math.min(s, Math.max(0, text.length - 1)); e = s + 1; }
      marks.push([s, Math.max(e, s), d.severity === 1 ? "error" : "warning", d]);
      cuts.add(s); cuts.add(Math.max(e, s));
    }
    const points = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
    const children = [];
    let col = 0;
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k], b = points[k + 1];
      if (a === b) continue;
      if (caret?.offset === a) children.push(caret.element);
      const startColumn = col, piece = expandTabs(text.slice(a, b), col);
      col += displayWidth(text.slice(a, b));
      const cat = spans.find((s) => s[0] <= a && a < s[1])?.[2];
      let el = div().flex_none().child(piece);
      if (cat && colors[cat]) el = el.text_color(colors[cat]);
      const problems = [];
      for (const [s, e, kind, d] of marks) {
        if (s > a || e < b) continue;
        if (d) problems.push(d);
        if (kind === "range") el = el.bg(t.selection);
        else if (kind === "sel") el = el.bg(t.accent + "55").rounded(2);
        else if (kind === "use") el = el.bg(t.selection + "66").rounded(2);
        else if (!isIdea()) el = el.border_b(1).border_color(kind === "error" ? t.ansi1 : t.ansi3);
      }
      if (problems.length) {
        if (isIdea()) {
          el = uiDiagnosticUnderline(el, { width: displayWidth(piece) * this.cw, offset: startColumn * this.cw,
            severity: Math.min(...problems.map(d => d.severity ?? 1)) });
          const entries = problems.map(diagnostic => ({ path: this.shown.path, on: this.shown.on ?? null, root: this.shown.root, diagnostic: { ...diagnostic } }));
          el = uiDiagnosticTooltip(`cn-d-${i}-${a}`, el, problems, diagnosticCardOptions(entries, this.diagnosticContext));
        } else el = el.id(`cn-d-${i}-${a}`).tooltip(problemText(problems));
      }
      children.push(el);
    }
    if (caret && caret.offset >= text.length) children.push(caret.element);
    const worst = diags.length ? Math.min(...diags.map((d) => d.severity ?? 1)) : 0;
    const current = this.sel?.line === i;
    const c = this.comment.draft, picked = c && c.path === this.rel() && i + 1 >= c.start && i + 1 <= c.end;
    const geometry = this.geometry(), navigation = isIdea() ? this.navigation?.find(marker => marker.line === i) : null;
    const markerWidth = isIdea() ? geometry.markerWidth : 18;
    const number = () => div().when(isIdea(), el => el.w(geometry.numberWidth).flex_none()).when(!isIdea(), el => el.flex_1())
      .text_right().text_color(isIdea() ? (current ? uiColors().secondary : uiColors().lineNumber) : current ? t.foreground : t.dim).child(String(i + 1));
    const marker = navigation ? div().id(`cn-navigation-${i}`).w(markerWidth).flex_none().text_color(t.ansi2).cursor_pointer()
          .tooltip(T(navigation.title)).on_mouse_down("left", (event, cx) => { cx.stop_propagation(); this.related(navigation, cx); })
          .child(navigation.kind?.startsWith("spring") ? "◆" : "↗") : this.httpLine?.has(i) ? div().id(`cn-http-${i}`).w(markerWidth).flex_none().flex().justify_center().cursor_pointer()
          .tooltip(T("Run request")).on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.runRequest(i); })
          .child(toolImage("runAction", 14)) : div().w(markerWidth).flex_none().flex().justify_center()
          .when(!isIdea() && worst > 0, (e) => e.id(`cn-dg-${i}`).tooltip(problemText(diags)).child(div().size(7).rounded_full().bg(worst === 1 ? t.ansi1 : worst === 2 ? t.ansi3 : t.ansi4)));
    // Keep the old rail's space so line numbers/navigation glyphs never shift;
    // IDEA paints the actual Git marker at the shared gutter's text edge.
    const rails = [isIdea() ? div().w(4).h_full().flex_none() : this.changeMark(i, t), div().w(3).h_full().flex_none()
      .when(Boolean(picked) || this.commented?.has(i + 1), (e) => e.bg(picked ? t.accent : t.accent + "88"))];
    const gutter = isIdea() ? editorGutter(geometry, { numbers: [number()], rails, marker, edgeMark: this.changeEdge(i) }).cursor_pointer()
      .tooltip(T("Select line. Alt-click to add a review comment."))
      : h_flex().w(this.gutter()).h_full().flex_none().items_center().pr(12).cursor_pointer().children(rails).child(marker).child(number());
    return editorLine(geometry, gutter, children.length ? children : [div().child(" ")])
      .when(current, (e) => e.bg(isIdea() ? uiColors().currentLine : t.hover))
      .when(this.flash === i && !current, (e) => e.bg(t.accent + "22"))
      .when(Boolean(picked), (e) => e.bg(t.accent + "33"));
  }

  header(t) {
    const s = this.shown;
    if (!s && isIdea()) return null;
    if (isIdea()) {
      const scope = this.sel ? this.scope(this.sel.line) : [];
      const filename = (s.rel ?? s.path).split("/").pop();
      return ideaUI(h_flex()).h(Math.max(IDEA.editorBreadcrumbHeight, uiSize() + 6)).flex_none().px(8).items_center().gap(3)
        .border_b(1).border_color(uiColors().separator).bg(uiColors().editor)
        .child(h_flex().flex_1().min_w(0).items_center().gap(6).overflow_hidden().text_color(uiColors().secondary)
          .when(!scope.length, el => el.child(div().truncate().child(filename)))
          .children(scope.flatMap((sym, i) => [i ? div().flex_none().text_color(uiColors().disabled).child("›") : null,
            div().id(`cn-crumb-${i}`).flex_none().cursor_pointer().hover(el => el.text_color(uiColors().foreground))
              .on_click((_e, cx) => { this.reveal(sym.line + 1, sym.col); cx.notify(); }).child(sym.name)].filter(Boolean))))
        .when(this.diags.length > 0, el => el.child(div().id("editor-problem-count").text_size(uiSize(11)).text_color(uiDiagnosticColors(Math.min(...this.diags.map(d => d.severity ?? 1))).effect).cursor_pointer()
          .on_click(() => run("codenav.tool-problems")).child(`⚠ ${this.diags.length}`)))
        .child(iconButton("problem-previous", "chevron-up", T("Previous Problem"), (_event, cx) => { this.nextProblem(-1); cx.notify(); }, { size: 20, icon: 12 }))
        .child(iconButton("problem-next", "chevron-down", T("Next Problem"), (_event, cx) => { this.nextProblem(1); cx.notify(); }, { size: 20, icon: 12 }))
        .children([this.markdownButton(t)].filter(Boolean))
        .child(iconButton("idea-edit", "pencil", T("Edit this file"), () => this.edit(), { size: 20, icon: 12 }));
    }
    const crumbs = (s?.rel ?? tilde(s?.path ?? "")).split("/").filter(Boolean);
    // Editor tabs already carry the filename; breadcrumbs describe its context.
    if (isIdea()) crumbs.pop();
    const scope = this.sel ? this.scope(this.sel.line) : [];
    const sep = () => div().flex_none().text_color(t.dim).child("›");
    const info = this.info;
    const retry = (cx) => { this.lspError = null; this.retry = true; this.load(this.shown, cx, true); };
    const lspChip = !s ? null : s.on ? chip(T("remote · no LSP"), t.dim, T("Language servers run on this computer only"))
      : !info ? null
      : info.error ? chip(T("LSP off"), t.ansi1, T("{error} · click to retry", { error: info.error }), retry)
      : !info.lang ? (info.library ? chip(T("library source · read-only"), t.dim, T("library source · read-only")) : null)
      : !info.installed ? chip(T("{lang}: install {command}", info), t.ansi3, T("Open Installation Guide"), () => openLspSetup({ language: info.lang, root: info.root, path: s.path }))
      : this.lspError ? chip(`${info.command} ⚠`, t.ansi3, T("{error} · click to retry", { error: this.lspError }), retry)
      : chip(`${info.command}${(info.busy?.length || this.busy?.length) ? T(" · indexing") : info.state === "ready" ? "" : ` · ${info.state}`}`,
        info.state === "ready" ? t.ansi2 : t.ansi3, `${info.lang} · ${tilde(info.root)}${info.busy?.length ? ` · ${info.busy.join(", ")}` : ""}`);
    const errors = this.diags.filter((d) => d.severity === 1).length, warnings = this.diags.filter((d) => d.severity === 2).length;
    return ideaUI(h_flex()).h(isIdea() ? IDEA.toolHeaderHeight : 34).flex_none().pl(8).pr(6).gap(4).items_center().border_b(1).border_color(t.border).bg(isIdea() ? t.background : t.chrome)
      .child(h_flex().flex_1().min_w(0).gap(5).items_center().overflow_hidden().text_size(uiSize(12)).text_color(t.muted)
        .children(crumbs.flatMap((c, i) => [i ? sep() : null, div().flex_none().when(i === crumbs.length - 1, (e) => e.text_color(t.foreground).font_semibold()).child(c)]).filter(Boolean))
        .children(scope.flatMap((sym, i) => [crumbs.length || i ? sep() : div(), div().id(`cn-crumb-${i}`).flex_none().cursor_pointer().hover((e) => e.text_color(t.foreground))
          .on_click((_e, cx) => { this.reveal(sym.line + 1, sym.col); cx.notify(); }).child(`${KIND[sym.kind] ?? ""} ${sym.name}`)])))
      .when(errors + warnings > 0, (e) => e.child(chip(`${errors ? `✕ ${errors}` : ""}${errors && warnings ? "  " : ""}${warnings ? `⚠ ${warnings}` : ""}`, errors ? t.ansi1 : t.ansi3, T("Problems in this file"))))
      .when(Boolean(lspChip), (e) => e.child(lspChip))
      .child(iconButton("cn-find", "search", T("Find (Cmd+F)"), (_e, cx) => { this.finding = !this.finding; if (this.finding) this.find.focus(); else this.focus.focus(); cx.notify(); }, { color: this.finding ? t.accent : undefined }))
      .child(iconButton("cn-outline", "layers", (isIdea() ? `${T("File Structure")} (Cmd+F12)` : T("Outline (Cmd+Shift+O)")), (_e, cx) => { if (isIdea()) openEverywhere("structure"); else this.outline = !this.outline; cx.notify(); }, { color: this.outline ? t.accent : undefined }))
      .children([this.markdownButton(t)].filter(Boolean))
      .child(iconButton("cn-edit", "pencil", T("Edit this file"), () => this.edit()));
  }

  markdownButton(t) {
    if (!this.isMarkdown()) return null;
    if (isIdea()) return uiModeSwitch("cn-md", [{ id: "source", label: T("Source") }, { id: "preview", label: T("Preview") }],
      this.richView() ? "preview" : "source", (mode, _event, cx) => { if ((mode === "preview") !== this.richView()) this.toggleRich(); cx.notify(); });
    return iconButton("cn-md", "eye", T("Rich view (Ctrl+Shift+V)"), (_event, cx) => {
      this.toggleRich(); cx.notify();
    }, { ...(isIdea() ? { size: 20, icon: 12 } : {}), color: this.richView() ? t.accent : undefined });
  }

  // What the selected name is, problems on its line, and what can be done with it.
  infoBar(t) {
    // IDEA only opens documentation on an explicit request. Selection/caret
    // actions remain in the keyboard/context menu and never add an action strip.
    if (isIdea()) {
      if (!this.documentation) return null;
      const md = this.hover?.markdown;
      return ideaUI(v_flex()).id("cn-documentation").flex_none().h(220).border_t(1).border_color(uiColors().separator).bg(uiColors().editor)
        .child(sectionHeader(T("Documentation"), [iconButton("cn-documentation-x", "x", T("Close (Esc)"), (_e, cx) => {
          this.documentation = false; this.hoverGeneration = (this.hoverGeneration ?? 0) + 1; cx.notify();
        })]))
        .child(div().id("cn-info").flex_1().min_h(0).overflow_y_scrollbar().px(12).pb(10)
          .when(Boolean(md), el => el.child(TextView.markdown("cn-hover", md).selectable().text_size(uiSize(12.5))))
          .when(!md, el => el.child(div().text_size(uiSize(12)).text_color(uiColors().secondary)
            .child(this.hover?.error ?? T(this.hover ? "No documentation" : this.lspReady() && this.sel.word ? "Loading…" : "No documentation")))));
    }
    const sel = this.sel, r = this.span();
    if (!sel && !r && !this.note) return null;
    const diags = sel ? this.diags.filter((d) => d.line <= sel.line && sel.line <= d.end_line) : [];
    const md = this.hover?.markdown;
    const can = this.lspReady() && sel?.word;
    return ideaUI(v_flex()).flex_none().max_h(220).border_t(1).border_color(t.border).bg(t.chrome)
      .child(h_flex().h(30).flex_none().px(10).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(uiSize(12)).text_color(t.muted)
          .child(this.note ?? (r ? T("Lines {from}-{to} selected", { from: r[0].line + 1, to: r[1].line + 1 })
            : sel ? `${sel.word?.trim() ? `${sel.word} · ` : ""}${T("Ln {line}, Col {col}", { line: sel.line + 1, col: sel.col + 1 })}` : "")))
        .when(Boolean(can) && !r, (e) => e.children([
          button("cn-a-def", T("Definition"), (_e, cx) => this.definition(cx), { tip: T("F12 or Cmd+click") }),
          button("cn-a-type", T("Type"), (_e, cx) => this.definition(cx, "typeDefinition"), { tip: T("Go to type definition") }),
          button("cn-a-impl", T("Implementations"), (_e, cx) => this.definition(cx, "implementation"), { tip: "Cmd+F12" }),
          button("cn-a-refs", T("References"), (_e, cx) => this.references(cx), { tip: "Shift+F12" }),
        ]))
        .when(Boolean(sel || r), (e) => e.child(button("cn-a-copy", T("Copy"), () => this.copy(), { tip: "Cmd+C" })))
        .when(Boolean(sel || r) && Boolean(this.rel()), (e) => e.child(button("cn-a-comment", T("Comment"), (_e, cx) => this.commentSelection(cx), { tip: T("Comment on the selected lines (or drag over their line numbers)") })))
        .child(iconButton("cn-info-x", "x", T("Close (Esc)"), (_e, cx) => { this.closeInfo(); cx.notify(); })))
      .when(diags.length > 0 || Boolean(md) || Boolean(this.hover?.error), (e) => e.child(div().id("cn-info").flex_1().min_h(0).overflow_y_scrollbar().px(12).pb(10)
        .children(diags.map((d, i) => h_flex().gap(6).items_start().py(2).text_size(uiSize(12))
          .child(div().flex_none().text_color(d.severity === 1 ? t.ansi1 : t.ansi3).child(d.severity === 1 ? "✕" : "⚠"))
          .child(div().flex_1().min_w(0).child(`${d.message}${d.source ? `  (${d.source})` : ""}`))))
        .when(Boolean(md), (e) => e.child(TextView.markdown("cn-hover", md).selectable().text_size(uiSize(12.5))))
        .when(Boolean(this.hover?.error), (e) => e.child(div().text_size(uiSize(12)).text_color(t.dim).child(this.hover.error)))));
  }

  refsPanel(t) {
    const r = this.refs;
    if (!r) return null;
    const items = r.items ?? [];
    const root = this.shown?.root;
    const where = (p) => root && p.startsWith(root + "/") ? p.slice(root.length + 1) : tilde(p);
    return ideaUI(v_flex()).flex_none().h(220).border_t(1).border_color(t.border).bg(isIdea() ? t.background : t.chrome)
      .child(sectionHeader(r.title, [iconButton("cn-refs-x", "x", T("Close (Esc)"), (_e, cx) => { this.springGeneration = (this.springGeneration ?? 0) + 1; this.refs = null; cx.notify(); })]))
      .child(r.items === null ? div().px(12).text_size(uiSize(12)).text_color(t.dim).child(T("Searching…"))
        : r.error ? div().px(12).text_size(uiSize(12)).text_color(t.ansi1).child(r.error)
        : isIdea() && !items.length ? div().px(12).py(8).text_color(t.dim).child(T("No results"))
        : div().flex_1().min_h(0).relative()
          .child(v_virtual_list("cn-refs", items.length, isIdea() ? IDEA.rowHeight : 22, (i) => String(i), (range) => items.slice(range.start, range.end).map((it) =>
            h_flex().h(isIdea() ? IDEA.rowHeight : 22).w_full().px(12).gap(10).items_center().text_size(uiSize(12)).whitespace_nowrap()
              .child(div().flex_none().max_w(360).truncate().text_color(t.muted).child(`${where(it.path)}:${it.line + 1}`))
              .child(div().flex_1().min_w(0).truncate().font_family(codeFont().family).when(isIdea(), (e) => e.text_size(codeFont().size))
                .tooltip(it.detail ?? it.text ?? "").child([it.detail, it.text].filter(Boolean).join(" · ")))))
            .size_full().on_item_click((k, cx) => { const it = items[+k]; if (it) this.open(it, cx); cx.notify(); }))
          .child(Scrollbar.vertical("cn-refs").absolute().inset_0()));
  }

  outlinePanel(t) {
    if (isIdea() || !this.outline || !this.symbols.length) return null;
    const current = this.sel ? this.scope(this.sel.line).pop() : null;
    return ideaUI(v_flex()).w(240).flex_none().h_full().border_l(1).border_color(t.border).bg(t.chrome)
      .child(sectionHeader(T("Outline")))
      .child(div().id("cn-outline-list").flex_1().min_h(0).overflow_y_scrollbar().pb(8)
        .children(this.symbols.filter((s) => s.kind !== "variable" || s.depth === 0).slice(0, 2000).map((s, i) =>
          h_flex().id(`cn-sym-${i}`).h(22).pl(10 + s.depth * 12).pr(8).gap(6).items_center().text_size(uiSize(12)).cursor_pointer()
            .when(current === s, (e) => e.bg(t.selected))
            .hover((e) => e.bg(t.hover))
            .on_click((_e, cx) => { const cur = this.here(); if (cur) this.back.push(cur); this.reveal(s.line + 1, s.col); this.hoverAt(cx); cx.notify(); })
            .child(div().w(14).flex_none().text_center().text_size(uiSize(11)).font_bold().text_color(kindColor(s.kind, t)).child(KIND[s.kind] ?? "·"))
            .child(div().flex_none().max_w(150).truncate().child(s.name))
            .child(div().flex_1().min_w(0).truncate().text_size(uiSize(11)).text_color(t.dim).child(s.detail ?? "")))));
  }

  findBar(t) {
    if (!this.finding) return null;
    const q = this.findQuery ?? "";
    // Counted again only when the query or the file changes.
    if (this.findCount?.q !== q || this.findCount.lines !== this.lines)
      this.findCount = { q, lines: this.lines, n: q ? this.lines.reduce((n, l) => n + (l.split(q).length - 1), 0) : 0 };
    const count = this.findCount.n;
    return ideaUI(h_flex()).h(isIdea() ? IDEA.toolHeaderHeight : 34).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border).bg(isIdea() ? t.background : t.chrome)
      .child(ideaUI(div()).w(260).when(isIdea(), (e) => e.h(IDEA.inputHeight).rounded(IDEA.controlRadius)).child(Input.new(this.find).on_key_down((e, cx) => this.findKey(e, cx))))
      .child(div().text_size(uiSize(12)).text_color(t.dim).child(q ? T("{n} found", { n: count }) : ""))
      .child(iconButton("cn-find-prev", "arrow-up", T("Previous (Shift+Enter)"), (_e, cx) => { this.findNext(-1); cx.notify(); }))
      .child(iconButton("cn-find-next", "arrow-down", T("Next (Enter)"), (_e, cx) => { this.findNext(1); cx.notify(); }))
      .child(div().flex_1())
      .child(iconButton("cn-find-x", "x", T("Close (Esc)"), (_e, cx) => { this.finding = false; this.focus.focus(); cx.notify(); }));
  }

  // An item on screen: a line that takes presses and drags, or a comment under it.
  item(it, t, colors) {
    if (it.c) return commentCard(t, it.c, { pl: this.textOrigin() }).id(`cn-c-${it.c.id}`).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => { this.comment.edit(it.c); cx.notify(); });
    const i = it.line;
    return this.row(i, t, colors).id(`cn-l-${i}`).cursor_text()
      .on_mouse_down("left", (e, cx) => this.press(i, e, cx))
      .on_mouse_move((e, cx) => this.dragTo(i, e, cx))
      .on_mouse_up("left", (_e, cx) => this.pointerRelease(i, cx))
      .when(isIdea(), (e) => e.on_mouse_down("middle", (event, cx) => {
        this.focus.focus(); this.selection = null; this.dragging = null; this.gutterDrag = null;
        this.pick(i, event.local_position?.x ?? 0, cx); this.definition(cx);
        cx.stop_propagation(); cx.notify();
      }))
      .on_mouse_down("right", (e, cx) => { cx.stop_propagation(); this.pick(i, e.local_position?.x ?? 0, cx); if (isIdea()) this.openContext(); else this.hoverAt(cx); cx.notify(); });
  }

  render(cx) {
    this.sync(cx);
    this.httpLines();
    this.publish(cx);
    const t = theme(), s = this.shown, font = codeFont().family;
    // Reuse one native eligibility snapshot per frame, not one per token span.
    this.diagnosticContext = isIdea() ? { space: spaces().find(space => space.active)?.id,
      attachable: Boolean(s && this.diags.length && canAttachDiagnostics([{ on: s.on ?? null }])) } : undefined;
    const colors = syntaxColors(t);
    const measure = measureFont(this, font, codeFont().size);
    let body;
    if (!s) body = div().id("cn-empty").flex_1().min_h(0).on_mouse_down("left", () => this.focus.focus())
      .child(emptyEditor(t));
    else if (this.error) body = v_flex().p(16).gap(10).text_color(t.dim).child(this.error)
      .child(h_flex().child(button("cn-astext", T("Open in the editor"), () => this.edit(), { tip: T("The activity editor and viewers") })));
    else if (this.loading && !this.lines.length) body = div().p(16).text_color(t.dim).child(T("Loading…"));
    const items = this.items();
    this.commented = new Set(this.fileComments().flatMap((c) => Array.from({ length: c.end - c.start + 1 }, (_, k) => c.start + k)));
    if (s && !this.error && !(this.loading && !this.lines.length)) body = h_flex().flex_1().min_h(0)
      .child(v_flex().flex_1().min_w(0).h_full()
        .when(this.richView(), (e) => e.child(div().id("cn-rich").flex_1().min_h(0).overflow_y_scrollbar().bg(t.background).px(32).py(20)
          .child(div().max_w(900).child(TextView.markdown("cn-rich-md", this.text ?? "").selectable().text_size(uiSize(14))))))
        .when(!this.richView(), (e) => e.child(editorViewport("cn-view", { scroll: this.scroll, theme: t, font: codeFont(),
          gutter: this.gutter(), width: this.textOrigin() + this.width * this.cw + 40, render: k => this.item(items[k], t, colors),
          onUp: () => { this.dragging = null; this.gutterDrag = null; this.gutterSelection = null; } })))
        .child(this.comment.panel(t, this.rkey(), (cx) => cx.notify(), T("Comments go to the Review list, sent to the agent together")) ?? this.refsPanel(t) ?? this.infoBar(t) ?? div()))
      .child(this.outlinePanel(t) ?? div());
    const root = ideaUI(islandBottom(v_flex().id("codenav-code").size_full().min_h(0).relative().bg(isIdea() ? uiColors().editor : t.background)))
      .on_size_change((size) => { this.editorHeight = size.height; })
      .text_color(t.foreground).text_size(uiSize(13))
      .track_focus(this.focus).on_key_down((e, cx) => this.keyDown(e, cx))
      .child(measure)
      .child(this.header(t) ?? div())
      .child((this.http && httpBar(t, this, cx)) ?? div())
      .child(this.findBar(t) ?? div())
      .child(body)
      .when(isIdea() && Boolean(s) && this.diags.length > 0, el => el.child(div().absolute().right(1).top(IDEA.editorBreadcrumbHeight + 2).bottom(10).w(8)
        .children(this.diags.filter(d => uiDiagnosticColors(d.severity).stripe).slice(0, 300).map((diagnostic, index) => div().id(`editor-diagnostic-mark-${index}`).absolute().right(0).w(8).h(2)
          .top(Math.max(0, diagnostic.line / Math.max(1, this.lines.length) * Math.max(20, (this.editorHeight ?? 400) - 40)))
          .bg(uiDiagnosticColors(diagnostic.severity).stripe).tooltip(problemText([diagnostic])).cursor_pointer()
          .on_mouse_down("left", (_event, cx) => { cx.stop_propagation(); this.reveal(diagnostic.line + 1, diagnostic.col); cx.notify(); })))));
    const tabs = find(layout(), "editor-tabs");
    return editorSurface(root, { topCorners: !tabs || Boolean(tabs.hidden) });
  }
}

// The same registered editor group powers right-click and Settings customization.
export class EditorContextMenu {
  init(p, cx) { this.data = p ?? props(); this.menu = new MenuController(cx); this.menu.focus.focus(); }
  release() { this.menu.release(); }
  render(cx) {
    const p = this.data, context = p.context ?? {};
    const rows = groupItems("Editor.context", shared("codenav.customization") ?? {}, ACTION_GROUPS).flatMap(item => {
      if (item.kind === "separator") return [{ separator: true }];
      const action = getAction(item.action), presentation = actionPresentation(action, context);
      if (!presentation.visible) return [];
      return [{ id: item.id, label: T(action.label), disabled: !presentation.enabled,
        icon: () => toolImage(item.icon ?? action.icon, IDEA.iconSize),
        shortcut: effectiveShortcuts(action.id, keys(), { layout: "idea", mod: "codenav" }).map(formatShortcut).join(", "),
        action: () => run(`codenav.editor-action:${JSON.stringify({ identity: p.identity, at: p.at, action: action.id })}`) }];
    });
    return uiMenu("editor-context", rows, this.menu, cx, { width: 300, maxHeight: 460, onClose: () => closeOverlay(props()?.overlay) });
  }
}

// What a hover over a problem says: each message with its kind and source.
function problemText(diags) {
  return diags.map((d) => `${d.severity === 1 ? T("Error") : d.severity === 2 ? T("Warning") : T("Info")}: ${d.message}${d.source ? `  (${d.source})` : ""}`).join("\n");
}

function chip(label, color, tip, action) {
  return div().id(`cn-chip-${label}`).flex_none().h(20).px(7).flex().items_center().rounded(isIdea() ? IDEA.controlRadius : 10).text_size(uiSize(11))
    .when(!isIdea(), (e) => e.border_1().border_color(color + "66").bg(color + "14")).text_color(color).tooltip(tip)
    .when(Boolean(action), (e) => e.cursor_pointer().on_click((_e, cx) => action(cx)))
    .child(label);
}

export function kindColor(kind, t) {
  if (kind === "class" || kind === "struct" || kind === "interface" || kind === "enum") return t.ansi3;
  if (kind === "function" || kind === "method" || kind === "constructor") return t.ansi5;
  if (kind === "constant" || kind === "enum member") return t.ansi6;
  return t.ansi4;
}

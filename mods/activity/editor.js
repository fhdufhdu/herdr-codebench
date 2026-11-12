// The editor pane: one per tab, beside the terminal, like VS Code's preview
// editor. Shows what the sidebar opened (shared "activity.editor"[tab]):
// a file (editable, Ctrl+S saves, here or on an ssh machine), a viewer for
// images / PDFs / media / binary files, or a git diff.
import { div } from "gpui-kit";
import { IDEA, isIdea, uiSize, ideaUI, uiColors, uiEditorSyntax, uiButton, uiModeSwitch } from "./idea-design.js";
import { T } from "./i18n.js";
import { v_flex, h_flex, Editor, EditorState, Scrollbar, v_virtual_list, TextView, h_resizable, resizable_panel } from "gpui-base";
import { exec, readTextFile, writeTextFile, watchFolder, theme, settings, shared, setShared, props, run, panes, nextCommand, home, layout } from "herdr";
import { iconButton, icon, READ, AREA, editorKey, setEditorSpec, find } from "./common.js";
import { Viewer, viewerKind, human } from "./viewer.js";
import { writeRemoteText, stat } from "./io.js";
import { fileImage } from "./ficons/index.js";

const MD = /\.(md|markdown|mdx)$/i;
// Markdown files cycle edit → split (live preview on the right) → preview.
const MD_MODES = { edit: ["split", "split", "Side-by-side preview"], split: ["preview", "eye", "Preview only"], preview: ["edit", "file-text", "Edit only"] };

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", yml: "yaml", jsonc: "json", svelte: "html", vue: "html", htm: "html", md: "markdown", py: "python", rs: "rust", sh: "bash", zsh: "bash" };
const MAX_EDIT = 400000;
const editorFont = () => {
  const st = settings(), a = isIdea() ? shared("codenav.appearance") : null;
  return { family: a?.editorFont ?? st.font_family ?? "JetBrains Mono", size: Number(a?.editorSize ?? st.font_size) || 13 };
};
const diffHeight = () => isIdea() ? Math.round(editorFont().size * 1.55) : 20;

function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = +m[1]; next = +m[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, a: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, b: next++, text: line.slice(1) || " " };
    if (kind === " ") return { kind, a: old++, b: next++, text: line.slice(1) || " " };
    return { kind: "", text: line };
  });
}

const tilde = (p) => { const h = home(); return p?.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };

export default class EditorPane {
  init(p, cx) {
    // In the workbench's editor area (props.slot) it follows the active space;
    // as a pane it belongs to its tab.
    this.slot = Boolean(p?.slot); this.tab = p?.tab;
    this.rows = []; this.width = 0; this.pending = null; this.mdMode = isIdea() ? "edit" : "split";
    this.workspaceBuffers = new Map();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "save") this.save(cx);
        else if (c === "close") this.close();
        else if (c === "preview") this.toggleMarkdown();
        cx.notify();
      }
    });
  }

  slotKey() { return this.slot ? editorKey() : this.tab; }
  spec() { return (shared("activity.editor") ?? {})[this.slotKey()] ?? (this.slot ? null : props()?.spec ?? null); }

  publishStateFor(key, spec, dirty, saving) {
    if (!key || !spec) return;
    const all = shared("activity.editorState") ?? {};
    const next = { path: spec.path, on: spec.on ?? null, dirty: Boolean(dirty), saving: Boolean(saving) };
    if (JSON.stringify(all[key]) !== JSON.stringify(next)) setShared("activity.editorState", { ...all, [key]: next });
  }
  publishState() { if (this.code) this.publishStateFor(this.shownKey ?? this.slotKey(), this.shown, this.dirty, this.saving); }

  closeRequest() {
    const key = this.shownKey ?? this.slotKey(), request = (shared("activity.closeRequest") ?? {})[key];
    return request?.status === "pending" && request.path === this.shown?.path && (request.on ?? null) === (this.shown?.on ?? null) ? request : null;
  }
  finishClose(request, approved) {
    const key = request?.key ?? this.shownKey ?? this.slotKey(), all = shared("activity.closeRequest") ?? {};
    if (!request || all[key]?.token !== request.token) return;
    if (approved) {
      const state = (shared("activity.editorState") ?? {})[key];
      if (state?.dirty || state?.saving) return;
      setShared("activity.closeRequest", { ...all, [key]: { ...request, status: "approved" } });
      run(`codenav.close-approved:${JSON.stringify({ key, token: request.token })}`);
    } else {
      const next = { ...all }; delete next[key]; setShared("activity.closeRequest", next);
    }
  }
  cancelPending(cx) {
    const request = this.closeRequest();
    if (request) this.finishClose(request, false);
    if (this.hasPending) {
      setEditorSpec(this.shownKey ?? this.slotKey(), this.shown);
      this.key = JSON.stringify({ slot: this.shownKey, spec: this.spec() });
      this.pending = null; this.hasPending = false;
    }
    this.note = null; cx.notify();
  }

  // Loads what the sidebar asked for, unless unsaved edits are in the way.
  sync(cx) {
    const spec = this.spec(), slot = this.slotKey();
    const key = JSON.stringify({ slot, spec });
    if (key === this.key && !(this.hasPending && !this.dirty && !this.saving)) return;
    if (this.code && this.shownKey === slot && spec?.kind === "file" && this.shown?.kind === "file"
      && spec.path === this.shown.path && (spec.on ?? null) === (this.shown.on ?? null) && spec.edit === this.shown.edit) {
      // Re-selecting the same document must not replace its native buffer/undo.
      // EditorState currently has no public caret/reveal API to replay line/col.
      this.shown = spec; this.key = key; this.pending = null; this.hasPending = false;
      return;
    }
    if (this.shownKey !== undefined && this.shownKey !== slot && this.code && (this.dirty || this.saving)) {
      this.workspaceBuffers.set(this.shownKey, { code: this.code, shown: this.shown, original: this.original, readonly: this.readonly, dirty: this.dirty, saving: this.saving, note: this.note, mdMode: this.mdMode });
      this.code = null; this.dirty = false; this.saving = false; this.watched = null;
    }
    if (this.dirty || this.saving) { this.pending = spec; this.hasPending = true; return; }
    const kept = this.workspaceBuffers.get(slot);
    if (kept) {
      this.code?.release(); this.viewer?.dispose(); this.viewer = null;
      this.workspaceBuffers.delete(slot); Object.assign(this, kept); this.shownKey = slot;
      this.key = key; this.seq = (this.seq ?? 0) + 1; this.loading = false; this.error = null;
      this.pending = spec; this.hasPending = !spec || spec.path !== this.shown.path || (spec.on ?? null) !== (this.shown.on ?? null);
      if (this.hasPending && !this.dirty && !this.saving) {
        this.sync(cx);
      } else {
        this.watched = null; this.watch(this.shown, cx);
      }
      return;
    }
    this.pending = null; this.hasPending = false; this.key = key; this.shown = spec; this.shownKey = slot;
    if (isIdea()) this.mdMode = "edit";
    this.load(spec, cx);
  }

  release() {
    this.closed = true; this.watched = null; this.seq = (this.seq ?? 0) + 1;
    this.code?.release(); this.code = null;
    for (const buffer of this.workspaceBuffers?.values() ?? []) buffer.code?.release();
    this.workspaceBuffers?.clear();
  }

  load(spec, cx) {
    const seq = (this.seq = (this.seq ?? 0) + 1);
    this.error = null; this.note = null; this.dirty = false; this.saving = false; this.original = null; this.rows = []; this.viewer?.dispose(); this.viewer = null; this.code?.release(); this.code = null;
    this.closed = false;
    if (!spec) return;
    this.loading = true;
    this.watch(spec, cx);
    cx.spawn(async (cx) => {
      try {
        const alive = () => seq === this.seq;
        const kind = spec.kind === "file" && !spec.asText ? viewerKind(spec.path) : null;
        if (spec.kind === "diff") await this.loadDiff(spec, seq);
        else if (kind) this.viewer = new Viewer(kind, spec);
        else await this.loadFile(spec, seq);
        // Images, PDFs, media and files that aren't text.
        if (this.viewer && alive()) await this.viewer.load(cx, alive);
      } catch (e) { if (seq === this.seq) this.error = String(e.message ?? e); }
      finally { if (seq === this.seq) { this.loading = false; cx.notify(); } }
    });
  }

  async loadFile(spec, seq) {
    const text = await readTextFile(spec.path, { on: spec.on }).catch(() => null);
    if (seq !== this.seq || this.closed) return;
    if (text === null) {
      const info = await stat(spec.path, spec.on);
      if (!info) { this.error = "This file is no longer available"; return; }
      this.viewer = new Viewer("binary", spec, { reason: info.size > 1048576 ? `Too large to open as text (${human(info.size)}; the limit is 1 MB).` : "This file can't be read as text." });
      return;
    }
    if (text.includes("\0")) { this.viewer = new Viewer("binary", spec, { reason: "A binary file." }); return; }
    const t = theme(), name = spec.path.split("/").pop(), ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
    this.readonly = text.length > MAX_EDIT;
    this.original = text;
    this.code = EditorState.new({
      line_numbers: true, folding: true, soft_wrap: false,
      language: LANG[ext] ?? ext, readonly: this.readonly,
      value: text.length > MAX_EDIT ? text.slice(0, MAX_EDIT) + "\n… (file truncated, read-only)" : text,
      font_family: isIdea() ? editorFont().family : settings().font_family, font_size: isIdea() ? editorFont().size : 13,
      syntax: isIdea()
        ? uiEditorSyntax()
        : { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi6 },
    });
    this.publishState();
    const editor = this.code;
    this.code.on("change", (_e, cx) => {
      if (this.closed || this.code !== editor) return;
      const dirty = editor.value() !== this.original;
      if (dirty !== this.dirty) { this.dirty = dirty; this.publishState(); if (!dirty && this.hasPending) this.sync(cx); cx.notify(); }
      else if (this.mdMode !== "edit" && MD.test(spec.path)) this.livePreview(cx);
    });
  }

  // Re-renders the Markdown preview while typing, at most every 150 ms.
  livePreview(cx) {
    if (this.previewTimer) return;
    this.previewTimer = cx.timer.after(150, (cx) => { this.previewTimer = null; cx.notify(); });
  }

  async loadDiff(spec, seq) {
    let lines;
    if (spec.untracked) {
      const text = await readTextFile(spec.path, { on: spec.on });
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        const body = text.replace(/\n$/, "").split("\n").slice(0, 3000);
        lines = [`@@ -0,0 +1,${body.length} @@ new file`, ...body.map((l) => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(spec.staged ? ["--cached"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", spec.rel], { cwd: spec.root, on: spec.on });
      if (r.code !== 0) throw new Error(r.stderr.trim());
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [/Binary files/.test(r.stdout) ? "Binary file changed" : "No changes"] : all.slice(first, first + 3000);
    }
    if (seq !== this.seq) return;
    lines = lines.map((l) => l.length > 2000 ? l.slice(0, 2000) + "…" : l);
    this.rows = diffRows(lines);
    this.width = Math.max(300, ...lines.map((l) => l.length * 7.5 + 90));
  }

  // Follows the file on disk (local only): reloads when it changes and isn't being edited.
  watch(spec, cx) {
    if (spec.on) return this.poll(spec, cx);
    const dir = spec.kind === "diff" ? spec.root : spec.path.replace(/\/[^/]*$/, "");
    const key = this.key;
    if (this.watched === key) return;
    this.watched = key;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === key) {
          const changed = await watchFolder(dir);
          if (this.watched !== key || this.dirty || this.saving) continue;
          if (spec.kind === "diff" ? !changed.every((p) => p.includes("/.git/")) : changed.includes(spec.path)) {
            if (spec.kind === "file") {
              const text = await readTextFile(spec.path).catch(() => null);
              if (text === this.original || this.watched !== key || this.dirty) continue;
            }
            this.load(spec, cx); cx.notify();
          }
        }
      } catch { if (this.watched === key) this.watched = null; }
    });
  }

  // A remote file can't be watched: its change time is asked every 3 s while it's shown.
  poll(spec, cx) {
    if (spec.kind !== "file") return;
    const key = this.key;
    if (this.watched === key) return;
    this.watched = key;
    let seen = null;
    cx.spawn(async (cx) => {
      while (this.watched === key && this.key === key) {
        const info = await stat(spec.path, spec.on).catch(() => null);
        if (this.watched !== key || this.key !== key) break;
        const now = info ? `${info.mtime}:${info.size}` : "gone";
        if (seen !== null && now !== seen && !this.dirty && !this.saving) {
          if (this.code) {
            const text = await readTextFile(spec.path, { on: spec.on }).catch(() => null);
            if (text !== null && text !== this.original && !this.dirty && this.key === key) { this.load(spec, cx); this.watched = key; cx.notify(); }
          } else if (this.viewer) { this.load(spec, cx); this.watched = key; cx.notify(); }
        }
        seen = now;
        await cx.sleep(3000);
      }
    });
  }

  save(cx, closeRequest = null) {
    closeRequest ??= this.closeRequest();
    const spec = this.shown;
    if (!spec || spec.kind !== "file" || !this.code || this.readonly || this.saving) return;
    if (!this.dirty) { if (closeRequest) this.finishClose(closeRequest, true); return; }
    const editor = this.code, text = editor.value(), original = this.original, editedKey = this.shownKey ?? this.slotKey();
    let saved = false;
    this.saving = true; this.note = null; this.closeArmed = false;
    this.publishState();
    cx.spawn(async (cx) => {
      try {
        if (spec.on) await writeRemoteText(spec.path, text, original, spec.on);
        else await writeTextFile(spec.path, text, original);
        saved = true;
        // Recent Files' Only Edited filter records successful writes, scoped to
        // the editor's machine/workspace key. Failed writes never enter it.
        const edited = shared("codenav.editedFiles") ?? {};
        setShared("codenav.editedFiles", { ...edited, [editedKey]: [spec.path, ...(edited[editedKey] ?? []).filter(p => p !== spec.path)].slice(0, 200) });
        const buffer = this.code === editor ? this : this.workspaceBuffers.get(editedKey);
        if (!this.closed && buffer?.code === editor) {
          buffer.original = text; buffer.dirty = editor.value() !== text;
        }
      } catch (e) {
        const buffer = this.code === editor ? this : this.workspaceBuffers.get(editedKey);
        if (!this.closed && buffer?.code === editor) buffer.note = `Not saved: ${e.message ?? e}. Reopen the file to see the version on disk.`;
      } finally {
        const buffer = this.code === editor ? this : this.workspaceBuffers.get(editedKey);
        if (!this.closed && buffer?.code === editor) {
          buffer.saving = false;
          this.publishStateFor(editedKey, spec, buffer.dirty, false);
          const closing = closeRequest ?? (buffer === this ? this.closeRequest() : null);
          if (saved && closing) this.finishClose(closing, true);
          // A background workspace save must not navigate the visible workspace.
          if (buffer === this && !this.dirty && this.hasPending && !closing) this.sync(cx);
        }
        cx.notify();
      }
    });
    cx.notify();
  }

  discard(cx, closeRequest = null) {
    if (this.saving) return;
    this.dirty = false;
    this.publishState();
    if (closeRequest) this.finishClose(closeRequest, true);
    else if (this.hasPending) this.sync(cx);
    else this.load(this.shown, cx);
    cx.notify();
  }

  close() {
    if (this.slot) {
      if (isIdea() && (this.dirty || this.saving)) {
        const key = this.shownKey ?? this.slotKey(), s = this.shown;
        setShared("activity.closeRequest", { ...(shared("activity.closeRequest") ?? {}), [key]: { token: `${Date.now()}-${Math.random()}`, key, ids: [`f:${s.on ?? ""}:${s.path}`], path: s.path, on: s.on ?? null, status: "pending" } });
        return;
      }
      if (this.dirty && !this.closeArmed) { this.closeArmed = true; this.note = `Unsaved changes: save (${isIdea() ? "Cmd" : "Ctrl"}+S), or close again to discard them.`; return; }
      this.closeArmed = false; this.dirty = false;
      // With codenav's tab strip: an edit goes back to its code view, a viewer closes its tab.
      if (find(layout(), "editor-tabs")) {
        const { edit, ...rest } = this.shown ?? {};
        if (edit) setEditorSpec(this.slotKey(), rest);
        else run("codenav.close-tab");
        return;
      }
      setEditorSpec(this.slotKey(), null);
      run("layout.hide", { id: AREA });
      return;
    }
    const me = panes().find((p) => p.mod === "activity" && p.tab === this.tab);
    if (me) run("pane.close", { pane: me.pane });
  }

  diffRow(r, t) {
    if (r.kind === "@") return div().w_full().h(diffHeight()).px(12).flex_none().truncate().bg(t.raised).text_color(t.dim).child(r.text);
    const num = (n) => div().w(36).flex_none().text_right().text_color(t.dim).child(n === undefined ? "" : String(n));
    return h_flex().w_full().h(diffHeight()).flex_none().gap(8)
      .when(r.kind === "+", (e) => e.bg(t.ansi2 + "22")).when(r.kind === "-", (e) => e.bg(t.ansi1 + "22"))
      .child(num(r.a)).child(num(r.b))
      .child(div().w(10).flex_none().text_color(r.kind === "+" ? t.ansi2 : r.kind === "-" ? t.ansi1 : t.dim).child(r.kind === " " ? "" : r.kind))
      .child(div().flex_1().min_w(0).whitespace_nowrap().child(r.text));
  }

  toggleMarkdown() {
    if (this.shown?.kind !== "file" || !MD.test(this.shown.path) || !this.code) return;
    this.mdMode = isIdea() ? (this.mdMode === "edit" ? "preview" : "edit") : MD_MODES[this.mdMode][0];
  }

  markdownButton(t) {
    if (this.shown?.kind !== "file" || !MD.test(this.shown.path) || !this.code) return null;
    if (isIdea()) return uiModeSwitch("ed-mode", [{ id: "edit", label: T("Edit") }, { id: "preview", label: T("Preview") }],
      this.mdMode, (mode, _event, cx) => { this.mdMode = mode; cx.notify(); });
    const tip = `${MD_MODES[this.mdMode][2]} (Ctrl+Shift+V)`;
    return iconButton("ed-preview", "eye", tip, (_e, cx) => {
      this.toggleMarkdown(); cx.notify();
    }, { ...(isIdea() ? { size: 20, icon: 12 } : {}), color: this.mdMode !== "edit" ? t.accent : undefined });
  }

  render(cx) {
    this.sync(cx);
    const t = theme(), s = this.shown, idea = isIdea(), closeRequest = this.closeRequest();
    const title = s ? (idea ? s.path.split("/").pop() : s.rel ?? s.path.split("/").pop()) : "No file";
    const sub = !s ? "" : s.kind === "diff" ? (s.untracked ? "Untracked" : s.staged ? "Staged changes" : "Working tree changes")
      : `${s.on ? `${s.on}: ` : ""}${tilde(s.path)}${s.line ? ` · line ${s.line}` : ""}${this.readonly ? " · read-only" : ""}${this.viewer?.subtitle() ? ` · ${this.viewer.subtitle()}` : ""}`;
    const headerButton = idea ? { size: 20, icon: 12 } : {};
    const context = idea && this.slot && !this.viewer && s?.kind === "file"
      ? (s.rel ?? s.path).split("/").slice(0, -1).filter(Boolean).join(" › ") : sub;
    const header = ideaUI(h_flex().h(idea ? Math.max(IDEA.editorBreadcrumbHeight, uiSize() + 6) : 34).flex_none().pl(idea ? 8 : 12).pr(6).gap(8).items_center()
      .border_b(1).border_color(idea ? uiColors().separator : t.border).bg(idea ? uiColors().editor : t.chrome))
      .when(!idea || !this.slot, el => el.child(s?.kind === "file" ? fileImage(s.rel ?? s.path) : icon(s?.kind === "diff" ? "git-branch" : "file-text", 14).text_color(t.muted))
        .child(div().flex_none().max_w(320).truncate().font_semibold().child(title)))
      .when(this.dirty, (el) => el.child(div().size(8).rounded_full().bg(t.foreground).tooltip(T("Unsaved changes"))))
      .child(div().flex_1().min_w(0).truncate().text_size(uiSize(idea ? 13 : 11)).text_color(idea ? uiColors().secondary : t.dim).child(context))
      .children([this.markdownButton(t)].filter(Boolean))
      .when(this.dirty, (el) => el.child(iconButton("ed-save", "save", T(isIdea() ? "Save (Cmd+S)" : "Save (Ctrl+S)"), (_e, cx) => this.save(cx), headerButton)))
      .when(Boolean(s) && s.kind === "diff", (el) => el.child(iconButton("ed-open", "file", T("Open file"), () => {
        setEditorSpec(this.slotKey(), { kind: "file", path: s.path, root: s.root, rel: s.rel, on: s.on });
      }, headerButton)))
      .when(Boolean(this.viewer) && !this.error, (el) => el.children(this.viewer.tools(cx, t)))
      .when(this.viewer?.kind === "binary" && !this.error, (el) => el.child(iconButton("ed-astext", "file-text", T("Open as text anyway"), () => {
        setEditorSpec(this.slotKey(), { ...s, asText: true });
      }, headerButton)))
      .child(iconButton("ed-close", "x", T("Close editor"), () => this.close(), headerButton));
    let body;
    if (!s) body = div().p(16).text_color(t.dim).child(T(idea ? "Open a file from Project, Find or Commit." : "Open a file from the Explorer, Search or Source Control view."));
    else if (this.error) body = div().p(16).text_color(idea ? t.ansi1 : t.dim).child(this.error);
    else if (this.viewer) body = this.viewer.render(cx, t);
    else if (this.loading && !this.code && !this.rows.length) body = div().p(16).text_color(t.dim).child(T("Loading…"));
    else if (s.kind === "file" && this.code && this.mdMode !== "edit" && MD.test(s.path)) {
      const preview = div().id("ed-md").size_full().min_h(0).overflow_y_scrollbar().px(24).py(16).bg(idea ? uiColors().editor : t.background)
        .child(TextView.markdown("ed-md-text", this.code.value()).selectable());
      body = this.mdMode === "preview" ? div().flex_1().min_h(0).child(preview)
        : h_resizable("ed-md-split").flex_1().min_h(0)
          .child(resizable_panel().size_range(160).child(Editor.new(this.code).size_full()))
          .child(resizable_panel().size_range(160).child(div().size_full().border_l(1).border_color(t.border).child(preview)));
    }
    else if (s.kind === "file" && this.code) body = Editor.new(this.code).flex_1().min_h(0);
    else body = div().flex_1().min_h(0).relative().font_family(idea ? editorFont().family : settings().font_family ?? "JetBrains Mono").text_size(idea ? editorFont().size : 12)
      .child(div().id("ed-diff-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(idea ? Math.round(this.width * editorFont().size / 13) : this.width).h_full().child(v_virtual_list("ed-diff", this.rows.length, diffHeight(), (i) => String(i),
          (range) => this.rows.slice(range.start, range.end).map((r) => this.diffRow(r, t))).size_full())))
      .child(Scrollbar.vertical("ed-diff").viewport_from_layout().absolute().inset_0());
    return ideaUI(v_flex().id("activity-editor").size_full().min_h(0).bg(idea ? uiColors().editor : t.background).text_color(t.foreground).text_size(13))
      .child(header)
      .when(Boolean(closeRequest) || this.hasPending && this.dirty, (el) => el.child(h_flex().flex_none().px(12).py(6).gap(8).items_center().bg(t.raised).text_size(uiSize(12))
        .child(div().flex_1().child(closeRequest ? `Save changes in ${title} before closing?` : `Unsaved changes in ${title}. Save before opening ${this.pending?.rel ?? "the next file"}?`))
        .child(uiButton("ed-p-save", T("Save"), (_e, cx) => this.save(cx, closeRequest), { primary: true, small: true, disabled: this.saving }))
        .child(uiButton("ed-p-drop", T("Discard"), (_e, cx) => this.discard(cx, closeRequest), { small: true, disabled: this.saving }))
        .child(uiButton("ed-p-cancel", T("Cancel"), (_e, cx) => this.cancelPending(cx), { small: true }))))
      .when(Boolean(this.note), (el) => el.child(div().flex_none().px(12).py(6).bg(t.raised).text_size(uiSize(12)).text_color(t.ansi1).child(this.note)))
      .child(body);
  }
}

// IntelliJ's pickers, as one dialog with modes:
//   all / classes / files / symbols / actions / text — Search Everywhere (Double
//     Shift, Cmd+O, Cmd+Shift+O, Cmd+Alt+O, Cmd+Shift+A); Tab moves between them;
//     an empty query lists the recent files; "Include non-project items" adds
//     files git ignores
//   locations — Recent Locations: recorded caret stops, newest first
//   recent    — Recent Files (Cmd+E): the space's tabs, most recent first
//   structure — File Structure (Cmd+F12): the shown file's symbols
//   line      — Go to Line (Cmd+L): "line[:column]"
// Files come from git (or find) in the repository of the focused folder;
// classes and symbols from the language server's workspace/symbol.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, exec, run, commands, keys, shared, settings, focused, spaces } from "herdr";
import { T } from "./i18n.js";
import { IDEA, isIdea, uiSize, popupSurface, uiInputBox, uiListRow, uiCaption, uiSeparator, uiTab } from "./idea-design.js";
import { icon, location, openPath, editorSpec, editorKey, basename, tilde, uiFontFamily } from "./common.js";
import { lsp } from "./lsp.js";
import { ideaImage, symbolImage, toolImage } from "./ideaicons.js";
import { listActions, getAction, actionPresentation, effectiveShortcuts, formatShortcut } from "./actions.js";
import { runStore, isRunning } from "./run.js";

const TABS = ["all", "classes", "files", "symbols", "actions", "text"];
const LABEL = { all: "All", classes: "Classes", files: "Files", symbols: "Symbols", actions: "Actions", text: "Text", recent: "Recent Files", locations: "Recent Locations", structure: "File Structure", line: "Go to Line" };
const SIZE = { line: [420, 110] };

const CLASSY = new Set(["class", "interface", "enum", "struct", "object"]);
const CODE = /\.(kt|kts|java|ts|tsx|js|jsx|mjs|py|rs|go|swift)$/;
const shortcut = formatShortcut;

export function openEverywhere(mode = "all", query = "") {
  if (isIdea() && mode === "recent") return openOverlay({ mod: "codenav", props: { view: "recent", query }, kind: "dialog", frame: "none", width: 500, height: 520 });
  const [width, height] = SIZE[mode] ?? (isIdea() ? [700, 600] : [860, 560]);
  openOverlay({ mod: "codenav", props: { view: "everywhere", mode, query, context: { ...location(), terminal: focused()?.terminal ?? null } }, kind: "dialog", width, height });
}

// A loose match, IntelliJ-like, on lowercased text and name: the name holding
// the query wins, then the query's letters in order (camel humps: "nose" finds NonceService).
function score(q, s, n) {
  if (!q) return 1;
  if (n === q) return 3000;
  if (n.startsWith(q)) return 2000 - n.length;
  if (n.includes(q)) return 1500 - n.length;
  let i = 0, streak = 0, total = 0;
  for (let k = 0; k < s.length && i < q.length; k++) {
    if (s[k] === q[i]) { i++; streak++; total += streak * 2; } else streak = 0;
  }
  return i === q.length ? total - s.length / 100 : -1;
}
const low = (x) => (x ?? "").toLowerCase();

export class Everywhere {
  init(_p, cx) {
    this.focus = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    const p = props() ?? {};
    this.context = p.context ?? location();
    this.mode = p.mode ?? "all";
    this.at = 0; this.files = null; this.symbols = []; this.root = null; this.list = [];
    this.input = InputState.new({ placeholder: this.mode === "line" ? T("Line[:column]") : T("Type to search") });
    this.input.on("change", (_e, cx) => { this.querySymbols(cx); this.queryText(cx); this.refresh(cx); });
    this.input.on("submit", (_e, cx) => this.pick(this.list[this.at], cx));
    if (p.query) this.input.set_value(p.query);
    this.input.focus();
    if (["all", "classes", "files", "symbols", "text"].includes(this.mode)) this.loadFiles(cx);
    this.refresh(cx);
  }

  release() { this.released = true; this.seq++; this.tseq++; this.rseq++; this.loadSeq++; this.scroll.release(); }
  setMode(mode, cx) { this.mode = mode; this.querySymbols(cx); this.queryText(cx); this.refresh(cx); }

  loadFiles(cx) {
    const seq = this.loadSeq = (this.loadSeq ?? 0) + 1;
    const { cwd, on } = this.context;
    this.on = on;
    cx.spawn(async (cx) => {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
      if (this.released || seq !== this.loadSeq) return;
      this.root = top?.code === 0 ? top.stdout.trim() : cwd;
      const lsArgs = this.nonProject ? ["ls-files", "-co"] : ["ls-files", "-co", "--exclude-standard"];
      let r = top?.code === 0 ? await exec("git", lsArgs, { cwd: this.root, on }).catch(() => null) : null;
      if (r?.code !== 0) r = await exec("sh", ["-c", "find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | head -20000 | sed 's|^./||'"], { cwd: this.root, on }).catch(() => null);
      if (this.released || seq !== this.loadSeq) return;
      const paths = (r?.stdout ?? "").split("\n").filter(Boolean).slice(0, 60000);
      // Lowercased once: matching runs on every keystroke.
      this.files = paths.map((f) => ({ f, s: low(f), n: low(basename(f)) }));
      this.querySymbols(cx);
      this.queryText(cx);
      this.refresh(cx);
    });
  }

  // The language server answers per project; one of its files picks the server.
  querySymbols(cx) {
    const q = this.input.value().trim(), seq = (this.seq = (this.seq ?? 0) + 1);
    this.symbolsBusy = false;
    if (!["all", "classes", "symbols"].includes(this.mode) || this.on) return;
    if (q.length < 2) { this.symbols = []; return; }
    cx.timer.after(250, (cx) => cx.spawn(async (cx) => {
      if (seq !== this.seq || !this.root) return;
      const shown = editorSpec()?.path, first = this.files?.find((x) => CODE.test(x.f));
      const probe = shown?.startsWith(this.root + "/") && CODE.test(shown) ? shown : first ? `${this.root}/${first.f}` : null;
      if (!probe) return;
      this.symbolsBusy = true; cx.notify();
      const r = await lsp("workspace_symbols", { path: probe, query: q }, (ms) => cx.sleep(ms)).catch(() => []);
      if (seq !== this.seq) return;
      this.symbols = r; this.symbolsBusy = false;
      this.refresh(cx);
    }));
  }

  // The Text tab: lines holding the query (git grep, else grep), 200 at most.
  queryText(cx) {
    const q = this.input.value(), seq = (this.tseq = (this.tseq ?? 0) + 1);
    this.textBusy = false;
    if (this.mode !== "text") return;
    if (q.trim().length < 2) { this.textHits = []; return; }
    cx.timer.after(300, (cx) => cx.spawn(async (cx) => {
      if (seq !== this.tseq || !this.root) return;
      this.textBusy = true; cx.notify();
      let r = await exec("git", ["grep", "-n", "-I", "-i", "-F", "--max-count=20", "-e", q], { cwd: this.root, on: this.on }).catch(() => null);
      if (!r || (r.code !== 0 && r.code !== 1)) r = await exec("grep", ["-rnIiF", "--max-count=20", "--exclude-dir=.git", "--exclude-dir=node_modules", "-e", q, "."], { cwd: this.root, on: this.on }).catch(() => null);
      if (seq !== this.tseq) return;
      this.textHits = (r?.stdout ?? "").split("\n").filter(Boolean).slice(0, 200).map((l) => {
        const m = /^(?:\.\/)?(.*?):(\d+):(.*)$/.exec(l);
        return m ? { path: m[1], line: +m[2], text: m[3] } : null;
      }).filter(Boolean);
      this.textBusy = false;
      this.refresh(cx);
    }));
  }

  // The results for the mode and the query, worked out off the render (a large
  // repository's files in slices, so no single step runs long), then shown.
  refresh(cx) {
    const seq = (this.rseq = (this.rseq ?? 0) + 1);
    cx.spawn(async (cx) => {
      const list = await this.compute(cx, () => seq !== this.rseq);
      if (list === null || seq !== this.rseq) return;
      this.list = list;
      this.at = Math.max(0, list.findIndex((x) => x.kind !== "head"));
      this.scroll.scroll_to_item(this.at, "center");
      cx.notify();
    });
  }

  // [{kind: "head"|"file"|"symbol"|"action"|"line", title, sub, ...}], or null when overtaken.
  async compute(cx, stale) {
    const q = low(this.input.value().trim()), mode = this.mode;
    if (mode === "line") {
      const m = /^(\d+)(?::(\d+))?$/.exec(q), spec = editorSpec();
      return m && spec ? [{ kind: "line", title: T("Go to line {l}", { l: m[1] }), path: spec.path, on: spec.on ?? null, line: +m[1], col: m[2] ? +m[2] : 1 }] : [];
    }
    if (mode === "locations") {
      const saved = (shared("codenav.locations") ?? {})[editorKey()];
      return (Array.isArray(saved) ? saved : []).filter((p) => typeof p.path === "string" && Number.isInteger(p.line) && p.line >= 0)
        .slice().sort((a, b) => b.at - a.at)
        .map((p) => {
          const scope = Array.isArray(p.scope) ? p.scope.join(" › ") : "";
          return { kind: "location", title: `${basename(p.path)}:${p.line + 1}`, sub: `${p.on ? `${p.on}: ` : ""}${this.where(p.path, true)}${scope ? ` · ${scope}` : ""}`,
            path: p.path, on: p.on ?? null, line: p.line, col: p.col ?? 0, s: score(q, low(`${p.path} ${scope}`), low(basename(p.path))) };
        }).filter((p) => p.s >= 0).slice(0, 100);
    }
    const recent = () => {
      const h = (shared("codenav.history") ?? {})[editorKey()]?.list ?? [];
      const tabs = (shared("codenav.tabs") ?? {})[editorKey()] ?? [];
      const order = [...h.map((x) => x.id).reverse(), ...tabs.map((x) => x.id).reverse()];
      const seen = new Set(), list = [];
      for (const id of order) { const tab = tabs.find((x) => x.id === id); if (tab?.type === "file" && !seen.has(id)) { seen.add(id); list.push(tab.spec); } }
      return list.map((s) => ({ kind: "file", title: basename(s.path), sub: this.where(s.path, true), path: s.path, on: s.on ?? null, s: score(q, low(s.rel ?? s.path), low(basename(s.path))) }))
        .filter((x) => x.s >= 0).slice(0, 50);
    };
    if (mode === "recent" || (!q && (mode === "all" || mode === "files"))) return recent();
    if (mode === "text") return (this.textHits ?? []).map((h) => ({ kind: "text", title: h.text.trim().slice(0, 200), sub: `${h.path}:${h.line}`, path: `${this.root}/${h.path}`, line: h.line - 1, col: 0 }));
    if (mode === "structure") {
      const syms = shared("codenav.symbols"), spec = editorSpec();
      if (!syms || syms.path !== spec?.path) return [];
      return syms.items.map((s) => ({ kind: "symbol", title: s.name, sub: s.detail ?? "", symKind: s.kind, depth: q ? 0 : s.depth, path: syms.path, line: s.line, col: s.col, s: score(q, low(s.name), low(s.name)) }))
        .filter((x) => x.s >= 0).sort((a, b) => q ? b.s - a.s : 0).slice(0, 300);
    }
    let files = [];
    if (q && (mode === "files" || mode === "all")) {
      const hits = [], all = this.files ?? [];
      for (let i = 0; i < all.length; i += 2000) {
        for (const x of all.slice(i, i + 2000)) { const sc = score(q, x.s, x.n); if (sc >= 0) hits.push([sc, x.f]); }
        await cx.sleep(0);
        if (stale()) return null;
      }
      files = hits.sort((a, b) => b[0] - a[0]).slice(0, mode === "all" ? 8 : 100)
        .map(([, f]) => ({ kind: "file", title: basename(f), sub: f.includes("/") ? f.replace(/\/[^/]*$/, "") : "", path: `${this.root}/${f}` }));
    }
    const syms = (classes) => this.symbols.filter((s) => !classes || CLASSY.has(s.kind)).slice(0, mode === "all" ? 8 : 100)
      .map((s) => ({ kind: "symbol", title: s.name, sub: `${s.container ? `${s.container} · ` : ""}${this.where(s.path, true)}`, symKind: s.kind, path: s.path, line: s.line, col: s.col }));
    // Actions match on their name; the description only by the whole query.
    const actions = () => {
      if (!q && mode !== "actions") return [];
      const bindings = keys(), context = this.actionContext();
      const bound = new Map(bindings.map((k) => [k.action, k.keys]));
      const own = isIdea() ? listActions(context).map(action => {
        const presentation = actionPresentation(action, context);
        return { name: action.command, title: T(action.label), searchTitle: action.label, about: T(action.category),
          key: effectiveShortcuts(action.id, bindings, context).map(shortcut).join(" / "), icon: action.icon,
          disabled: !presentation.enabled, reason: presentation.reason, args: [] };
      }) : [];
      const ownIds = new Set(own.map(action => action.name));
      const native = commands().filter((c) => !ownIds.has(c.name) && !(c.args ?? []).some((a) => a.required))
        .map((c) => ({ ...c, title: isIdea() ? c.about || c.name.replace(/[._]/g, " ") : c.name,
          key: isIdea() ? effectiveShortcuts(c.name, bindings, context).map(shortcut).join(" / ") : bound.get(c.name) }));
      return [...own, ...native]
        .map((c) => { const s = Math.max(score(q, low(c.title), low(c.title)), score(q, low(c.searchTitle ?? ""), low(c.searchTitle ?? "")), score(q, low(c.name), low(c.name)), q && low(c.about).includes(q) ? 100 : -1); return { c, s: s >= 0 && c.name.startsWith("codenav.") ? s + 10 : s }; })
        .filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, mode === "all" ? 5 : 100)
        .map(({ c }) => ({ kind: "action", title: c.title, sub: c.disabled ? T(c.reason) : !isIdea() || ownIds.has(c.name) ? c.about : "Herdr",
          key: c.key, name: c.name, icon: c.icon, disabled: c.disabled }));
    };
    if (mode === "files") return files;
    if (mode === "classes") return syms(true);
    if (mode === "symbols") return syms(false);
    if (mode === "actions") return actions();
    const out = [];
    const groups = [["Classes", syms(true)], ["Files", files], ["Symbols", syms(false).filter((x) => !CLASSY.has(x.symKind))], ["Actions", actions()]];
    for (const [head, list] of groups) if (list.length) out.push({ kind: "head", title: T(head) }, ...list);
    return out;
  }

  where(path, folderOnly) {
    const rel = this.root && path?.startsWith(this.root + "/") ? path.slice(this.root.length + 1) : tilde(path ?? "");
    return folderOnly ? (rel.includes("/") ? rel.replace(/\/[^/]*$/, "") : "") : rel;
  }
  inProject(path) { return Boolean(this.root && path?.startsWith(this.root + "/")); }

  actionContext() {
    const store = runStore(), config = store.configs[store.selected] ?? store.configs[0];
    const document = editorSpec();
    return { layout: shared("layout"), mod: this.context?.terminal ? null : document?.edit ? "activity" : "codenav", document,
      workspace: spaces().find(space => space.active), cwd: this.context?.cwd,
      on: this.on ?? this.context?.on ?? null, terminal: this.context?.terminal,
      area: shared("codenav.area"), runConfig: config, running: Boolean(config && isRunning(config)),
      problemsOptions: shared("codenav.problemsOptions") ?? {} };
  }

  pick(r, cx) {
    if (!r || r.kind === "head" || r.disabled) return;
    if (r.kind === "action" && isIdea() && getAction(r.name) && !actionPresentation(r.name, this.actionContext()).enabled) return;
    closeOverlay(props()?.overlay);
    const on = Object.hasOwn(r, "on") ? r.on : this.on ?? null;
    if (r.kind === "file") openPath(r.path, on);
    else if (r.kind === "symbol" || r.kind === "line" || r.kind === "text" || r.kind === "location") openPath(`${r.path}:${(r.line ?? 0) + (r.kind === "line" ? 0 : 1)}:${(r.col ?? 0) + (r.kind === "line" ? 0 : 1)}`, on);
    else if (r.kind === "action") run(getAction(r.name) ? actionPresentation(r.name, this.actionContext()).command : r.name);
  }

  move(list, dir) {
    let i = this.at;
    do { i = Math.min(Math.max(i + dir, 0), list.length - 1); } while (list[i]?.kind === "head" && i > 0 && i < list.length - 1);
    if (list[i]?.kind === "head") i = list.findIndex((x) => x.kind !== "head");
    this.at = Math.max(i, 0);
  }

  render(cx) {
    const t = theme(), list = this.list, tabbed = TABS.includes(this.mode);
    const project = this.root ? basename(this.root) : "";
    const badge = (r) => {
      if (r.kind === "file" || r.kind === "text" || r.kind === "location") return ideaImage(r.path, false, 16);
      if (r.kind === "action") return toolImage(r.icon ?? "settings", 15);
      if (r.kind === "line") return icon("arrow-down", 14).text_color(t.muted);
      return symbolImage(r.symKind, r.path, 16);
    };
    const row = (r, i) => {
      if (r.kind === "head") return uiCaption(r.title).h(IDEA.rowHeight);
      const on = i === this.at;
      return uiListRow(`ev-${i}`, [], { selected: on, disabled: Boolean(r.disabled), indent: (r.depth ?? 0) * 14, interactive: true }).mx(4)
        .child(badge(r))
        .child(div().flex_none().max_w(isIdea() ? 300 : 420).truncate().text_size(isIdea() ? uiSize() : 13.5).text_color(r.disabled ? t.dim : t.foreground).child(r.title))
        .child(div().flex_1().min_w(0).truncate().text_size(uiSize(12.5)).text_color(t.dim).child(r.sub ?? ""))
        .when(Boolean(r.key), (e) => e.child(div().flex_none().text_size(uiSize(12)).text_color(t.muted).child(r.key)))
        .when((r.kind === "file" || r.kind === "symbol") && this.inProject(r.path) && Boolean(project), (e) => e
          .child(div().flex_none().max_w(200).truncate().text_size(uiSize(12.5)).text_color(t.dim).child(project))
          .child(icon("folder", 13).text_color(t.dim)));
    };
    const busy = (this.files === null && tabbed && this.mode !== "actions") || this.symbolsBusy || this.textBusy;
    const resultKey = r => JSON.stringify([r.kind, r.path ?? "", r.on ?? this.on ?? "", r.line ?? null, r.col ?? null, r.name ?? "", r.title]);
    const sel = list[this.at];
    const tab = m => uiTab(`ev-tab-${m}`, T(LABEL[m]), { selected: m === this.mode, onSelect: (_e, cx) => { this.setMode(m, cx); this.input.focus(); } });
    return v_flex().id("cn-everywhere").size_full().bg(t.popover).text_color(t.foreground).text_size(uiSize(13))
      .font_family(uiFontFamily())
      .when(isIdea(), (e) => popupSurface(e).p(4))
      .track_focus(this.focus)
      .on_key_down((e, cx) => {
        if (e.key === "pagedown" || (e.key === "down" && e.modifiers?.platform)) {
          const next = list.findIndex((r, i) => i > this.at && r.kind === "head");
          this.at = Math.max(0, next >= 0 ? Math.min(next + 1, list.length - 1) : Math.min(this.at + 10, list.length - 1));
        }
        else if (e.key === "pageup" || (e.key === "up" && e.modifiers?.platform)) {
          const heads = list.map((r, i) => r.kind === "head" && i < this.at - 1 ? i : -1).filter((i) => i >= 0);
          this.at = heads.length ? heads[heads.length - 1] + 1 : Math.max(0, this.at - 10);
        }
        else if (e.key === "down") this.move(list, 1);
        else if (e.key === "up") this.move(list, -1);
        else if (e.key === "tab" && tabbed) this.setMode(TABS[(TABS.indexOf(this.mode) + (e.modifiers?.shift ? TABS.length - 1 : 1)) % TABS.length], cx);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        this.scroll.scroll_to_item(this.at, "center");
        cx.stop_propagation(); cx.notify();
      })
      // tabs, and the non-project switch
      .child(h_flex().h(isIdea() ? 32 : 42).flex_none().px(6).gap(2).items_center()
        .when(tabbed, (e) => e.children(TABS.map(tab)))
        .when(!tabbed, (e) => e.child(div().px(6).text_size(uiSize(13)).font_semibold().child(T(LABEL[this.mode]))))
        .child(div().flex_1())
        .when(busy, (e) => e.child(div().mr(10).text_size(uiSize(11.5)).text_color(t.dim).child(T("Searching…")))))
      .child(uiSeparator())
      .when(tabbed, (e) => e.child(h_flex().id("ev-nonproject").h(24).flex_none().px(12).gap(7).items_center().cursor_pointer()
          .on_click((_e, cx) => { this.nonProject = !this.nonProject; this.files = null; this.loadFiles(cx); cx.notify(); })
          .child(div().size(15).rounded(3).border_1().border_color(this.nonProject ? t.accent : t.input).bg(this.nonProject ? t.accent : "#00000000")
            .flex().items_center().justify_center().when(Boolean(this.nonProject), (el) => el.child(icon("check", 11).text_color(t.accent_foreground))))
          .child(div().text_size(uiSize(12.5)).text_color(t.muted).child(T("Include non-project items")))))
      // the query
      .child(uiInputBox(h_flex().w_full().min_w(0).gap(8).items_center()
        .child(icon("search", 15).text_color(t.muted))
        .child(div().flex_1().min_w(0).child(Input.new(this.input)))
        .child(div().flex_none().text_size(uiSize(11.5)).text_color(t.dim).child(T("↑↓ to move · Enter to open"))), { focused: true }).mx(10).flex_none())
      .when(this.mode !== "line", (e) => e.child(v_flex().flex_1().min_h(0).mt(6).relative()
        .when(Boolean(list.length), el => el.child(v_virtual_list("ev-list", list.length, Math.max(IDEA.rowHeight, uiSize() + 8), i => resultKey(list[i]),
          range => list.slice(range.start, range.end).map((r, n) => row(r, range.start + n))).h_full().track_scroll(this.scroll)
          .on_item_click((key, eventCx) => { const index = list.findIndex(r => resultKey(r) === key); if (index < 0 || list[index].kind === "head") return; this.at = index; this.pick(list[index], eventCx); }))
          .child(Scrollbar.vertical("ev-list").absolute().inset_0()))
        .when(!list.length, el => el.child(div().px(16).py(10).text_size(uiSize(12.5)).text_color(t.dim)
          .child(this.mode === "structure" && !shared("codenav.symbols") ? T("Waiting for the language server…") : this.mode === "locations" && !this.input.value().trim() ? T("No recent locations") : T("Nothing found"))))))
      .when(this.mode === "line", (e) => e.child(div().flex_1()))
      // where the selected item is
      .child(h_flex().h(30).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border).text_size(uiSize(12))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(sel && sel.path ? tilde(sel.path) + (sel.kind !== "file" && sel.line != null ? `:${sel.line + 1}` : "") : ""))
        .when(Boolean(sel) && sel.kind !== "head", (e) => e.child(div().flex_none().text_color(t.accent).child(T("Enter to open")))));
  }
}

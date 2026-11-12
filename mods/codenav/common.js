// Shared helpers: the editor spec the workbench's views agree on (shared
// "activity.editor"), the editor area's stack, theme colors and small widgets.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { T } from "./i18n.js";
import { spaces, panes, focused, run, shared, setShared, layout, theme, home, exec, writeTextFile, appHome, settings, keys } from "herdr";
import { isIdea, IDEA, uiSize, ideaUI, uiButton, uiIconButton, uiToolHeader, uiEmptyEditor, uiEditorSyntax } from "./idea-design.js";
import { find } from "./layout-tree.js";
import { fileTabId } from "./editor-history.js";
import { effectiveShortcuts, formatShortcut, isSourceDocument } from "./actions.js";
import { uiIcon } from "./ui-icons.js";
export { find };

const MOD = "codenav";
export const icon = (name, size = 16) => name === "vscode"
  ? svg(`mods/${MOD}/icons/vscode.svg`).size(size).flex_none()
  : uiIcon(name, size);

// The codebench layout: an editor area (a column) holding the tab strip and a
// stack of the activity editor, our code view and our review view.
export const AREA = "editor-area";
export const STACK = "editor-stack";
export const CHILD = { text: "editor-text", code: "editor-code", review: "editor-review", database: "editor-database" };

export const hasArea = () => Boolean(find(layout(), STACK));

// Native host arguments have a 16-level nesting limit. A real Islands tree
// exceeds it; the CLI accepts the same command as a serialized argument.
export async function setLayout(tree) {
  const result = await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: tree })]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Could not update the layout");
}

// The editor area and the terminal panel sit in "work-body": a column puts
// them one above the other, a row side by side.
const BODY = "work-body";
export const splitDir = () => find(layout(), BODY)?.type === "row" ? "row" : "column";
export function setSplit(dir) {
  const tree = JSON.parse(JSON.stringify(layout()));
  const body = find(tree, BODY);
  if (!body || body.type === dir) return;
  body.type = dir;
  run("layout.set", { layout: tree });
}

// Where the sidebar views look: the focused terminal's folder and its machine.
const last = {};
export function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (pane && pane.terminal === null) {
    if (last[space?.id]) return last[space.id];
    const term = panes().find((p) => p.tab === pane.tab && p.terminal && p.cwd);
    if (term) return { cwd: term.cwd, on: space?.machine ?? null, space: space?.id ?? null };
  }
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const loc = { cwd: pane?.cwd || f?.cwd || space?.folder || null, on, space: space?.id ?? null };
  if (space) last[space.id] = loc;
  return loc;
}

// The same keys as the activity mod: per space in an editor area, else per tab.
export function editorKey() {
  if (find(layout(), AREA)) { const s = spaces().find((x) => x.active); return s ? `@area:${s.id}` : null; }
  return focused()?.tab ?? null;
}
export const editorSpec = (key = editorKey()) => (shared("activity.editor") ?? {})[key] ?? null;
// Caret/outline/diagnostics belong to the exact editor workspace and machine.
export function editorSnapshot(key) {
  const value = shared(key), spec = editorSpec();
  return value && spec && value.path === spec.path && (value.on ?? null) === (spec.on ?? null)
    && (!value.space || value.space === editorKey()) ? value : null;
}
export function setEditorSpec(key, spec) {
  const all = { ...(shared("activity.editor") ?? {}) };
  if (spec) all[key] = { ...spec, at: Date.now() }; else delete all[key];
  const live = new Set(spaces().flatMap((s) => [`@area:${s.id}`, ...s.tabs.map((t) => t.id)]));
  for (const k of Object.keys(all)) if (!live.has(k)) delete all[k];
  setShared("activity.editor", all);
}

// Files the activity editor shows better: pictures, PDFs, media, archives.
const isCode = (spec) => isSourceDocument(spec) && (!spec.edit || isIdea() && !spec.on);

// Which child of the editor stack should show now.
export function wantedChild() {
  const spec = editorSpec();
  const native = (shared("activity.editorState") ?? {})[editorKey()];
  const pendingClose = (shared("activity.closeRequest") ?? {})[editorKey()];
  if (isIdea() && (spec || pendingClose?.status === "pending") && (native?.dirty || native?.saving) && (shared("codenav.area") !== "review" || pendingClose?.status === "pending")) return native.owner === "codenav" ? CHILD.code : CHILD.text;
  if (spec?.kind === "database") return CHILD.database;
  if (shared("codenav.area") === "review") {
    const review = shared("codenav.review.current"), { cwd, on, space } = location();
    const at = review?.rkey?.indexOf(":") ?? -1, root = review?.rkey?.slice(at + 1);
    if (!isIdea() || (review?.path && review.space === space && review.rkey.slice(0, at) === (on ?? "") && cwd && (cwd + "/").startsWith(root + "/"))) return CHILD.review;
  }
  return isCode(spec) || (!spec && isIdea()) ? CHILD.code : CHILD.text;
}

export function showReview() {
  if (!hasArea()) return run("tab.new", { name: "Review", mod: MOD, props: { view: "review" } });
  setShared("codenav.area", "review");
  if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
  run("layout.select", { stack: STACK, child: CHILD.review });
}

export function showEditor() {
  if (shared("codenav.area")) setShared("codenav.area", null);
  run("layout.select", { stack: STACK, child: wantedChild() });
}

// Opens a file in the editor area: "<absolute path>[:line[:col]]", here or on machine `on`.
export function openPath(arg, on = null) {
  const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(arg.trim());
  if (!m?.[1]) return;
  const path = m[1], root = path.replace(/\/[^/]*$/, "");
  showEditor();
  setEditorSpec(editorKey(), { kind: "file", path, root, rel: basename(path), on, line: m[2] ? +m[2] : undefined, col: m[3] ? +m[3] - 1 : undefined });
  if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
}

// Register every dropped file together; deferred current-file registration
// must not discard the intermediate files in a multi-file gesture.
export function openFiles(paths, on = null) {
  const specs = [...new Set(paths.filter(path => typeof path === "string" && path.length))].map(path => ({ kind: "file", path, root: path.replace(/\/[^/]*$/, ""), rel: basename(path), on }));
  if (!specs.length) return;
  const key = editorKey(), all = { ...(shared("codenav.tabs") ?? {}) }, list = all[key] ?? [];
  const added = specs.map(spec => ({ id: fileTabId(spec), type: "file", spec }));
  all[key] = [...list.filter(tab => !added.some(item => item.id === tab.id)), ...added].slice(-100);
  setShared("codenav.tabs", all);
  if (shared("codenav.area")) setShared("codenav.area", null);
  setEditorSpec(key, specs[specs.length - 1]);
  showEditor();
  if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
}

// The idea layout's islands: a view at an island's bottom (or top) rounds its own corners.
export const islandBottom = (el) => isIdea() ? ideaUI(el).overflow_hidden() : el;
export const islandTop = (el) => isIdea() ? ideaUI(el).rounded_t(IDEA.islandRadius) : el;

// What an editor area with nothing open says: IntelliJ's hints in the idea layout.
export function emptyEditor(t) {
  if (shared("layout") !== "idea") return div().p(16).text_color(t.dim).child(T("Open a file from the Explorer or Search view."));
  const searchKeys = effectiveShortcuts("find-all", keys(), { layout: "idea", mod: "codenav" }).map(formatShortcut).join(" / ");
  const rows = [["Search Everywhere", searchKeys], ["Go to File", "⇧⌘O"], ["Recent Files", "⌘E"], ["Project", "⌘1"]];
  return uiEmptyEditor(rows.map(([label, key]) => [T(label), key]));
}

export const tilde = (p) => { const h = home(); return p?.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };
export const basename = (p) => (p ?? "").split("/").filter(Boolean).pop() ?? "";
export const ext = (p) => { const b = basename(p); return b.includes(".") ? b.split(".").pop().toLowerCase() : ""; };

// The person's fonts (Settings → Look): code in the code font and its size, rows
// tall enough for it; panels in the UI font.
export function codeFont() {
  const st = settings(), a = isIdea() ? shared("codenav.appearance") : null, size = Number(a?.editorSize ?? st.font_size) || 13;
  return { family: a?.editorFont ?? st.font_family ?? "JetBrains Mono", size, row: Math.round(size * 1.55) };
}
export const uiFontFamily = () => isIdea() ? shared("codenav.appearance")?.uiFont ?? settings().ui_font_family ?? ".AppleSystemUIFont" : settings().ui_font_family ?? "Geist";

// Syntax categories from the Go engine's `tokens` endpoint to theme colors.
// The idea layout: IntelliJ's dark editor colors.
export function syntaxColors(t) {
  if (shared("layout") === "idea") return uiEditorSyntax();
  return {
    keyword: t.ansi5, type: t.ansi3, constant: t.ansi6, builtin: t.ansi6, function: t.ansi4,
    decorator: t.ansi3, namespace: t.ansi4, property: t.ansi12 ?? t.ansi4, escape: t.ansi6,
    string: t.ansi2, number: t.ansi1, comment: t.dim, operator: t.muted, punctuation: t.muted,
  };
}

// The code font's advance, measured off screen into self.cw: a click's
// column comes from where the pointer was.
export const measureFont = (self, font, size) => div().absolute().top(-100).left(0).font_family(font).text_size(size).whitespace_nowrap()
  .on_size_change((s, cx) => { const cw = s.width / 100; if (cw > 1 && Math.abs(cw - (self.cw ?? 0)) > 0.01) { self.cw = cw; cx.notify(); } })
  .child("0".repeat(100));

// Puts text on the system clipboard (through a file: exec takes no input).
export async function copyText(text) {
  const dir = `${appHome()}/mods/codenav/.cache`;
  await exec("mkdir", ["-p", dir]);
  const file = `${dir}/copy-${Date.now()}.txt`;
  await writeTextFile(file, text, null);
  const r = await exec("sh", ["-c", 'if command -v pbcopy >/dev/null; then LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pbcopy < "$1"; elif command -v wl-copy >/dev/null; then wl-copy < "$1"; else xclip -selection clipboard < "$1"; fi; c=$?; rm -f "$1"; exit $c', "sh", file]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || T("Could not copy to the clipboard"));
}

// A small square icon button.
export function iconButton(id, name, tip, action, opts = {}) {
  const t = theme();
  if (isIdea()) return uiIconButton(id, icon(name, opts.icon ?? IDEA.iconSize), action,
    { tip, size: opts.size ?? IDEA.toolbarButtonSize, active: opts.active, disabled: opts.disabled })
    .when(!opts.disabled, el => el.text_color(opts.color ?? t.muted)).on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  return div().id(id).size(opts.size ?? (isIdea() ? 24 : 22)).flex_none().flex().items_center().justify_center().rounded(isIdea() ? IDEA.controlRadius : 5)
    .text_color(opts.color ?? t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
    .tooltip(tip)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
    .child(icon(name, opts.icon ?? (isIdea() ? IDEA.iconSize : 14)));
}

// A text button; `solid` for the main action.
export function button(id, label, action, opts = {}) {
  const t = theme();
  if (isIdea()) return uiButton(id, label, (event, cx) => { cx.stop_propagation(); action(event, cx); },
    { primary: Boolean(opts.solid), disabled: Boolean(opts.disabled), small: Boolean(opts.small) })
    .when(Boolean(opts.tip), el => el.tooltip(opts.tip)).on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  return ideaUI(div()).id(id).flex_none().h(isIdea() ? IDEA.inputHeight : 24).px(10).flex().items_center().rounded(isIdea() ? IDEA.controlRadius : 5).text_size(isIdea() ? uiSize() : 12).cursor_pointer()
    .when(Boolean(opts.solid), (e) => e.bg(t.solid).text_color(t.solid_foreground))
    .when(!opts.solid, (e) => e.border_1().border_color(isIdea() ? t.input : t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
    .when(Boolean(opts.tip), (e) => e.tooltip(opts.tip))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
    .child(label);
}

export function sectionHeader(title, actions = []) {
  const t = theme();
  if (isIdea()) return uiToolHeader(`section-${title}`, title, { actions });
  return ideaUI(h_flex()).h(isIdea() ? 32 : 30).flex_none().pl(12).pr(6).gap(2).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(isIdea() ? uiSize() : 11).font_semibold().text_color(isIdea() ? t.foreground : t.muted).child(isIdea() ? title : title.toUpperCase()))
    .children(actions);
}

// Display columns of a line: tabs to the next multiple of 4, wide (CJK) glyphs as 2.
const TAB = 4;
const wide = (c) => c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6));
export function expandTabs(text, startCol = 0) {
  if (!text.includes("\t")) return text;
  let out = "", col = startCol;
  for (const ch of text) {
    if (ch === "\t") { const n = TAB - (col % TAB); out += " ".repeat(n); col += n; }
    else { out += ch; col += wide(ch.codePointAt(0)) ? 2 : 1; }
  }
  return out;
}
export function displayWidth(text) {
  let col = 0;
  for (const ch of text) col += ch === "\t" ? TAB - (col % TAB) : wide(ch.codePointAt(0)) ? 2 : 1;
  return col;
}
// The UTF-16 offset in `text` under display column `target`.
export function offsetAt(text, target) {
  let col = 0, i = 0;
  for (const ch of text) {
    const w = ch === "\t" ? TAB - (col % TAB) : wide(ch.codePointAt(0)) ? 2 : 1;
    if (target < col + w) return i;
    col += w; i += ch.length;
  }
  return text.length;
}

// A line as colored pieces: toks are [utf16 length, category] from the bridge.
export function colorize(text, toks, colors) {
  if (!toks?.length) return [div().flex_none().child(expandTabs(text) || " ")];
  const out = [];
  let o = 0, col = 0;
  for (const [n, cat] of toks) {
    const piece = text.slice(o, o + n);
    o += n;
    if (!piece) continue;
    out.push(div().flex_none().when(Boolean(colors[cat]), (e) => e.text_color(colors[cat])).child(expandTabs(piece, col)));
    col += displayWidth(piece);
  }
  if (o < text.length) out.push(div().flex_none().child(expandTabs(text.slice(o), col)));
  return out.length ? out : [div().child(" ")];
}

// The identifier around a UTF-16 offset, or null.
export function wordAt(text, offset) {
  const isWord = (c) => /[\p{L}\p{N}_$]/u.test(c);
  if (offset >= text.length || !isWord(text[offset])) {
    if (offset > 0 && isWord(text[offset - 1])) offset -= 1; else return null;
  }
  let s = offset, e = offset;
  while (s > 0 && isWord(text[s - 1])) s--;
  while (e < text.length && isWord(text[e])) e++;
  return { start: s, end: e, word: text.slice(s, e) };
}

// Terminals of the shown space, agents first: where a review can be sent.
export function targets() {
  const space = spaces().find((s) => s.active);
  if (!space) return [];
  const tabs = new Map(space.tabs.map((t) => [t.id, t]));
  return panes().filter((p) => p.terminal && tabs.has(p.tab))
    .map((p) => ({ terminal: p.terminal, pane: p.pane, agent: Boolean(p.status || p.program?.agent), name: p.program?.name ?? p.title, tab: tabs.get(p.tab), active: tabs.get(p.tab).active, focused: p.focused }))
    .sort((a, b) => (b.agent - a.agent) || (b.active - a.active) || (b.focused - a.focused));
}

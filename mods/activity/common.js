// Shared helpers for every view of the activity sidebar.
import { div, svg, image } from "gpui-kit";
import { T } from "./i18n.js";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, run, shared, setShared, layout, theme } from "herdr";
import { isIdea, IDEA, uiSize, ideaUI, uiIconButton, uiToolHeader } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";

export const MOD = "activity";
export const STACK = "sidebar-views";
export const icon = (name, size = 16) => name === "vscode"
  ? svg(`mods/${MOD}/icons/vscode.svg`).size(size).flex_none()
  : uiIcon(name, size);

// Git reads that write nothing under .git, so a folder watch doesn't loop on our own refresh.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The views of the sidebar stack, in bar order.
export const VIEWS = [
  { id: "view-herdr", icon: "layers", label: "Spaces" },
  { id: "view-agents", icon: "bot", label: "Agents" },
  { id: "view-files", icon: "files", label: "Explorer" },
  { id: "view-search", icon: "search", label: "Search" },
  { id: "view-git", icon: "git-branch", label: "Source Control" },
  { id: "view-review", icon: "review", label: "Review" },
];
// The views this layout has (Review comes with the codenav mod's layouts).
export const shownViews = () => VIEWS.filter((v) => find(layout(), v.id));

export const activeView = () => find(layout(), STACK)?.active ?? VIEWS[0].id;
// The column the views are in: "tools" beside the spaces column where a layout has one.
const TOOLS = () => find(layout(), "tools") ? "tools" : "sidebar";
export const sidebarWidth = () => find(layout(), TOOLS())?.size?.px ?? Infinity;
export const narrow = () => sidebarWidth() < 160;

export function showView(view) {
  run("layout.select", { stack: STACK, child: view });
  const id = TOOLS(), column = find(layout(), id);
  if (column?.hidden) run("layout.show", { id });
  if (narrow()) {
    setShared("sidebar.collapsed", false);
    run("layout.resize", { id, px: id === "tools" ? 300 : shared("sidebar.width") ?? 268 });
  }
}

// Where the sidebar views look: the focused terminal's folder (and its machine).
// A mod pane (our own editor, a viewer) has no folder, so focusing one keeps the
// last terminal's place instead of jumping to the space's first folder.
const last = {};
export function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (pane && pane.terminal === null) {
    if (last[space?.id]) return last[space.id];
    // A terminal beside it in the same tab gives the folder.
    const term = panes().find((p) => p.tab === pane.tab && p.terminal && p.cwd);
    if (term) return { cwd: term.cwd, on: space?.machine ?? null, space: space?.id ?? null };
  }
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const loc = { cwd: pane?.cwd || f?.cwd || space?.folder || null, on, space: space?.id ?? null };
  if (space) last[space.id] = loc;
  return loc;
}
export const locationKey = () => JSON.stringify(location());

export const basename = (p) => (p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

// The workbench layout has a fixed editor area; other layouts get an editor pane.
export const AREA = "editor-area";
export const hasArea = () => Boolean(find(layout(), AREA));

// Where the shown editor's spec lives in shared "activity.editor": per space for
// the workbench's editor area, else per tab (one editor pane each).
export function editorKey() {
  if (hasArea()) { const s = spaces().find((x) => x.active); return s ? `@area:${s.id}` : null; }
  return focused()?.tab ?? null;
}
export const editorSpec = () => (shared("activity.editor") ?? {})[editorKey()] ?? null;

export function setEditorSpec(key, spec) {
  const all = { ...(shared("activity.editor") ?? {}) };
  if (spec) all[key] = { ...spec, at: Date.now() }; else delete all[key];
  // Keep only tabs and spaces that still exist.
  const live = new Set(spaces().flatMap((s) => [`@area:${s.id}`, ...s.tabs.map((t) => t.id)]));
  for (const k of Object.keys(all)) if (!live.has(k)) delete all[k];
  setShared("activity.editor", all);
}

// Opens a file (or a diff): in the workbench's editor area, else in the editor
// pane of the current tab (reused like VS Code's preview tab, else split in).
// spec: { kind: "file" | "diff", path (absolute), root, rel, on, staged?, line? }
export function openInEditor(spec) {
  const key = editorKey();
  if (!key) return;
  if (shared("codenav.area") === "review") setShared("codenav.area", null);
  setEditorSpec(key, spec);
  if (hasArea()) {
    if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
    return;
  }
  const editor = panes().find((p) => p.tab === key && p.mod === MOD);
  if (editor) run("pane.focus", { pane: editor.pane });
  else run("pane.split", { direction: "right", mod: MOD, props: { view: "editor", tab: key } });
}

// A small square icon button.
export function iconButton(id, name, tip, action, opts = {}) {
  const t = theme();
  if (isIdea()) return uiIconButton(id, icon(name, opts.icon ?? IDEA.iconSize), action,
    { tip, size: opts.size ?? IDEA.toolbarButtonSize, active: opts.active, disabled: opts.disabled })
    .when(!opts.disabled, el => el.text_color(opts.color ?? t.muted)).on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  return div().id(id).size(opts.size ?? (isIdea() ? 24 : 22)).flex_none().flex().items_center().justify_center().rounded(isIdea() ? IDEA.controlRadius : 5)
    .text_color(opts.color ?? t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
    .tooltip(T(tip))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
    .child(icon(name, opts.icon ?? (isIdea() ? IDEA.iconSize : 14)));
}

// The Project selector / view actions sit below the shared tool-window header.
export function viewHeader(title, actions = []) {
  const t = theme(), idea = isIdea();
  if (idea) return uiToolHeader(`view-${title || "actions"}`, title ? T(title) : "", { actions });
  return ideaUI(h_flex()).h(idea ? IDEA.toolHeaderHeight : 34).flex_none().pl(idea ? 12 : 14).pr(8).gap(2).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(idea ? uiSize() : 11).when(!idea, (e) => e.font_semibold()).text_color(idea ? t.foreground : t.muted).child(title ? idea ? T(title) : T(title).toUpperCase() : ""))
    .children(actions);
}

export const statusColor = (s, t) => s === "A" || s === "?" ? t.ansi2 : s === "D" || s === "U" ? t.ansi1 : s === "R" ? t.ansi4 : t.blocked;

// An agent status as Herdr's own lists draw it: a spinner while working, "!"
// when it needs you, a dot when done, a ring when idle, nothing otherwise.
export function statusMark(status, t) {
  if (status === "working") return uiIcon("progress", 12).mx(1).text_color(t.working).spin(900);
  if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done ?? t.ansi2);
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().w(14).flex_none();
}

// A program's icon from Herdr's table: a tinted glyph or a full-color picture.
export const programIcon = (p, size, color) => !p?.icon ? null
  : p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();

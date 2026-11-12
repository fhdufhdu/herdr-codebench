// Tool registry and layout commands. Views consume this state without importing each other.
import { layout, run, shared, setShared } from "herdr";
import { IDEA } from "./idea-design.js";
import { find } from "./layout-tree.js";
import { orderedTools, hideEmptyToolColumns } from "./tool-layout.js";

export const TOOLS = {
  project: { child: "view-files", icon: "folder", idea: "project", label: "Project", key: "⌘1", headerGroup: "header.Project", content: { mod: "activity", props: { view: "files" } },
    headerActions: [
      { id: "new-file", icon: "file-plus", label: "New File…", command: "activity.project-new-file" },
      { id: "new-folder", icon: "folder-plus", label: "New Folder…", command: "activity.project-new-folder" },
      { id: "refresh", icon: "refresh", label: "Refresh", command: "activity.project-refresh" },
      { id: "collapse", icon: "collapse", label: "Collapse folders", command: "activity.project-collapse" },
    ] },
  commit: { child: "view-review", icon: "git-commit", idea: "commit", label: "Commit", key: "⌘0", content: { mod: "codenav", props: { view: "review", part: "side" } } },
  structure: { child: "view-structure", icon: "layers", idea: "structure", label: "Structure", key: "⌘7" },
  find: { child: "view-search", icon: "search", idea: "find", label: "Find", key: "⌘3", content: { mod: "activity", props: { view: "search" } } },
  terminal: { child: "bottom-terminal", icon: "terminal", idea: "terminal", label: "Terminal", key: "⌥F12", get content() { return { tab: "active", pane: { background: "surface", border: { width: 0, color: "surface" }, focus: { width: 0, color: "surface" }, radius: IDEA.islandRadius, gap: IDEA.islandGap } }; } },
  problems: { child: "bottom-problems", icon: "alert", idea: "problems", label: "Problems", key: "⌘6", headerGroup: "header.Problems" },
  notifications: { child: "bottom-notifications", icon: "message", idea: "notifications", label: "Notifications", key: "", headerGroup: "header.Notifications" },
  agents: { child: "bottom-agents", icon: "terminal", idea: "services", label: "Agents", key: "", content: { mod: "codenav", props: { view: "agents" } } },
  "run-results": { child: "bottom-run-results", icon: "play", idea: "play", label: "Run Results", key: "", content: { mod: "codenav", props: { view: "run-results" } },
    headerActions: [{ id: "run-results-stop", icon: "stop", label: "Stop", command: "codenav.run-results-stop" }] },
  database: { child: "view-database", icon: "database", idea: "database", label: "Database", key: "", headerGroup: "header.Database",
    headerActions: [
      { id: "database-add", icon: "plus", label: "Add Data Source", command: "codenav.database-add" },
      { id: "database-manage", icon: "settings", label: "Manage Data Sources", command: "codenav.database-manage" },
      { id: "database-refresh", icon: "refresh", label: "Refresh", command: "codenav.database-refresh" },
    ] },
};
// The five places a tool window can be. Each stack keeps an empty child, so a
// side whose tools all moved away still has one.
export const SIDES = {
  left: { column: "left-main", outer: "sidebar", stack: "sidebar-views", empty: "left-empty", bar: "left-bar", label: "Left Upper" },
  left2: { column: "left-aux", outer: "sidebar", stack: "left2-views", empty: "left2-empty", bar: "left2-bar", label: "Left Lower" },
  right: { column: "right-main", outer: "tool-right", stack: "right-views", empty: "right-empty", bar: "right-bar", label: "Right Upper" },
  right2: { column: "right-aux", outer: "tool-right", stack: "right2-views", empty: "right2-empty", bar: "right2-bar", label: "Right Lower" },
  bottom: { column: "terminal-panel", stack: "bottom-stack", empty: "bottom-empty", bar: "bottom-bar", label: "Bottom" },
};

// Which side a tool window is on now: the stack holding it.
export function sideOf(name) {
  const l = layout(), child = TOOLS[name]?.child;
  return Object.keys(SIDES).find((k) => (find(l, SIDES[k].stack)?.children ?? []).some((c) => c.id === child)) ?? null;
}
export function toolsOn(side) {
  const children = new Set((find(layout(), SIDES[side]?.stack)?.children ?? []).map(node => node.id));
  return orderedTools(Object.keys(TOOLS).filter(name => children.has(TOOLS[name].child)), shared("codenav.toolOrder")?.[side]);
}
export function currentSides() {
  const sides = savedSides(), tree = layout();
  for (const [side, info] of Object.entries(SIDES)) {
    const children = new Set((find(tree, info.stack)?.children ?? []).map(node => node.id));
    for (const name of Object.keys(TOOLS)) if (children.has(TOOLS[name].child)) sides[name] = side;
  }
  return sides;
}

export function toolOpen(name) {
  const side = SIDES[sideOf(name)], l = layout();
  return Boolean(side && find(l, side.column) && !find(l, side.column).hidden && (!side.outer || !find(l, side.outer)?.hidden) && find(l, side.stack)?.active === TOOLS[name].child);
}
// Tool windows taken off the stripes (shared "codenav.toolHidden"); their keys still open them.
export const hiddenTools = () => new Set(shared("codenav.toolHidden") ?? []);
export function hideSlot(side) {
  const tree = layout();
  const hideOuter = side.outer && Object.values(SIDES).filter(s => s.outer === side.outer && s.column !== side.column)
    .every(s => find(tree, s.column)?.hidden === true);
  run("layout.hide", { id: side.column });
  if (hideOuter) run("layout.hide", { id: side.outer });
}
export function setToolHidden(name, hidden) {
  const set = hiddenTools();
  if (hidden === set.has(name)) return;
  hidden ? set.add(name) : set.delete(name);
  setShared("codenav.toolHidden", [...set]);
}

// Like IntelliJ's stripe buttons and Cmd+1…: shows the tool window, or folds it when it is the one showing.
export function toggleTool(name, show = false) {
  const side = SIDES[sideOf(name)], l = layout();
  const column = side && find(l, side.column), stack = side && find(l, side.stack);
  if (!column || !stack) return;
  if (toolOpen(name) && !show) return hideSlot(side);
  setToolHidden(name, false);
  if (shared("codenav.lastTool") !== name) setShared("codenav.lastTool", name);
  if (stack.active !== TOOLS[name].child) run("layout.select", { stack: side.stack, child: TOOLS[name].child });
  if (column.hidden) run("layout.show", { id: side.column });
  if (side.outer && find(l, side.outer)?.hidden) run("layout.show", { id: side.outer });
}
// Shift+Esc: folds the tool window opened last, else whichever side shows.
export function hideActiveTool() {
  const last = shared("codenav.lastTool"), l = layout();
  const side = last && toolOpen(last) ? SIDES[sideOf(last)] : ["bottom", "right", "left"].map((k) => SIDES[k]).find((x) => find(l, x.column) && !find(l, x.column).hidden);
  if (side) hideSlot(side);
}
// Puts tool windows on sides ({name: side}) in one layout edit. A moved one
// shows where it lands (with `show`); a side left with none folds.
export function arrange(want, show = false) {
  const tree = JSON.parse(JSON.stringify(layout()));
  const stack = (k) => find(tree, SIDES[k].stack), column = (k) => find(tree, SIDES[k].column);
  if (Object.keys(SIDES).some((k) => !stack(k) || !column(k))) return;
  let changed = false;
  for (const [name, to] of Object.entries(want)) {
    const from = sideOf(name), child = TOOLS[name]?.child;
    if (!from || !SIDES[to] || from === to) continue;
    const src = stack(from), node = src.children.find((c) => c.id === child);
    if (!node) continue;
    src.children = src.children.filter((c) => c.id !== child);
    if (src.active === child) src.active = src.children.find((c) => c.id !== SIDES[from].empty)?.id ?? SIDES[from].empty;
    stack(to).children = [...stack(to).children, node];
    if (show) { stack(to).active = child; column(to).hidden = false; if (SIDES[to].outer) find(tree, SIDES[to].outer).hidden = false; }
    changed = true;
  }
  if (!changed) return;
  for (const k of Object.keys(SIDES)) if (stack(k).active === SIDES[k].empty) column(k).hidden = true;
  hideEmptyToolColumns(tree);
  run("layout.set", { layout: tree });
}
export const moveTool = (name, to) => { setShared("codenav.toolSides", { ...savedSides(), [name]: to }); arrange({ [name]: to }, true); };

// The default sides (Settings → tool windows), kept in shared "codenav.toolSides".
export const DEFAULT_SIDES = { project: "left", commit: "left", structure: "left", find: "left", terminal: "bottom", problems: "bottom", notifications: "bottom", agents: "bottom", "run-results": "bottom", database: "right" };
export const savedSides = () => ({ ...DEFAULT_SIDES, ...(shared("codenav.toolSides") ?? {}) });

// Cmd+Shift+F12: every tool window away for the editor, or back as they were.
export function toggleAllTools() {
  const l = layout(), slots = Object.values(SIDES).filter(s => find(l, s.column) && !find(l, s.column).hidden && (!s.outer || !find(l, s.outer)?.hidden));
  if (slots.length) {
    const open = [...new Set(slots.flatMap(s => s.outer ? [s.outer, s.column] : [s.column]))];
    setShared("codenav.toolsHidden", open); for (const id of open) run("layout.hide", { id }); return;
  }
  for (const id of shared("codenav.toolsHidden") ?? ["sidebar", "left-main"]) if (find(l, id)) run("layout.show", { id });
}

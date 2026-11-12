// Structural edges belong to the island, not to whichever view happens to be
// active. Herdr's layout radius does not mask an editor, viewer or terminal.
import { IDEA } from "./idea-design.js";
import { ensureToolSplits, ensureBottomSpan, hideEmptyToolColumns } from "./tool-layout.js";
import { find } from "./layout-tree.js";

const EDGES = { left: "left-main", left2: "left-aux", right: "right-main", right2: "right-aux", bottom: "terminal-panel", editor: "editor-area" };
export const islandFoot = (side) => ({
  id: `island-${side}-bottom`, type: "block", size: { px: IDEA.islandRadius }, min: IDEA.islandRadius, max: IDEA.islandRadius,
  background: "canvas", content: { mod: "codenav", props: { view: "islandbottom", side } },
});

// Mutate only idea-owned chrome fields; tool ordering, sizes, active children,
// split directions, slot visibility and terminal data remain the user's.
// An outer column with both slots hidden is collapsed without touching them.
export function ensureIdeaIslands(tree) {
  let changed = ensureToolSplits(tree);
  changed = ensureBottomSpan(tree) || changed;
  changed = hideEmptyToolColumns(tree) || changed;
  const set = (node, key, value) => {
    if (JSON.stringify(node[key]) !== JSON.stringify(value)) { node[key] = value; changed = true; }
  };
  // Each island owns half the inter-island border. Root gaps also create an
  // unwanted gutter next to the stripes and status bar.
  for (const id of ["root", "body", "idea-content", "idea-upper", "work-body", "sidebar", "tool-right"]) {
    const node = find(tree, id);
    if (node) { set(node, "gap", 0); set(node, "padding", [0, 0]); }
  }
  // A zero-width separator leaves its native 6px handle over adjacent views,
  // where their input/pointer surfaces can win the hit test. Reserve the rail
  // on the actual splits; fixed stripe/header/footer edges keep their spacing.
  for (const id of ["idea-upper", "idea-content", "sidebar", "tool-right"]) {
    const node = find(tree, id);
    if (!node) continue;
    set(node, "resizable", true);
    set(node, "divider", { ...node.divider, width: Math.max(IDEA.splitterWidth, node.divider?.width ?? 0), color: node.divider?.color ?? "canvas" });
  }
  set(tree, "traffic_lights", [12, Math.round(IDEA.toolbarHeight / 2 - 7)]);
  for (const [side, id] of Object.entries(EDGES)) {
    const column = find(tree, id);
    if (!column) continue;
    set(column, "background", "canvas"); set(column, "radius", IDEA.islandRadius);
    set(column, "gap", 0);
    set(column, "padding", [IDEA.islandGap / 2, IDEA.islandGap / 2]);
    if (column.border) { delete column.border; changed = true; }
    const footer = islandFoot(side), existing = find(tree, footer.id);
    if (!existing) { column.children.push(footer); changed = true; }
    else for (const [key, value] of Object.entries(footer)) set(existing, key, value);
  }
  for (const [id, height] of [["main-toolbar", IDEA.toolbarHeight], ["status-row", IDEA.statusHeight]]) {
    const node = find(tree, id);
    if (node) set(node, "size", { px: height });
  }
  for (const id of ["stripe", "stripe-right"]) {
    const node = find(tree, id);
    if (node) { set(node, "size", { px: IDEA.stripeWidth }); set(node, "min", IDEA.stripeWidth); set(node, "max", IDEA.stripeWidth); }
  }
  const updatePanes = (node) => {
    if (node?.content?.pane) {
      set(node.content.pane, "radius", IDEA.islandRadius);
      set(node.content.pane, "gap", IDEA.islandGap);
    }
    for (const child of node?.children ?? []) updatePanes(child);
  };
  updatePanes(tree);
  const tabs = find(tree, "editor-tabs");
  if (tabs) { set(tabs, "size", { px: IDEA.tabHeight }); set(tabs, "radius", IDEA.islandRadius); }
  for (const id of ["left-bar", "left2-bar", "right-bar", "right2-bar", "bottom-bar"]) {
    const header = find(tree, id);
    if (header) { set(header, "size", { px: IDEA.toolHeaderHeight }); set(header, "background", "canvas"); set(header, "radius", IDEA.islandRadius); }
  }
  const agents = find(tree, "bottom-agents");
  if (agents?.content?.mod === "agents") set(agents, "content", { mod: "codenav", props: { view: "agents" } });
  return changed;
}

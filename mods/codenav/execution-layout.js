// One controller keeps the result tabs; the host owns the live terminal below.
// Reparent only our result block, preserving its slot, size and visibility.
import { find } from "./layout-tree.js";

export function executionTerminalLayout(tree, terminal, headerHeight) {
  let changed = false;
  let node = find(tree, "bottom-run-results");
  // Older layouts put the terminal directly beside the controls. The host
  // removes ended terminal blocks and collapses a one-child column into that
  // child, losing our result id and retaining the header's height constraints.
  if (!node) {
    const collapsed = find(tree, "execution-controls");
    if (collapsed?.type !== "block" || collapsed.content?.mod !== "codenav" || collapsed.content.props?.view !== "run-results") return false;
    node = collapsed;
    node.id = "bottom-run-results";
    delete node.min; delete node.max;
    changed = true;
  }
  if (node.type === "block" && node.content?.mod === "codenav" && node.content.props?.view === "run-results") {
    const content = node.content;
    delete node.content;
    Object.assign(node, { type: "column", gap: 0, resizable: false, children: [
      { id: "execution-controls", type: "block", content },
    ] });
    changed = true;
  }
  const controls = find(node, "execution-controls");
  if (!controls || node.type !== "column") return changed;
  // A stack survives with zero children. It prevents terminal Ended from
  // collapsing the result column and destroying its identity and panel bounds.
  let slot = find(node, "execution-output");
  if (!slot) {
    const at = node.children.findIndex(child => child.id === "execution-terminal");
    const children = at < 0 ? [] : node.children.splice(at, 1);
    slot = { id: "execution-output", type: "stack", children };
    node.children.splice(at < 0 ? node.children.indexOf(controls) + 1 : at, 0, slot);
    changed = true;
  }
  let body = find(slot, "execution-terminal");
  if (!body) {
    body = { id: "execution-terminal", type: "block" };
    slot.children.push(body);
    changed = true;
  }
  const set = (target, key, value) => {
    // Native Node serialization omits hidden:false and max:null. Compare
    // their effective values, or every published layout schedules another
    // layout.set and redraw (including during a splitter drag).
    if (key === "hidden" && Boolean(target[key]) === value) return;
    if (key === "max" && (target[key] ?? null) === value) return;
    if (JSON.stringify(target[key]) !== JSON.stringify(value)) { target[key] = value; changed = true; }
  };
  set(controls, "size", terminal ? { px: headerHeight } : { weight: 1 });
  set(controls, "min", terminal ? headerHeight : 0);
  set(controls, "max", terminal ? headerHeight : null);
  set(slot, "hidden", !terminal);
  set(body, "hidden", !terminal);
  set(body, "content", terminal || { mod: "codenav", props: { view: "toolempty" } });
  return changed;
}

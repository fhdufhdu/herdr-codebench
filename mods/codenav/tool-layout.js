// Layout migration is independent of rendering and keeps every existing node.
import { find } from "./layout-tree.js";

// Stored order may mention tools from a newer installation. Render only live
// names and append newly available tools in registry order without duplicates.
export function orderedTools(names, order = []) {
  const available = new Set(names);
  return [...new Set([...(Array.isArray(order) ? order : []).filter(name => available.has(name)), ...names])];
}

// Hidden split slots still keep their saved sizes and contents. Hide only the
// enclosing column so an empty side does not reserve horizontal space.
export function hideEmptyToolColumns(tree) {
  let changed = false;
  for (const [side, id] of [["left", "sidebar"], ["right", "tool-right"]]) {
    const outer = find(tree, id);
    if (outer && !outer.hidden && ["main", "aux"].every(slot => find(outer, `${side}-${slot}`)?.hidden === true)) {
      outer.hidden = true;
      changed = true;
    }
  }
  return changed;
}
export function ensureToolSplits(tree) {
  let changed = false;
  for (const [side, id] of [["left", "sidebar"], ["right", "tool-right"]]) {
    const outer = find(tree, id);
    if (!outer || find(outer, `${side}-main`)) continue;
    const children = outer.children;
    outer.children = [
      { id: `${side}-main`, type: "column", size: { weight: 1 }, min: 80, hidden: Boolean(outer.hidden), background: "canvas", children },
      { id: `${side}-aux`, type: "column", size: { weight: 1 }, min: 80, hidden: true, background: "canvas", children: [
        { id: `${side}2-bar`, type: "block", size: { px: 31 }, content: { mod: "codenav", props: { view: "toolheader", side: `${side}2` } } },
        { id: `${side}2-views`, type: "stack", active: `${side}2-empty`, children: [
          { id: `${side}2-empty`, type: "block", content: { mod: "codenav", props: { view: "toolempty", side: `${side}2` } } },
        ] },
      ] },
    ];
    changed = true;
  }
  return changed;
}

// IDEA's lower tool window shares the full content width, inside the stripes.
// Reparent existing nodes; never reconstruct a tool stack or its terminal data.
export function ensureBottomSpan(tree) {
  const body = find(tree, "body"), work = find(tree, "work-body");
  if (body?.type !== "row" || !Array.isArray(body.children) || !work) return false;
  const existing = find(tree, "idea-content");
  if (existing || find(tree, "idea-upper")) return false;
  const start = body.children.findIndex(node => node.id === "stripe");
  const end = body.children.findIndex(node => node.id === "stripe-right");
  const middle = body.children.slice(start + 1, end);
  const panel = work.children?.find(node => node.id === "terminal-panel");
  const editor = work.children?.find(node => node.id === "editor-area");
  // Only migrate the supported legacy split. An unfamiliar custom center is
  // kept intact instead of dropping or guessing the size of an extra child.
  if (start < 0 || end <= start || !middle.includes(work) || !panel || !editor
    || work.children.length !== 2 || work.children[0] !== editor || work.children[1] !== panel) return false;
  const upper = { id: "idea-upper", type: "row", background: "canvas", gap: 0, padding: [0, 0], children: middle };
  // The old editor's height share becomes the whole upper row's height share;
  // its original node keeps its fields and horizontal center remains work-body.
  for (const key of ["size", "min", "max"]) if (Object.prototype.hasOwnProperty.call(editor, key))
    upper[key] = editor[key] && typeof editor[key] === "object" ? { ...editor[key] } : editor[key];
  const content = { id: "idea-content", type: "column", background: "canvas", gap: 0, padding: [0, 0], children: [upper, panel] };
  // Retain each split's resizing/divider policy on the same visual axis.
  for (const key of ["resizable", "divider"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) upper[key] = body[key];
    if (Object.prototype.hasOwnProperty.call(work, key)) content[key] = work[key];
  }
  work.children = [editor];
  body.children = [...body.children.slice(0, start + 1), content, ...body.children.slice(end)];
  return true;
}

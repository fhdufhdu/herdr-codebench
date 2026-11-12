// node --experimental-vm-modules design/idea/check_project_order.mjs
// Native layout/focus delivery and core persistence still require an actual app check.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const root = new URL("../../", import.meta.url), context = vm.createContext({ console });
const plain = value => JSON.parse(JSON.stringify(value));
const source = await readFile(new URL("mods/codenav/tools.js", root), "utf8");
new vm.SourceTextModule(source, { context });
let list = [], reads = 0;
const store = { layout: "idea" }, overlays = [];
const commands = [], closes = [], scrolls = [], focusHandles = [], inputs = [];
let activeProps = { overlay: "fixture" };
const element = () => {
  const value = { nodes: [], handlers: {}, values: {} };
  const proxy = new Proxy(value, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      if (name === "child" || name === "content") target.nodes.push(args[0]);
      else if (name === "children") target.nodes.push(...args[0]);
      else if (name === "when") { if (args[0]) args[1](proxy); }
      else if (String(name).startsWith("on_")) target.handlers[name] = args.at(-1);
      else target.values[name] = args[0];
      return proxy;
    };
  } });
  return proxy;
};
const cx = { notify() {}, stop_propagation() {}, focus_handle() {
  const handle = { focus() {}, release() { this.released = true; } };
  focusHandles.push(handle); return handle;
} };
const host = {
  "gpui-kit": { div: element, PathBuilder: {} },
  "gpui-base": { v_flex: element, h_flex: element, Scrollbar: { vertical: element }, HoverCard: {}, TextView: {},
    Button: { new: id => element().id(id) },
    Select: { new: id => element().id(id) },
    Popup: { new: (id, trigger) => element().id(id).child(trigger) },
    Input: { new: state => element().input_state(state) },
    InputState: { new() {
      const state = { text: "", events: {}, on(name, callback) { this.events[name] = callback; },
        value() { return this.text; }, set_value(value) { this.text = value; }, release() { this.released = true; } };
      inputs.push(state); return state;
    } },
    VirtualListScrollHandle: { new() { const state = { positions: [], scroll_to_item(i) { this.positions.push(i); }, release() { this.released = true; } }; scrolls.push(state); return state; } },
    v_virtual_list(id, count, heights, getKey, render) { const el = element().id(id); el.getKey = getKey; el.items = render({ start: 0, end: count }); return el; },
  },
  herdr: { shared: key => store[key], settings: () => ({}), theme: () => ({}), setShared: (key, value) => { store[key] = value; }, notify() {}, playSound() {}, openOverlay: spec => overlays.push(spec),
    props: () => activeProps, closeOverlay: id => closes.push(id),
    spaces: () => { reads++; return list; },
    run(name, args) {
      commands.push({ name, args });
      if (name === "space.move") { const next = [...list], from = next.findIndex(s => s.id === args.id); next.splice(args.index - 1, 0, next.splice(from, 1)[0]); list = next; }
    },
  },
};
const cache = new Map();
async function load(id) {
  if (cache.has(id)) return cache.get(id);
  let module;
  if (host[id]) module = new vm.SyntheticModule(Object.keys(host[id]), function() { for (const [key, value] of Object.entries(host[id])) this.setExport(key, value); }, { context });
  else {
    // Isolate the owned Projects class unchanged; unrelated tools are outside this fixture.
    const text = id === "projects" ? `import {div} from "gpui-kit"; import {v_flex,h_flex,Select,Popup,Input,InputState} from "gpui-base";
      import {spaces,run,theme,props,closeOverlay,shared,setShared,openOverlay} from "herdr";
      import {IDEA,isIdea,uiManagedList,uiInputBox,uiCaption,uiSize,ideaUI,uiColors,MenuController,uiMenu,uiButton,uiToolbar,uiPopupSize,popupSurface} from "${new URL("mods/codenav/idea-design.js", root)}";
      import {projectMove,projectSortMode,sortedProjects,PROJECT_SORTS,PROJECT_SORT_KEY,PROJECT_RECENT_KEY} from "${new URL("mods/codenav/project-order.js", root)}";
      const T = text => text, tilde = text => text, avatar = () => div(), icon = () => div(), uiIcon = () => div();
      ${source.slice(source.indexOf("function projectPopupSize("), source.indexOf("function actionMenuRows("))}
      export {widgetAction};
      ${source.slice(source.indexOf("export class Projects {"))}` : await readFile(new URL(id), "utf8");
    module = new vm.SourceTextModule(text, { context, identifier: id });
  }
  cache.set(id, module);
  if (module instanceof vm.SourceTextModule) await module.link(child => load(child.startsWith(".") ? new URL(child, id).href : child));
  return module;
}
const model = await load(new URL("mods/codenav/project-order.js", root).href); await model.evaluate();
const { projectMove, sortedProjects, rememberProject, projectSortMode, PROJECT_SORT_KEY, PROJECT_RECENT_KEY } = model.namespace;
const space = (id, machine = null) => ({ id, machine, name: id, folder: `/${id}` });
list = [space("a"), space("b"), space("r/a", "r"), space("r/b", "r")];
assert.deepEqual(plain(projectMove(list, "a", 1)), { id: "a", index: 2 });
assert.deepEqual(plain(projectMove(list, "r/b", -1)), { id: "r/b", index: 3 });
for (const [id, direction] of [["missing", 1], [undefined, 1], ["a", -1], ["r/b", 1], ["b", 1], ["r/a", -1], ["b", 0], ["b", 2]]) assert.equal(projectMove(list, id, direction), null);
assert.equal(projectMove([], "a", 1), null);
assert.equal(projectMove([{ machine: null }, space("a")], undefined, 1), null);
assert.deepEqual(plain(projectMove([space("a"), { id: "b" }], "b", -1)), { id: "b", index: 1 });
const unsorted = [space("item10"), space("item2"), space("Alpha"), space("r/Z", "r"), space("r/A", "r")];
assert.deepEqual(plain(sortedProjects(unsorted, "name").map(item => item.id)), ["Alpha", "item2", "item10", "r/A", "r/Z"]);
assert.deepEqual(plain(sortedProjects(unsorted, "recent", ["r/A", "item2", "Alpha"]).map(item => item.id)), ["item2", "Alpha", "item10", "r/A", "r/Z"]);
assert.equal(sortedProjects(unsorted, "manual"), unsorted, "automatic sorting preserves the core's custom order");
assert.deepEqual(plain(rememberProject(unsorted, ["Alpha", "gone", "item2", "Alpha"], "item2")), ["item2", "Alpha"]);
assert.deepEqual(plain(rememberProject(unsorted, null, "gone")), []);
assert.equal(projectSortMode("future"), "manual");
const module = await load("projects"); await module.evaluate();
const design = await load(new URL("mods/codenav/idea-design.js", root).href);
const { Projects } = module.namespace;
const walk = (el, id) => {
  if (el.values?.id === id) return el;
  for (const child of el.nodes ?? []) { if (!child || typeof child !== "object") continue; const found = walk(child, id); if (found) return found; }
};
list = Array.from({ length: 30 }, (_, i) => ({ ...space(`p${i}`), active: i === 15 }));
module.namespace.widgetAction("project")(); assert.equal(overlays.at(-1).height, 400);
list = [space("single")]; module.namespace.widgetAction("project")();
assert.equal(overlays.at(-1).height, 2 * design.namespace.IDEA.rowHeight + 23 + Math.max(design.namespace.IDEA.toolbarHeight, design.namespace.uiSize() + 12), "IDEA popup includes one header, embedded menu padding, separator and outer border");
assert.equal(overlays.at(-1).width, 400);
list = Array.from({ length: 30 }, (_, i) => ({ ...space(`p${i}`), active: i === 15 }));
// The supported codebench layout retains its direct-reordering keyboard/toolbar.
store.layout = "codebench";
module.namespace.widgetAction("project")(); assert.equal(overlays.at(-1).width, 480, "codebench keeps its original popup width");
const view = new Projects(); view.init({}, cx); let tree = view.render(cx);
assert.equal(view.menu.at, 15);
const initialReads = reads;
// A fresh order arriving between render and activation must be respected.
list = [list[15], ...list.slice(0, 15), ...list.slice(16)];
view.move(-1, cx); assert.equal(commands.length, 0); assert.ok(reads > initialReads);
view.move(1, cx); assert.deepEqual(plain(commands.at(-1)), { name: "space.move", args: { id: "p15", index: 2 } });
assert.equal(view.menu.at, 1); assert.equal(closes.length, 0);
tree = view.render(cx); tree.handlers.on_key_down({ keystroke: "alt-down" }, cx);
assert.equal(commands.at(-1).args.index, 3); assert.equal(view.menu.at, 2);
tree = view.render(cx); walk(tree, "project-move-up").handlers.on_click({}, cx);
assert.equal(commands.at(-1).args.index, 2);
// Exercise actual shared menu handlers, including navigation, activation and Open Folder.
tree = view.render(cx); walk(tree, "project-menu").handlers.on_key_down({ keystroke: "down" }, cx); assert.equal(view.menu.at, 2);
tree = view.render(cx); walk(tree, "project-menu").handlers.on_key_down({ keystroke: "enter" }, cx);
assert.equal(commands.at(-1).name, "space.select"); assert.equal(closes.at(-1), "fixture");
tree = view.render(cx); walk(tree, "project-menu").handlers.on_key_down({ keystroke: "end" }, cx);
tree = view.render(cx); assert.equal(walk(tree, "project-move-up").handlers.on_click, undefined);
walk(tree, "project-menu").handlers.on_key_down({ keystroke: "enter" }, cx); assert.equal(commands.at(-1).name, "codenav.open-folder");
tree = view.render(cx); walk(tree, "project-menu").handlers.on_key_down({ keystroke: "escape" }, cx); assert.equal(closes.at(-1), "fixture");
walk(tree, "project-menu-list").handlers.on_item_click("pj-p0", cx); assert.equal(commands.at(-1).name, "space.select");
assert.ok(view.menu.scroll.positions.length > 2);
view.release(); assert.equal(view.menu.scroll.released, true); assert.equal(view.menu.focus.released, true);
assert.equal(view.sortMenu.scroll.released, true); assert.equal(view.sortMenu.focus.released, true); assert.equal(view.sortFocus.released, true);
const reopened = new Projects(); reopened.init({}, cx); reopened.render(cx); assert.deepEqual(reopened.list.map(s => s.id), list.map(s => s.id)); reopened.release();
// Deletion after render must not move the row which replaced the selected project.
const deleted = new Projects(); list = [{ ...space("gone"), active: true }, space("kept")]; deleted.init({}, cx); deleted.render(cx);
list = [space("kept")]; const beforeDelete = commands.length; deleted.move(1, cx); assert.equal(commands.length, beforeDelete); deleted.release();
store.layout = "idea";
list = [{ ...space("z"), active: true }, space("a"), space("b")];
const sorter = new Projects(); sorter.init({}, cx); sorter.render(cx);
sorter.sort("name", cx); assert.equal(store[PROJECT_SORT_KEY], "name");
assert.deepEqual(plain(sorter.list.map(item => item.id)), ["a", "b", "z"]); assert.equal(sorter.menu.at, 2);
const beforeSortMove = commands.length; sorter.move(-1, cx); assert.equal(commands.length, beforeSortMove, "automatic sort cannot mutate custom order");
store[PROJECT_RECENT_KEY] = ["b", "z"];
sorter.sort("recent", cx); assert.deepEqual(plain(sorter.list.map(item => item.id)), ["b", "z", "a"]); assert.equal(sorter.menu.at, 1);
const sortedReopen = new Projects(); sortedReopen.init({}, cx); assert.deepEqual(plain(sortedReopen.list.map(item => item.id)), ["b", "z", "a"]); sortedReopen.release();
const beforeManual = commands.length;
sorter.sort("manual", cx);
assert.equal(store[PROJECT_SORT_KEY], "recent", "opening manual management preserves the previous sort until Apply");
assert.deepEqual(plain(sorter.list.map(item => item.id)), ["b", "z", "a"]);
assert.equal(commands.length, beforeManual);
assert.equal(overlays.at(-1).props.manageOrder, true);
assert.equal(overlays.at(-1).height, 440, "manual management has definite bounds independent of the picker row count");
sorter.release();
store[PROJECT_SORT_KEY] = "manual";
const selector = new Projects(); selector.init({}, cx); tree = selector.render(cx);
assert.equal(walk(tree, "project-sort-control").values.accessibility_label, "Sort Order");
assert.equal(walk(tree, "project-sort-select").values.w, undefined, "the sort selector fits its current label");
assert.equal(walk(tree, "project-sort-select").values.h, 24);
assert.equal(walk(tree, "project-sort-select").values.px, 6);
assert.equal(walk(tree, "project-sort-select").values.text_size, 12, "the small sort select uses caption-sized text");
assert.equal(walk(tree, "project-sort-select").values.border_color, "#00000000");
const closesBeforeSort = closes.length;
walk(tree, "project-sort-control").handlers.on_open_change(true, cx);
assert.equal(selector.sortOpen, true); assert.equal(selector.sortMenu.at, 2);
tree = selector.render(cx);
walk(tree, "project-sort-options").handlers.on_key_down({ key: "home" }, cx);
walk(tree, "project-sort-options").handlers.on_key_down({ key: "enter" }, cx);
assert.equal(store[PROJECT_SORT_KEY], "name"); assert.equal(selector.sortOpen, false);
assert.equal(closes.length, closesBeforeSort, "choosing a sort keeps the project picker open");
tree = selector.render(cx); walk(tree, "project-sort-select").handlers.on_click({}, cx);
assert.equal(selector.sortOpen, true);
tree = selector.render(cx); walk(tree, "project-sort-options").handlers.on_key_down({ key: "escape" }, cx);
assert.equal(selector.sortOpen, false); assert.equal(closes.length, closesBeforeSort);
selector.release();

// A single parent surface contains the embedded list in both densities and
// enlarged UI text. Duplicate names retain stable ids, paths and machine tips.
const recencyList = list;
for (const compact of [true, false]) for (const uiSize of [13, 16]) {
  store["codenav.appearance"] = { compact, uiSize };
  store[PROJECT_SORT_KEY] = "manual";
  const longPath = "/workspace/" + "long-folder/".repeat(20);
  list = [{ ...space("same-local"), name: "Same Project", folder: longPath, active: true },
    { ...space("remote/same", "remote"), name: "Same Project", folder: longPath }];
  const popup = new Projects(); popup.init({}, cx); const rendered = popup.render(cx);
  const menu = walk(rendered, "project-menu"), listElement = walk(rendered, "project-menu-list");
  assert.equal(rendered.values.w, 400);
  assert.ok(Object.hasOwn(rendered.values, "border_1"), "the parent owns the only popup frame");
  assert.ok(!Object.hasOwn(menu.values, "border_1") && !Object.hasOwn(menu.values, "rounded"), "embedded menu adds no inner frame");
  assert.equal(menu.values.w, 398);
  assert.equal(rendered.values.h, menu.values.h + walk(rendered, "project-sort").values.h + 2, "one header and one border fill the explicit popup bounds");
  assert.equal(listElement.items[0].values.tooltip, `Same Project\n${longPath}`);
  assert.equal(listElement.items[1].values.tooltip, `Same Project\nremote:${longPath}`);
  assert.notEqual(listElement.getKey(0), listElement.getKey(1), "same-name remote/local projects keep separate identity");
  assert.ok(Object.hasOwn(listElement.items[0].nodes[1].values, "font_semibold"), "current project remains emphasized independently of keyboard selection");
  menu.handlers.on_key_down({ key: "down" }, cx); assert.equal(popup.menu.at, 1);
  menu.handlers.on_key_down({ key: "escape" }, cx); assert.equal(closes.at(-1), "fixture");
  popup.release();
}
delete store["codenav.appearance"];
list = [space("a"), { ...space("b"), active: true }, space("r/a", "r"), space("r/b", "r")];
store[PROJECT_SORT_KEY] = "name";
const orderPicker = new Projects(); orderPicker.init({}, cx); orderPicker.render(cx);
orderPicker.sort("manual", cx);
assert.equal(store[PROJECT_SORT_KEY], "name");
assert.equal(overlays.at(-1).props.selectedId, "b");
activeProps = { ...overlays.at(-1).props, overlay: "order-fixture" };
const manager = new Projects(); manager.init(activeProps, cx);
const keyTarget = el => el.handlers?.on_key_down ? el : (el.nodes ?? []).filter(node => node && typeof node === "object").map(keyTarget).find(Boolean);
const orderKey = key => {
  const rendered = manager.render(cx);
  assert.equal(rendered.values.id, "project-order-manager");
  keyTarget(walk(rendered, "project-order")).handlers.on_key_down({ keystroke: key }, cx);
};
const beforeDraft = commands.length;
orderKey("end"); assert.equal(manager.orderSelected, "r/b");
orderKey("alt-down"); assert.equal(manager.orderDraft.at(-1).id, "r/b", "last row cannot move down");
orderKey("home"); assert.equal(manager.orderSelected, "a");
orderKey("alt-up"); assert.equal(manager.orderDraft[0].id, "a", "first row cannot move up");
orderKey("down"); assert.equal(manager.orderSelected, "b");
orderKey("alt-up"); assert.deepEqual(plain(manager.orderDraft.map(row => row.id)), ["b", "a", "r/a", "r/b"]);
assert.equal(manager.orderSelected, "b", "movement retains item selection");
orderKey("pagedown"); assert.equal(manager.orderSelected, "r/b");
orderKey("pageup"); assert.equal(manager.orderSelected, "b");
orderKey("down"); orderKey("down"); assert.equal(manager.orderSelected, "r/a");
orderKey("alt-up"); assert.equal(manager.orderDraft[2].id, "r/a", "remote groups cannot cross the machine boundary");
manager.orderQuery.set_value("a"); manager.orderQuery.events.change({}, cx);
tree = manager.render(cx);
assert.equal(walk(tree, "project-order-move-up").values.disabled, true);
assert.equal(walk(tree, "project-order-move-down").values.disabled, true);
orderKey("alt-down"); assert.deepEqual(plain(manager.orderDraft.map(row => row.id)), ["b", "a", "r/a", "r/b"]);
manager.orderQuery.set_value("");
walk(manager.render(cx), "project-order-list").handlers.on_item_click("b", cx);
assert.equal(manager.orderSelected, "b");
const beforeRedraw = manager.orderMenu.scroll.positions.length;
manager.render(cx); manager.render(cx);
assert.equal(manager.orderMenu.scroll.positions.length, beforeRedraw, "ordinary redraw preserves manual list scroll");
assert.equal(commands.length, beforeDraft, "draft movement never dispatches a core command");
assert.equal(store[PROJECT_SORT_KEY], "name");
orderKey("escape"); assert.equal(manager.orderDraft, null); assert.equal(closes.at(-1), "order-fixture");
assert.equal(commands.length, beforeDraft); assert.equal(store[PROJECT_SORT_KEY], "name");
assert.deepEqual(plain(list.map(row => row.id)), ["a", "b", "r/a", "r/b"], "Cancel preserves core order");
manager.release();
const canceled = new Projects(); canceled.init(activeProps, cx); canceled.orderSelected = "b"; canceled.moveDraft(-1, cx);
walk(canceled.render(cx), "project-order-cancel").handlers.on_click({}, cx);
assert.equal(commands.length, beforeDraft); assert.equal(store[PROJECT_SORT_KEY], "name");
assert.deepEqual(plain(list.map(row => row.id)), ["a", "b", "r/a", "r/b"]);
canceled.release();
const applied = new Projects(); applied.init(activeProps, cx); applied.orderSelected = "b"; applied.moveDraft(-1, cx);
// Another client closes one project and opens another while the dialog is open.
list = list.filter(row => row.id !== "r/b"); list.push(space("r/new", "r"));
walk(applied.render(cx), "project-order-apply").handlers.on_click({}, cx);
assert.deepEqual(plain(list.map(row => row.id)), ["b", "a", "r/a", "r/new"]);
assert.equal(store[PROJECT_SORT_KEY], "manual"); assert.equal(closes.at(-1), "order-fixture");
assert.deepEqual(plain(commands.slice(beforeDraft)), [{ name: "space.move", args: { id: "b", index: 1 } }], "Apply reconciles live ids without moving remote/new projects");
applied.release(); orderPicker.release(); activeProps = { overlay: "fixture" }; list = recencyList;
assert.ok(focusHandles.every(handle => handle.released)); assert.ok(scrolls.every(handle => handle.released)); assert.ok(inputs.every(input => input.released));
const statusSource = await readFile(new URL("mods/codenav/status.js", root), "utf8");
assert.match(statusSource, /recordProjectUse\(this, cx\)/);
const recordSource = statusSource.slice(statusSource.indexOf("function recordProjectUse("), statusSource.indexOf("export default class Status"));
const recordModule = new vm.SourceTextModule(`import {spaces,shared,setShared} from "herdr";
  import {rememberProject,PROJECT_RECENT_KEY} from "${new URL("mods/codenav/project-order.js", root)}";
  export ${recordSource}`, { context });
await recordModule.link(load); await recordModule.evaluate();
const record = recordModule.namespace.recordProjectUse, visits = [], observer = {};
const visitCx = { timer: { after(_delay, action) { visits.push(action); } } };
store[PROJECT_RECENT_KEY] = [];
record(observer, visitCx); assert.equal(visits.length, 1); assert.deepEqual(store[PROJECT_RECENT_KEY], []);
visits.shift()(); assert.deepEqual(plain(store[PROJECT_RECENT_KEY]), ["z"]);
record(observer, visitCx); assert.equal(visits.length, 0, "ordinary redraws do not change recency");
list = list.map(item => ({ ...item, active: item.id === "a" }));
record(observer, visitCx); visits.shift()(); assert.deepEqual(plain(store[PROJECT_RECENT_KEY]), ["a", "z"]);
console.log("PASS Projects: codebench direct moves, sort/menu navigation/click/open/escape, native manual dialog keyboard/scroll, staged cancel/apply/live ids/machine boundaries, input/focus/scroll cleanup and recency");

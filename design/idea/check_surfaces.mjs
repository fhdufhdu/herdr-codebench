// Run: node --experimental-vm-modules design/idea/check_surfaces.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as registry from "../../mods/codenav/actions.js";
import * as model from "../../mods/codenav/toolbar-model.js";
import * as projectOrder from "../../mods/codenav/project-order.js";

const groups = { test: { items: [{ id: "a", kind: "action", action: "a" }, { id: "b", kind: "action", action: "b" }] } };
const initial = { schemaVersion: 1, future: 42, groups: { unknown: { future: true } } };
const edited = model.customizeGroup(initial, "test", [groups.test.items[1], { id: "custom", kind: "separator" }], groups);
assert.deepEqual(model.groupItems("test", edited, groups).map(item => item.id), ["b", "custom"]);
const updated = { test: { items: [...groups.test.items, { id: "new-default", kind: "action", action: "new" }] } };
assert.ok(model.groupItems("test", edited, updated).some(item => item.id === "new-default"), "a new default remains available after a user customization");
assert.equal(edited.future, 42); assert.equal(edited.groups.unknown.future, true);
const iconChanged = model.customizeGroup(initial, "test", [{ ...groups.test.items[0], icon: "terminal" }, groups.test.items[1]], groups);
assert.equal(model.groupItems("test", iconChanged, groups)[0].icon, "terminal", "default occurrence icon override survives delta application");
assert.throws(() => model.customizeGroup(initial, "test", [groups.test.items[0], groups.test.items[0]], groups), /Duplicate/);
const futureItem = { id: "future", kind: "extension", data: { keep: true } };
const futureDoc = { groups: { test: { added: [futureItem] } } };
assert.ok(model.customizeGroup(futureDoc, "test", model.groupItems("test", futureDoc, groups), groups).groups.test.added.some(item => item.id === "future"));
assert.equal(model.restoreKnownGroups(edited, groups).groups.unknown.future, true);

const source = await readFile(new URL("../../mods/codenav/tools.js", import.meta.url), "utf8");
const context = vm.createContext({ console, Date, Math });
const store = { layout: "idea" }, buttons = [], menus = [], opened = [], dispatched = [], copiedDiagnostics = [], attachmentRequests = [], hovers = [], taskJobs = [];
let commandResolve;
let testingRunHeader = false;
let executionState = { entries: [], selected: null };
let activeFile = { path: "/repo/App.kt", on: null }, cx, layoutTree;
function element(type = "div") {
  const state = { type, nodes: [], calls: [] };
  const proxy = new Proxy(state, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      if (name === "id") target.id = args[0];
      else if (name === "child") target.nodes.push(args[0]);
      else if (name === "children") target.nodes.push(...args[0]);
      else if (name === "when") { if (args[0]) args[1](proxy); }
      else target.calls.push([name, ...args]);
      return proxy;
    };
  } });
  return proxy;
}
const button = (id, graphic, action, options = {}) => { buttons.push({ id, graphic, action, ...options }); return element("button").id(id); };
const nodes=root=>[root,...(root.nodes??[]).filter(node=>node&&typeof node==='object').flatMap(nodes)];
const overrides = {
  ...registry, ...model, ...projectOrder,
  div: element, image: element, svg: element, v_flex: element, h_flex: element,
  Select: { new: id => element("select").id(id) },
  Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) },
  Input: { new: state => element("input").input_state(state) },
  InputState: { new() {
    return { text: "", events: {}, on(name, callback) { this.events[name] = callback; },
      value() { return this.text; }, set_value(value) { this.text = value; }, release() { this.released = true; } };
  } },
  shared: key => store[key], setShared: (key, value) => { store[key] = value; },
  layout: () => layoutTree,
  theme: () => ({}), window: () => ({ platform: "linux" }),
  spaces: () => [{ id: "one", active: true, name: "Repo", folder: "/repo", branch: "main", tabs: [] }], panes: () => [], focused: () => ({ terminal: "t1" }),
  runStore: () => ({ configs: [], selected: 0 }), isRunning: () => false,
  executionStore: () => executionState, executionBusy: entry => ["queued","running"].includes(entry?.state),
  props: () => ({}), keys: () => [{ section: "layout:idea", keys: "cmd-shift-o", action: "codenav.find-file" }],
  run: (command, args) => dispatched.push([command, args]),
  find: function find(node, id) { if(!testingRunHeader)return null; return node?.id === id ? node : (node?.children || []).map(child => find(child,id)).find(Boolean); }, editorSpec: () => activeFile, editorKey: () => "one", basename: path => path.split("/").pop(), tilde: path => path,
  editorSnapshot: key => {
    const value = store[key];
    return value && activeFile && value.path === activeFile.path && (value.on ?? null) === (activeFile.on ?? null)
      && (!value.space || value.space === "one") ? value : null;
  },
  T: value => value, icon: element, uiIcon: element, iconButton: (id, name, tip, action, options={}) => button(id,name,action,{...options,tip}), toolImage: element, ideaImage: element, symbolImage: element,
  IDEA: { iconSize: 16, toolbarButtonSize: 26, toolbarHeight: 32, rowHeight: 22, stripeWidth: 32 },
  ideaUI: el => el, popupSurface: el => el, uiColors: () => ({}), uiSize: () => 13,
  isIdea: () => store.layout === "idea",
  nextCommand: () => new Promise(resolve => { commandResolve = resolve; }),
  diagnosticKey: entry => JSON.stringify([entry.on ?? null, entry.path, entry.diagnostic.line, entry.diagnostic.message]),
  uiDiagnosticColors: severity => ({ effect: severity === 1 ? "#error" : "#warning" }),
  uiDiagnosticLabel: (_diagnostic, options) => { assert.equal(options.summary, true); return "One-line diagnostic summary"; },
  uiSelectableText: (id, text) => element("selectable").id(id).child(text),
  canAttachDiagnostics: entries => entries.length > 0,
  copyDiagnostics: entries => copiedDiagnostics.push(entries),
  requestDiagnosticAttachment: entries => attachmentRequests.push(entries),
  diagnosticCardOptions: entries => ({ entries }),
  uiDiagnosticTooltip: (id, trigger, diagnostics, options) => { hovers.push({ id, diagnostics, options }); return element("diagnostic-hover").id(id).child(trigger); },
  uiIconButton: button, uiStripeButton: button, uiButton: button, uiToolbar: (id, children) => element("toolbar").id(id).children(children), uiToolHeader: element, uiIslandBottom: element,
  uiSpinner: factory => factory().spin(1000),
  uiSeparator: element,
  uiInputBox: input => element("input-box").child(input), uiCaption: text => element("caption").child(text),
  uiManagedList: (id, rows, _controller, _cx, options) => element("managed-list").id(id).list_rows(rows).list_options(options),
  uiListRow: (id, children, opts) => element("row").id(id).row_options(opts).children(children), uiTreeRow: element, uiNoticeCard: element,
  openPath: (path, on) => opened.push({ path, on }),
  MenuController: class {
    constructor(_cx, selected = 0) { this.at = selected; this.focus = { focus() {}, release() {} }; }
    ensureVisible() {}
    release() {}
  },
  uiMenu: (_id, rows) => { menus.push(rows); return element("menu"); },
  uiPopupSize: (count, { width, maxHeight = 400, extraHeight = 14 }) => ({ width, height: Math.min(maxHeight, count * 26 + extraHeight) }),
};
async function linkRuntime(source) {
  const mod = new vm.SourceTextModule(source, { context });
  await mod.link(async id => {
    if (["./tool-windows.js", "./layout-tree.js", "./tool-layout.js"].includes(id))
      return linkRuntime(await readFile(new URL(`../../mods/codenav/${id.slice(2)}`, import.meta.url), "utf8"));
  const names = [...new Set([...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].filter(match => match[2] === id).flatMap(match => match[1].split(",").map(name => name.trim().split(/\s+as\s+/)[0])))];
  return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, overrides[name] ?? (() => {})); }, { context });
  });
  return mod;
}
const mod = await linkRuntime(source);
await mod.evaluate();
const { Toolbar, ToolHeader, Problems } = mod.namespace;
const toolbar = new Toolbar(); toolbar.init(); toolbar.width = 1600;
const toolbarTree = toolbar.render(), toolbarNodes = nodes(toolbarTree);
assert.ok(!toolbarTree.calls.some(([name, button]) => name === "on_mouse_down" && button === "right"), "toolbar no longer opens the removed customization settings page on right-click");
for (const side of ['left', 'center', 'right']) {
  const group = toolbarNodes.find(node=>node.id===`tb-group-${side}`);
  assert.ok(group.calls.some(([name])=>name==='h_full'));
  assert.ok(group.calls.some(([name])=>name==='items_center'));
}
for (const id of ['tb-project','tb-branch','tb-run-add']) {
  const widget = toolbarNodes.find(node=>node.id===id);
  assert.equal(widget.calls.find(([name])=>name==='h')[1],26,`${id} shares the toolbar control height`);
  assert.ok(nodes(widget).some(node=>node!==widget&&node.calls.some(([name])=>name==='h_full')&&node.calls.some(([name])=>name==='items_center')),`${id} text has a definite centered line box`);
}
assert.ok(buttons.some(item => item.id === "tb-search.action"));
store["codenav.customization"] = model.customizeGroup({}, "MainToolbar.right", [
  { id: "custom.goto", kind: "action", action: "codenav.find-file", icon: "terminal" },
], registry.ACTION_GROUPS);
buttons.length = 0; toolbar.render();
assert.ok(!buttons.some(item => item.id === "tb-search.action"), "the real toolbar stops rendering removed occurrences");
const goto = buttons.find(item => item.id === "tb-custom.goto");
assert.match(goto.tip, /⌘⇧O/); goto.action(); assert.equal(dispatched.at(-1)[0], "codenav.find-file");
toolbar.width = 180; buttons.length = 0; toolbar.render();
assert.ok(buttons.some(item => item.id === "tb-overflow"), "narrow window retains a reachable overflow menu");

const diagnostics = [{ severity: 2, line: 2, col: 1, source: "compiler", message: "warning" }, { severity: 1, line: 7, col: 3, source: "lint", message: "error" }];
store["codenav.problems"] = { path: "/repo/App.kt", on: null, space: "one", items: diagnostics };
const problems = new Problems();
cx = { notify() {}, stop_propagation() {}, spawn: task => taskJobs.push(task(cx)), focus_handle: () => ({ focus() {}, is_focused: () => true, release() {} }) };
problems.init({}, cx);
let rows = problems.data().rows;
problems.select(rows[0], cx); assert.equal(opened.length, 0, "selecting a problem preserves the current editor when autoscroll is off");
problems.key({ key: "enter" }, cx); assert.equal(opened.at(-1).path, "/repo/App.kt:3:2");
store["codenav.problemsOptions"] = { autoscroll: true, errorsOnly: true };
rows = problems.data().rows; assert.equal(rows.length, 1);
problems.select(rows[0], cx); assert.equal(opened.at(-1).path, "/repo/App.kt:8:4");
const fullMessage = "No overload matches this call.\n  Overload 1: nested detail\r\n  Overload 2: another detail";
diagnostics[1].message = fullMessage;
const problemTree = nodes(problems.render());
const renderedProblem = problemTree.find(node => node.type === "row" && node.id.startsWith("problem-["));
assert.ok(renderedProblem.calls.some(([name]) => name === "overflow_hidden"), "diagnostic rows clip their fixed-height contents");
const summaryBox = renderedProblem.nodes[1], summaryText = summaryBox.nodes[0];
assert.ok(summaryBox.calls.some(([name]) => name === "h_full") && summaryBox.calls.some(([name]) => name === "overflow_hidden"));
assert.equal(summaryText.type, "selectable"); assert.equal(summaryText.nodes[0], "One-line diagnostic summary");
assert.ok(summaryText.calls.some(([name]) => name === "truncate") && summaryText.calls.some(([name]) => name === "whitespace_nowrap"));
assert.equal(hovers.at(-1).diagnostics[0].message, fullMessage, "full multiline text remains in hover content");
buttons.find(item => item.id.startsWith("problem-copy-")).action({}, cx);
assert.equal(copiedDiagnostics.at(-1)[0].diagnostic.message, fullMessage);
buttons.find(item => item.id.startsWith("problem-attach-")).action({}, cx);
assert.equal(attachmentRequests.at(-1)[0].path, "/repo/App.kt");
commandResolve("problems-copy-all"); await new Promise(resolve => setImmediate(resolve));
assert.equal(copiedDiagnostics.at(-1).length, 1, "shared header copy reaches the real owner and follows current Errors Only filter");
commandResolve("problems-attach-all"); await new Promise(resolve => setImmediate(resolve));
assert.equal(attachmentRequests.at(-1).length, 1);
store["codenav.problemsOptions"] = {};
commandResolve("problems-copy-all"); await new Promise(resolve => setImmediate(resolve));
assert.equal(copiedDiagnostics.at(-1).length, 2, "all shown diagnostic entries copied without truncating their messages");
store["codenav.problemsScope"] = "project";
store["codenav.problemFiles"] = {
  first: store["codenav.problems"],
  second: { path: "/repo/Other.kt", on: null, space: "one", items: [{ severity: 2, line: 0, col: 0, message: "Other file\nAll details" }] },
  foreign: { path: "/elsewhere/Private.kt", on: null, space: "another-space", items: diagnostics },
};
assert.equal(problems.data().rows.length, 3, "project selection contains both local files");
commandResolve("problems-copy-all"); await new Promise(resolve => setImmediate(resolve));
assert.equal(copiedDiagnostics.at(-1).length, 3, "project scope copies all known shown files while excluding another workspace");
assert.equal(copiedDiagnostics.at(-1)[2].diagnostic.message, "Other file\nAll details");
store["codenav.problemsScope"] = "file";
activeFile = { path: "/repo/App.kt", on: "other-machine" };
assert.equal(problems.data().rows.length, 0, "same path from a different machine is not this file's diagnostics");
problems.release();
console.log("PASS customization deltas, future/default preservation, actual toolbar rendering/dispatch/overflow, Problems selection/activation/autoscroll/filter/machine scope");

layoutTree={id:'root',children:[
  {id:'sidebar-views',children:[{id:'view-files'}]}, {id:'left2-views',children:[{id:'view-structure'}]},
  {id:'right-views',children:[{id:'view-review'}]}, {id:'right2-views',children:[{id:'view-search'}]},
  {id:'bottom-stack',children:[{id:'bottom-terminal'}]},
]};
const left=new mod.namespace.Stripe();left.init({side:'left'});
for (const edge of ['left','right']) {
  const stripe=new mod.namespace.Stripe();stripe.init({side:edge});
  const first=buttons.length;
  const rendered=stripe.render(cx), all=nodes(rendered);
  assert.ok(buttons.slice(first).filter(button=>button.id.startsWith('st-')).every(button=>button.side===edge),'both stripe sides declare their mirrored shell-facing fill alignment');
  assert.ok(all.some(node=>node.id===`stripe-${edge}-slots`),'upper and lower tool groups have a separator on each edge');
  assert.ok(!all.some(node=>node.calls.some(call=>['on_mouse_move','on_mouse_up'].includes(call[0]))),'tool stripes cannot start or finish a drag');
}
store['codenav.toolHidden']=['structure'];
assert.ok(!nodes(left.render(cx)).some(node=>node.id==='stripe-left-slots'),'hidden lower groups leave no orphan separator');
store['codenav.toolHidden']=[];
for (const side of ['left','right','left2','right2','bottom','editor']) {
  const bottom=new mod.namespace.IslandBottom();bottom.init({side});
  assert.ok(!nodes(bottom.render()).some(node=>node.calls.some(([name])=>name==='border_b')),'island foot never adds a bright seam above a neighboring island');
}
assert.doesNotMatch(source,/\b(?:beginDrag|takeDrag|advanceDrag|dragState|cancelDrag)\b/,'stripes no longer depend on a drag subsystem');
const projects=new mod.namespace.Projects();projects.init({},cx);projects.render(cx);
menus.at(-1).find(row=>row.id==='pj-open').action();
assert.equal(dispatched.at(-1)[0],'codenav.open-folder','closing project menu delegates picker work to the persistent view');
projects.release();
console.log('PASS drag removal, upper/lower separators on both edges, hidden groups and folder action routing');
const toolHeader=new mod.namespace.ToolHeader();
for(const status of ['working','idle','done','blocked']){
 const tab=toolHeader.tab({id:'agent-tab',name:'Task',status,active:false},{});
 const rotating=nodes(tab).filter(node=>node.calls.some(([name])=>name==='spin'));
 assert.equal(rotating.length,status==='working'?1:0,'only actual working state animates');
 if(rotating.length)assert.equal(rotating[0].type,'progress');
}

// A shared header must reflect the selected execution, not a running config elsewhere.
testingRunHeader=true;
layoutTree={id:"root",children:[{id:"terminal-panel",hidden:false,children:[{id:"bottom-stack",active:"bottom-run-results",children:[{id:"bottom-run-results"}]}]}]};
toolHeader.init({side:"bottom"});
for(const entry of [null,{id:"result",state:"completed"},{id:"result",state:"untracked"},{id:"result",state:"running",stopRequested:true},{id:"result",state:"running"}]){
 executionState={entries:entry?[entry]:[],selected:entry?.id||null};buttons.length=0;toolHeader.render();
 const stop=buttons.find(button=>button.id==="th-run-results-run-results-stop");
 assert.ok(stop,"Run Results owns its shared header stop action");
 assert.equal(Boolean(stop.disabled),!entry||entry.state!=="running"||!!entry.stopRequested,"Stop is visibly disabled without a cancellable selected execution");
 if(!stop.disabled){stop.action();assert.equal(dispatched.at(-1)[0],"codenav.run-results-stop");}
}
console.log('PASS Run Results shared header selected execution Stop state/dispatch');

// node --experimental-vm-modules design/idea/check_tabs.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const context = vm.createContext({ console }), timers = [], calls = [], notices = [];
let space = "a", store, tree, self;
const key = () => `@area:${space}`;
const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map(n => find(n, id)).find(Boolean);
const shared = name => structuredClone(store[name]);
const editorSpec = () => shared("activity.editor")?.[key()] ?? null;
const setEditorSpec = (slot, spec) => { if (spec) store["activity.editor"][slot] = structuredClone(spec); else delete store["activity.editor"][slot]; };
const wantedChild = () => store["codenav.area"] === "review" ? "editor-review" : !editorSpec() || !editorSpec().path.endsWith(".png") ? "editor-code" : "editor-text";
const run = (name, args) => {
  calls.push([name, args]);
  if (name === "layout.hide" || name === "layout.show") find(tree, args.id).hidden = name === "layout.hide";
  if (name === "layout.select") find(tree, args.stack).active = args.child;
};
const source = await readFile(new URL("../../mods/codenav/tabs.js", import.meta.url), "utf8");
const historySource = await readFile(new URL("../../mods/codenav/editor-history.js", import.meta.url), "utf8");
const values = {
  shared, setShared: (name, value) => { store[name] = structuredClone(value); }, layout: () => structuredClone(tree), run,
  spaces: () => ["a", "b"].map(id => ({ id, active: id === space })),
  find, STACK: "editor-stack", AREA: "editor-area", CHILD: { code: "editor-code", text: "editor-text", review: "editor-review", database: "editor-database" },
  editorSpec, editorKey: key, setEditorSpec, wantedChild, location: () => ({ cwd: "/repo", on: null }),
  isIdea: () => store.layout === "idea", T: text => text, uiNotify: value => notices.push(value),
};
const module = new vm.SourceTextModule(source, { context });
await module.link(id => {
  if (id === "./editor-history.js") return new vm.SourceTextModule(historySource, { context });
  const names = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].find(m => m[2] === id)[1].split(",").map(n => n.trim());
  return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, values[name] ?? (() => {})); }, { context });
});
await module.evaluate();
const { routeEditor, closeTab, closeAll, resumeClose } = module.namespace;
const cx = { timer: { after(_ms, action) { timers.push(action); } } };
const flush = () => { while (timers.length) timers.shift()(cx); };
const settle = () => { for (let i = 0; i < 10; i++) { routeEditor(self, cx); if (!timers.length) return; flush(); } assert.fail("routing did not settle"); };
const spec = path => ({ kind: "file", path: `/repo/${path}`, at: 1 });
const tab = path => ({ id: `f::/repo/${path}`, type: "file", spec: spec(path) });
function reset(paths = ["App.kt"]) {
  space = "a"; self = {}; timers.length = 0; calls.length = 0;
  store = { layout: "idea", "activity.editor": paths.length ? { [key()]: spec(paths[0]) } : {}, "codenav.tabs": { [key()]: paths.map(tab) } };
  tree = { id: "editor-area", children: [{ id: "editor-tabs" }, { id: "editor-stack", active: "editor-code" }] };
}
reset(); closeTab(); settle();
assert.equal(editorSpec(), null);
assert.equal(store["codenav.tabs"][key()].length, 0);
assert.equal(Boolean(tree.hidden), false, "IDEA keeps the empty editor island");
assert.equal(find(tree, "editor-tabs").hidden, true);
setEditorSpec(key(), spec("New.kt")); settle();
assert.equal(find(tree, "editor-tabs").hidden, false, "a hidden strip returns when the explorer opens a file");
assert.equal(store["codenav.tabs"][key()][0].id, tab("New.kt").id);

reset(); store["codenav.tabs"][key()] = [];
routeEditor(self, cx); closeTab(); flush(); settle();
assert.equal(store["codenav.tabs"][key()].length, 0, "a pending registration cannot resurrect the last closed file");

reset(); store["codenav.tabs"][key()] = [];
routeEditor(self, cx); closeAll(); flush(); settle();
assert.equal(editorSpec(), null, "Close All also closes a current file awaiting registration");
assert.equal(store["codenav.tabs"][key()].length, 0);

reset(); store["codenav.tabs"][key()] = [];
routeEditor(self, cx); space = "b"; store["codenav.tabs"][key()] = []; flush();
assert.equal(store["codenav.tabs"][key()].length, 0, "a pending registration stays in its own space");

reset(["App.kt", "Other.kt"]); closeTab(); settle();
assert.equal(editorSpec().path, "/repo/Other.kt", "closing the active file selects its neighbour");
closeAll(); settle(); assert.equal(editorSpec(), null);

reset([]); store["activity.editor"] = {}; store["codenav.area"] = "review";
store["codenav.review.current"] = { space: "a", rkey: ":/repo", path: "App.kt" };
store["codenav.tabs"][key()] = [{ id: "r::/repo:App.kt", type: "review", rkey: ":/repo", path: "App.kt" }];
closeAll(); settle(); assert.equal(store["codenav.tabs"][key()].length, 0); assert.equal(store["codenav.area"], null);

reset([]); store["codenav.area"] = "review";
store["codenav.review.current"] = { space: "a", rkey: ":/other", path: "Old.kt" };
settle();
assert.equal(store["codenav.tabs"][key()].length, 0, "a review from another repository is not added here");
assert.equal(find(tree, "editor-tabs").hidden, true, "stale review context does not leave an empty strip");

reset([]); store["codenav.area"] = "review";
store["codenav.review.current"] = { space: "b", rkey: ":/other", path: "Old.kt" };
const reviewTab=(root,path)=>({id:`r::${root}:${path}`,type:'review',rkey:`:${root}`,path});
const hiddenReview=reviewTab('/other','Hidden.kt');
store['codenav.tabs'][key()]=[hiddenReview,reviewTab('/repo','Last.kt')];
closeTab();settle();
assert.deepEqual(store['codenav.tabs'][key()].map(tab=>tab.id),[hiddenReview.id],'Cmd+W can close the last visible review even when another workspace last published review metadata');
assert.equal(store['codenav.area'],null);assert.equal(find(tree,'editor-stack').active,'editor-code');
assert.equal(find(tree,'editor-tabs').hidden,true,'hidden reviews cannot keep an empty strip visible');

reset();store['codenav.tabs'][key()].push(hiddenReview);closeTab();settle();
assert.equal(editorSpec(),null);assert.equal(store['codenav.area']??null,null,'closing the last visible source never activates a review from another repository');
assert.equal(find(tree,'editor-stack').active,'editor-code');
reset([]);tree.hidden=true;settle();
assert.equal(tree.hidden,false,'an empty IDEA editor area returns after an old workspace visibility snapshot');

reset();store['codenav.area']='review';store['codenav.review.current']={space:'b',rkey:':/other',path:'Old.kt'};
closeTab();settle();assert.equal(editorSpec(),null,'stale review mode does not block closing the current source');

reset(); store.layout = "codebench"; closeTab();
assert.equal(tree.hidden, true, "codebench retains last-tab area hiding");

reset(["App.kt", "Other.kt", "Third.kt"]); settle();
setEditorSpec(key(), spec("Other.kt")); settle();
setEditorSpec(key(), spec("App.kt")); settle();
closeTab(); settle();
assert.equal(editorSpec().path, "/repo/Other.kt", "IDEA close activates the last visited open file, not the last array item");
assert(store["codenav.recentFiles"][key()].some(x => x.spec.path === "/repo/App.kt"), "closed file stays in independent MRU");
closeTab(tab("Third.kt").id); settle();
assert.equal(editorSpec().path, "/repo/Other.kt", "inactive close does not select another file");
reset(["App.kt", "Other.kt"]);
store["activity.editorState"] = { [key()]: { path: "/repo/App.kt", on: null, dirty: true, saving: false } };
closeAll();
assert.equal(store["codenav.tabs"][key()].length, 2, "dirty close-all cannot mutate the tabs before a decision");
assert.equal(find(tree, "editor-stack").active, "editor-text", "save/discard/cancel stays visible in the owning native editor");
let request = store["activity.closeRequest"][key()];
assert.equal(resumeClose({ key: key(), token: request.token }), false, "pending is not approval");
store["activity.closeRequest"][key()].status = "approved";
assert.equal(resumeClose({ key: key(), token: request.token }), false, "still-dirty buffer cannot be closed by a premature approval");
store["activity.editorState"][key()].dirty = false;
assert.equal(resumeClose({ key: key(), token: "old-request" }), false, "stale approval cannot close a newer request");
space = "b";
assert.equal(resumeClose({ key: "@area:a", token: request.token }), false, "approval cannot close a different current workspace");
space = "a";
assert.equal(resumeClose({ key: key(), token: request.token }), true);
assert.equal(store["codenav.tabs"][key()].length, 0);
assert.equal(resumeClose({ key: key(), token: request.token }), false, "approval is consumed exactly once");

// DB protection applies to every requested tab, including inactive documents.
const databaseSpec = { kind: "database", path: "db://draft", rel: "SQL draft", database: { source_id: "fixture" }, on: null };
const databaseTab = { id: "f::db://draft", type: "file", spec: databaseSpec };
const databaseGuard = (state, layoutName = "idea") => {
  store["codenav.databaseState"] = { fixtureOwner: { layout: layoutName, documents: { [databaseSpec.path]: state } } };
};
reset(); tree.children.push({ id: "editor-database" }); store["codenav.tabs"][key()].push(databaseTab);
databaseGuard({ dirty: true, busy: false });
assert.equal(closeTab(databaseTab.id), false); assert.equal(store["codenav.tabs"][key()].length, 2);
assert.equal(editorSpec().path, databaseSpec.path, "closing an inactive dirty DB tab selects its owner");
assert.equal(find(tree, "editor-stack").active, "editor-database"); assert.match(notices.at(-1).body, /Save or discard/);
closeAll(); assert.equal(store["codenav.tabs"][key()].length, 2, "dirty DB close-all keeps every requested tab");
databaseGuard({ dirty: false, busy: true }); closeAll();
assert.equal(store["codenav.tabs"][key()].length, 2); assert.match(notices.at(-1).body, /Wait/);
databaseGuard({ dirty: false, busy: false }); closeAll(); settle();
assert.equal(store["codenav.tabs"][key()].length, 0, "a settled DB tab closes on a new explicit request");
reset(); tree.children.push({ id: "editor-database" }); store["codenav.tabs"][key()].push(databaseTab);
databaseGuard({ dirty: true, busy: true }, "codebench"); closeTab(databaseTab.id);
assert.equal(store["codenav.tabs"][key()].length, 1, "metadata from another layout cannot block this layout");
reset(); store["codenav.tabs"][key()].push(databaseTab); databaseGuard({ dirty: true, busy: true }); closeTab(databaseTab.id);
assert.equal(store["codenav.tabs"][key()].length, 1, "orphaned metadata without an owning DB view does not block close");
reset([]); tree.children.push({ id: "editor-database" }); setEditorSpec(key(), databaseSpec);
databaseGuard({ dirty: true, busy: false });
assert.equal(closeAll(), false); assert.equal(editorSpec().path, databaseSpec.path, "an unregistered dirty DB current document is protected");
reset(); store.layout = "codebench"; tree.children.push({ id: "editor-database" }); store["codenav.tabs"][key()].push(databaseTab);
databaseGuard({ dirty: true, busy: false }, "codebench"); assert.equal(closeTab(databaseTab.id), false);
assert.equal(store["codenav.tabs"][key()].length, 2, "codebench DB drafts retain the same close protection");

// Exercise the real multi-file entry point and its shared file identity helper.
const commonSource = await readFile(new URL("../../mods/codenav/common.js", import.meta.url), "utf8");
const common = new vm.SourceTextModule(commonSource, { context });
const realModels = new Map();
await common.link(async id => {
  if (["./layout-tree.js", "./editor-history.js", "./actions.js"].includes(id)) {
    if (!realModels.has(id)) realModels.set(id, new vm.SourceTextModule(await readFile(new URL(`../../mods/codenav/${id.slice(2)}`, import.meta.url), "utf8"), { context }));
    return realModels.get(id);
  }
  const names = [...new Set([...commonSource.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)]
    .filter(match => match[2] === id).flatMap(match => match[1].split(",").map(name => name.trim().split(/\s+as\s+/)[0])))];
  const overrides = { ...values, focused: () => null, spaces: () => ["a", "b"].map(id => ({ id, active: id === space, tabs: [] })) };
  return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, overrides[name] ?? (() => {})); }, { context });
});
await common.evaluate();
assert.equal(common.namespace.find({ id: "leaf" }, "missing"), null, "common keeps the pure find export");
reset([]);store['activity.editorState']={[key()]:{path:'/repo/Old.kt',dirty:true,saving:false}};
assert.equal(common.namespace.wantedChild(),'editor-code','orphaned native metadata cannot hide the empty editor');
store['activity.closeRequest']={[key()]:{status:'pending'}};
assert.equal(common.namespace.wantedChild(),'editor-text','an actual pending unsaved close still routes to the owning native editor');
store['activity.editor'][key()] = databaseSpec;
assert.equal(common.namespace.wantedChild(), 'editor-text', 'native file dirty guard stays ahead of a requested DB document');
store['activity.editorState'][key()].dirty = false; store['activity.editorState'][key()].saving = true;
assert.equal(common.namespace.wantedChild(), 'editor-text', 'native file saving guard stays ahead of a requested DB document');
store['activity.editorState'][key()].saving = false;
assert.equal(common.namespace.wantedChild(), 'editor-database', 'a settled native editor permits the requested DB document');
store['activity.editorState'][key()] = { path: '/repo/Owned.kt', owner: 'codenav', dirty: true, saving: false };
assert.equal(common.namespace.wantedChild(), 'editor-code', 'dirty owned documents route to the source editor for Save/Discard');
store['activity.editorState'][key()].dirty = false;
store['activity.editor'][key()] = { kind: 'file', path: '/repo/Owned.kt', edit: true };
assert.equal(common.namespace.wantedChild(), 'editor-code', 'local IDEA text stays in the unified editor after an Edit action');
reset([]);
common.namespace.openFiles(["/repo/App.kt", "/repo/Other.kt", "/repo/App.kt", "", null]);
assert.deepEqual(Array.from(store["codenav.tabs"][key()], tab => tab.id), ["f::/repo/App.kt", "f::/repo/Other.kt"], "one drop registers every unique valid path");
assert.equal(editorSpec().path, "/repo/Other.kt", "the last dropped file becomes current");
common.namespace.openFiles(["/repo/App.kt"], "remote");
assert.deepEqual(Array.from(store["codenav.tabs"][key()], tab => tab.id), ["f::/repo/App.kt", "f::/repo/Other.kt", "f:remote:/repo/App.kt"], "identical local and remote paths remain separate tabs");
common.namespace.openFiles(["/repo/App.kt"]);
assert.deepEqual(Array.from(store["codenav.tabs"][key()], tab => tab.id), ["f::/repo/Other.kt", "f:remote:/repo/App.kt", "f::/repo/App.kt"], "reopening moves the existing local tab without duplicates");
const beforeEmptyDrop = JSON.stringify(store);
common.namespace.openFiles([null, ""]);
assert.equal(JSON.stringify(store), beforeEmptyDrop, "an empty drop leaves editor and tabs untouched");

reset();
const snapshot = { path: "/repo/App.kt", space: key(), on: null, line: 12, col: 3 };
store["codenav.caret"] = snapshot;
assert.equal(common.namespace.editorSnapshot("codenav.caret").line, 12, "current local editor accepts its caret snapshot");
store["codenav.caret"] = { ...snapshot, on: "remote" };
assert.equal(common.namespace.editorSnapshot("codenav.caret"), null, "same path on another machine cannot supply a caret");
store["activity.editor"][key()] = { ...spec("App.kt"), on: "remote" };
assert.equal(common.namespace.editorSnapshot("codenav.caret").col, 3, "remote snapshot matches its exact remote document");
space = "b";
store["activity.editor"][key()] = { ...spec("App.kt"), on: "remote" };
assert.equal(common.namespace.editorSnapshot("codenav.caret"), null, "same remote document in another workspace cannot leak its caret");
store["codenav.caret"] = { ...snapshot, space: key(), on: "remote", path: "/repo/Other.kt" };
assert.equal(common.namespace.editorSnapshot("codenav.caret"), null, "previous file cannot supply the current editor snapshot");
console.log("PASS last/close-all, empty island, hidden strip reopen, stale registration, space isolation, neighbour/MRU, closed history, review, codebench");
console.log("PASS inactive/current DB dirty/busy close protection, layout ownership, orphan cleanup and native-file guard precedence");
console.log("PASS real common.find export, multi-file drop deduplication/order, current file and local/remote identities");
console.log("PASS editorSnapshot current file, local/remote machine and workspace isolation");

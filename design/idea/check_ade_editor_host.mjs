import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const alpha = { id: "a", root: "/a" }, beta = { id: "b", root: "/b" };
let current = alpha;
const fileStates = new Map([["a", { tabs: ["/a/file.ts"], active: "/a/file.ts" }], ["b", { tabs: ["/b/file.ts"], active: "/b/file.ts" }]]);
const dbStates = new Map([["a", { tabs: [{ id: "table", spec: { source_id: "source", kind: "table", table: "users" } }], active: "table" }], ["b", { tabs: [], active: null }]]);
const saved = new Map(), options = [], refreshes = [], strips = [], tabLabels = [], rendered = [], tasks = [];
const dirtyFiles = new Set(), dirtyDatabases = new Set();
const projectKey = project => project?.id ?? "none";
const element = () => {
  const proxy = new Proxy({}, { get: (_target, key) => key === "then" ? undefined : () => proxy }); return proxy;
};
class Files {
  init(props) { options.push(props); this.focus = { focus() {} }; }
  title(path) { return path.split("/").pop(); }
  dirty(path) { return dirtyFiles.has(path); }
  refresh(_cx, context) { refreshes.push(["file", context.id]); }
  activate(path, _cx, context) { fileStates.get(context.id).active = path; }
  active() { return { path: fileStates.get(current.id).active, project: current, state: { focus() {} } }; }
  save(doc) { this.saved = doc; }
  closePath(path, _cx, context) {
    if (dirtyFiles.has(path)) { this.pending = path; return false; }
    const state = fileStates.get(context.id); state.tabs = state.tabs.filter(item => item !== path); state.active = state.tabs[0] ?? null; return true;
  }
  render() { rendered.push("file"); return element(); }
  release() { this.released = true; return this.closeGate; }
}
class Database {
  init(props) { this.context = props.context; options.push(props); }
  title(id) { return dbStates.get(this.context.id).tabs.find(tab => tab.id === id)?.spec.table || "SQL 콘솔"; }
  dirty(id) { return dirtyDatabases.has(id); }
  refresh(_cx, context) { this.context = context; refreshes.push(["database", context.id]); }
  activate(id) { dbStates.get(this.context.id).active = id; }
  active() { return { spec: dbStates.get(this.context.id).tabs.find(tab => tab.id === dbStates.get(this.context.id).active)?.spec }; }
  closeDocument(id) {
    if (dirtyDatabases.has(id)) { this.closing = id; return false; }
    const state = dbStates.get(this.context.id); state.tabs = state.tabs.filter(tab => tab.id !== id); state.active = state.tabs[0]?.id ?? null; return true;
  }
  render() { rendered.push(`database:${this.context.id}`); return element(); }
  release() { this.released = true; }
}
const bindings = {
  "gpui-base": { h_flex: element, v_flex: element },
  herdr: { shared: key => saved.get(key), setShared: (key, value) => saved.set(key, value) },
  "./idea-design.js": { adeUI: value => value, adeColors: () => ({}), adeNote: element, TabViewport: class {},
    adeTab: (id, label) => { tabLabels.push({ id, label }); return element(); },
    uiTabStrip: (id, items, active) => { strips.push({ id, items, active }); return element(); } },
  "./ui-icons.js": { uiIcon: element },
  "./workspace.js": { projectKey, currentProject: () => current, documentState: context => fileStates.get(context.id) },
  "./database-model.js": { databaseDocumentState: context => dbStates.get(context.id) },
  "./text-editor.js": { default: Files }, "./database-editor.js": { DatabaseEditor: Database },
  "./review.js": { ReviewView: class {
    init(props) { this.context = props.context; this.focus = { focus() {} }; }
    refresh(_cx, context) { this.context = context; }
    render() { rendered.push(`review:${this.context.id}`); return element(); }
    requestClose(after, cx) { if (this.holdClose) this.afterClose = after; else after(cx); }
    release() { this.released = true; }
  } },
};
const context = vm.createContext({ console });
const module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/editor-host.js", import.meta.url), "utf8"), { context });
await module.link(async name => {
  const values = bindings[name]; assert.ok(values, name);
  return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
});
await module.evaluate();
const queueTimers = []; let notifications = 0;
const cx = { sleep: async () => {}, notify() { notifications++; }, timer: { every(ms, fn) {
  assert.equal(ms,25); const timer = { cancelled: false, cancel() { this.cancelled = true; }, fire() { if (!this.cancelled) fn(cx); } }; queueTimers.push(timer); return timer;
} }, spawn(fn) { const task = Promise.resolve().then(() => fn(cx)); tasks.push(task); } };
const tick = async () => { for (let i = 0; i < 8; i++) { for (const timer of queueTimers) timer.fire(); await Promise.resolve(); } };
const host = new module.namespace.EditorHost(); host.init({ context: alpha }, cx); await tick();
const idleNotifications = notifications; await tick(); assert.equal(notifications, idleNotifications, "idle host pump never redraws");
assert.ok(options.every(option => option.embedded));
host.render(cx); assert.equal(strips.length, 1); assert.equal(strips.at(-1).items.length, 2); assert.equal(rendered.at(-1), "file");
dirtyFiles.add("/a/file.ts"); host.render(cx); assert.ok(tabLabels.at(-2).label.includes("•"));
const table = host.entries().find(entry => entry.kind === "database"); host.activate(table, cx); host.render(cx);
assert.equal(rendered.at(-1), "database:a"); assert.equal(saved.get("ade.editor-mode").a, "database");
host.save(); assert.equal(host.files.saved, undefined, "Save never applies database mutations");
dirtyDatabases.add("table"); host.closeEntry(table, cx); assert.equal(host.database.closing, "table"); assert.equal(dbStates.get("a").tabs.length, 1);
dirtyDatabases.delete("table"); host.closeEntry(table, cx); host.render(cx); assert.equal(saved.get("ade.editor-mode").a, "file");
const file = host.entries()[0]; host.closeEntry(file, cx); assert.equal(host.files.pending, "/a/file.ts"); assert.equal(fileStates.get("a").tabs.length, 1);
host.save(); assert.equal(host.files.saved.path, "/a/file.ts");
// New DB metadata is observed asynchronously without relying on a broadcast.
dbStates.get("a").tabs.push({ id: "console", spec: { source_id: "source", kind: "console" } }); dbStates.get("a").active = "console";
saved.set("ade.editor-mode", { a: "database" });
const before = refreshes.length; host.render(cx); assert.equal(refreshes.length, before, "render only enqueues descriptors"); await tick(); assert.ok(refreshes.length >= before + 2);
current = beta; host.render(cx); await tick(); assert.equal(host.context.id, "b"); assert.equal(rendered.at(-1), "file");
host.activate(table, cx); assert.equal(dbStates.get("b").tabs.length, 0, "stale project tab callbacks are ignored");
saved.set("ade.review-open", { b: true }); saved.set("ade.editor-mode", { b: "review" });
host.render(cx); await tick(); host.render(cx);
assert.equal(rendered.at(-1), "review:b"); assert.equal(host.active(), null, "review never saves the inactive file");
const review = host.entries().find(entry => entry.kind === "review");
assert.equal(host.entries().filter(entry => entry.kind === "review").length, 1, "one review tab per project");
host.review.holdClose = true; host.closeEntry(review, cx); host.render(cx);
assert.equal(saved.get("ade.review-open").b, true, 'dirty review remains open until confirmation');
let closeNotified = false; host.review.afterClose({ ...cx, notify() { closeNotified = true; } }); host.render(cx);
assert.ok(closeNotified, 'review confirmation uses its fresh native context');
assert.equal(saved.get("ade.review-open").b, false); assert.equal(rendered.at(-1), "file");
let finish; host.files.closeGate = new Promise(resolve => { finish = resolve; }); let done = false;
const closing = host.release().then(() => { done = true; }); assert.ok(queueTimers.every(timer => timer.cancelled)); await tick(); assert.equal(done, false); finish(); await closing; await Promise.all(tasks);
assert.ok(host.files.released && host.database.released);
console.log("ADE editor host: one mixed strip, retained dirty buffers/prompts, explicit DB apply boundary, async shared sync, stale project guards and awaited cleanup passed");

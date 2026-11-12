import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const alpha = { id: "a", root: "/a" }, beta = { id: "b", root: "/b" };
let current = alpha;
const projectKey = context => context?.id ?? "none";
const processes = new Map([["a", { records: [{ id: "same", name: "Shell", status: "completed", startedAt: 10 }], activeId: "same" }], ["b", { records: [] }]]);
const queries = new Map([["a", { records: [{ id: "same", name: "Old generic name", queryLabel: "SELECT customers", runNumber: 3, sourceName: "Fixture SQLite", state: "completed", startedAt: 20 }], activeId: "same" }], ["b", { records: [] }]]);
const closeCalls = [], refreshes = [], childOptions = [], renders = [], strips = [], tooltips = [];
const element = () => {
  const proxy = new Proxy({}, { get: (_target, key) => {
    if (key === "then") return undefined;
    if (key === "when") return (condition, fn) => condition ? fn(proxy) : proxy;
    if (key === "tooltip") return text => { tooltips.push(text); return proxy; };
    return () => proxy;
  } }); return proxy;
};
class Shell {
  init(props) { this.context = props.context; childOptions.push(props); }
  refresh(_cx, context) { this.context = context; refreshes.push(["shell", context.id]); }
  select(id) { processes.get(this.context.id).activeId = id; }
  close(id) { closeCalls.push(["shell", id]); processes.get(this.context.id).records.find(record => record.id === id).closed = true; }
  release() { this.released = true; }
  render(_cx, options) { renders.push(["shell", options.selectedId]); return element(); }
}
class SQL {
  init(props) { this.context = props.context; childOptions.push(props); }
  refresh(_cx, context) { this.context = context; refreshes.push(["sql", context.id]); }
  release() { this.released = true; }
  render(_cx, options) { renders.push(["sql", options.selectedId]); return element(); }
  tooltip(id, context) { return `SELECT * FROM customers WHERE token='local-only-${context.id}-${id}'`; }
}
const bindings = {
  "gpui-base": { h_flex: element, v_flex: element },
  "./idea-design.js": { adeUI: value => value, adeColors: () => ({}), adeTab: element, adeNote: element, TabViewport: class {},
    uiTabStrip: (id, items, active) => { strips.push({ id, items, active }); return element(); } },
  "./ui-icons.js": { uiIcon: element }, "./workspace.js": { projectKey, currentProject: () => current },
  "./execution.js": { ExecutionResults: Shell, executionState: context => processes.get(context.id) },
  "./database-editor.js": { DatabaseResults: SQL },
  "./database-model.js": { databaseExecutionState: context => queries.get(context.id),
    sqlResultTitle: record => record.queryLabel ? `${record.queryLabel} · #${record.runNumber}` : 'SQL 결과',
    selectDatabaseExecution: (id, context) => { queries.get(context.id).activeId = id; },
    closeDatabaseExecution: (id, context) => { closeCalls.push(["sql", id]); queries.get(context.id).records.find(record => record.id === id).closed = true; } },
};
const context = vm.createContext({ console });
const module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/results.js", import.meta.url), "utf8"), { context });
await module.link(async name => {
  const values = bindings[name]; assert.ok(values, name);
  return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
});
await module.evaluate();
const tasks = [], tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const { ResultsHost, resultEntries } = module.namespace, cx = { notify() {}, spawn(fn) { const task = Promise.resolve().then(() => fn(cx)); tasks.push(task); } };
assert.deepEqual([...resultEntries(alpha)].map(entry => entry.key), ["shell:same", "sql:same"], "kind namespaces prevent job-ID collisions");
assert.equal(resultEntries(alpha)[1].name, 'SELECT customers · #3');
assert.equal(resultEntries(alpha)[1].sourceName, 'Fixture SQLite');
const host = new ResultsHost(); host.init({ context: alpha }, cx);
assert.ok(childOptions.every(options => options.embedded));
host.render(cx); assert.equal(strips.length, 1); assert.equal(strips.at(-1).items.length, 2); assert.equal(strips.at(-1).active, "sql:same");
assert.ok(tooltips.some(text => text.includes("local-only-a-same")));
assert.equal(JSON.stringify(queries.get('a')).includes('local-only'), false);
assert.deepEqual(renders.at(-1), ["sql", "same"]);
host.select("shell:same", cx);
queries.get("a").records[0].state = "running";
host.render(cx); assert.equal(strips.at(-1).active, "shell:same", "progress updates preserve the manual selection");
queries.get("a").records.push({ id: "new", name: "New SQL", state: "queued", startedAt: 30 });
host.refresh(cx); host.render(cx); assert.equal(strips.at(-1).active, "sql:new", "new executions become visible automatically");
host.select("shell:same", cx); current = beta; host.refresh(cx, beta); current = alpha; host.refresh(cx, alpha); host.render(cx);
assert.equal(strips.at(-1).active, "shell:same", "project switches retain each project's manual selection");
host.close(resultEntries(alpha).find(entry => entry.key === "shell:same"), cx); host.render(cx);
assert.deepEqual(closeCalls.at(-1), ["shell", "same"]); assert.equal(strips.at(-1).active, "sql:new");
host.close(resultEntries(alpha).find(entry => entry.key === "sql:new"), cx); host.render(cx);
assert.deepEqual(closeCalls.at(-1), ["sql", "new"]); assert.equal(strips.at(-1).active, "sql:same");
host.release(); assert.ok(host.shell.released && host.database.released);
const count = refreshes.length; host.refresh(cx); assert.equal(refreshes.length, count);
const empty = { id: 'empty' }; processes.set('empty', { records: [] }); queries.set('empty', { records: [] }); current = empty;
const restored = new ResultsHost(); restored.init({ context: empty }, cx); restored.render(cx); await tick();
const beforeRestored = refreshes.length; current = alpha; restored.render(cx); await tick();
assert.ok(refreshes.length >= beforeRestored + 2, 'core project availability triggers asynchronous child observation without a command broadcast');
processes.get('a').records.push({ id: 'restored', name: 'Restored run', status: 'running', startedAt: 100 });
const beforeNew = refreshes.length; restored.render(cx); await tick();
assert.ok(refreshes.length >= beforeNew + 2, 'new shared execution metadata triggers observation without a broadcast');
restored.release(); await Promise.all(tasks);
console.log("ADE unified results: single mixed strip, kind IDs, newest/manual selection, project isolation, delegated close and cleanup passed");

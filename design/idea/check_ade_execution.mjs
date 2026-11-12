import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const saved = new Map(), calls = [], closed = [], timers = [], tasks = [];
let handler = async () => { throw new Error("unexpected hc call"); };
const projectKey = context => JSON.stringify([context?.machine ?? null, context?.root ?? "", context?.id ?? ""]);
let stripCalls = 0, copied = null;
const buttons = new Map(), fonts = [];
const managedLists = new Map();
const element = () => {
  const proxy = new Proxy({}, { get: (_target, key) => key === "then" ? undefined : key === "font_family" ? value => { fonts.push(value); return proxy; } : key === "when" ? (condition, fn) => condition ? fn(proxy) : proxy : () => proxy });
  return proxy;
};
class MenuController {
  constructor() { this.focus = { focus() {}, release() {} }; this.scroll = {}; }
  release() {} ensureVisible() {}
}
const input = ({ value = "" } = {}) => ({ value: () => value, set_value: next => { value = next; }, on() {}, release() {} });
const bindings = {
  "gpui-kit": { div: element },
  "gpui-base": { h_flex: element, v_flex: element, InputState: { new: input }, Input: { new: element } },
  herdr: { hc: async args => { calls.push(args); return handler(args); }, shared: key => saved.get(key),
    setShared: (key, value) => saved.set(key, value), closeOverlay: id => closed.push(id) },
  "./workspace.js": { projectKey },
  "./idea-design.js": { adeUI: value => value, adeSize: value => value ?? 13, adeColors: () => ({}), adeButton: (id, label, action, options) => { buttons.set(id, { label, action, options }); return element(); },
    adeTab: element, adeNote: element, adeInputBox: element, adeManagedList: (id, rows, _controller, _cx, options) => { managedLists.set(id, { rows, options }); return element(); }, MenuController,
    TabViewport: class {}, uiTabStrip: () => { stripCalls++; return element(); } },
  "./ui-icons.js": { uiIcon: element },
};
const context = vm.createContext({ console });
const module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/execution.js", import.meta.url), "utf8"), { context });
await module.link(async name => {
  assert.ok(bindings[name], `Unexpected dependency ${name}`);
  const values = bindings[name];
  return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
});
await module.evaluate();
const api = module.namespace, alpha = { id: "a", root: "/alpha", machine: null }, beta = { id: "b", root: "/beta", machine: "remote" };
const cx = { write_to_clipboard(value) { copied = value; }, notify() {}, spawn(fn) { const promise = fn(cx); tasks.push(promise); },
  timer: { after(ms, fn) { const timer = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(timer); return timer; } } };
const drain = async () => { while (tasks.length) await tasks.shift(); };
const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });
const result = () => api.executionState(alpha).records.at(-1);
let info, output = "hello\nworld", running = true;
handler = async args => {
  if (args[0] === "run") {
    assert.ok(args.includes("--no-parent") && args.includes("--no-notify") && args.includes("--bg"));
    assert.ok(!args.includes("--keep"));
    info = { address: "t-owned", labels: {}, state: "live", parent: null, keep: false };
    args.forEach((arg, i) => { if (arg === "--label") { const [key, ...value] = args[i + 1].split("="); info.labels[key] = value.join("="); } });
    return json({ address: info.address });
  }
  if (args[0] === "get") return json({ ...info, state: running ? "live" : "finished", exit_code: running ? null : 7 });
  if (args[0] === "read") return { code: 0, stdout: output, stderr: "" };
  if (args[0] === "interrupt") return json({});
  if (args[0] === "kill") { running = false; return json({}); }
  throw new Error(`Unexpected command ${args[0]}`);
};
saved.set("ade.run-configurations", { retained: { unknown: true }, [projectKey(alpha)]: { configurations: [{ id: "c", name: "Test", command: "exit 7" }], selectedId: "c", unknown: 9 } });
assert.equal(api.selectedConfiguration(alpha).id, "c");
assert.equal(api.selectedConfiguration(beta), null);
assert.throws(() => api.runConfiguration(alpha, { command: " " }, cx));
const record = api.runConfiguration(alpha, api.selectedConfiguration(alpha), cx);
await drain();
assert.equal(result().status, "running"); assert.equal(result().output, output);
assert.equal(api.executionState(beta).records.length, 0);
const view = new api.ExecutionResults(); view.init({ context: alpha }, cx); await drain();
view.render(cx); assert.equal(stripCalls, 1);
buttons.get("ade-execution-copy").action(null, cx); assert.equal(copied, output);
assert.ok(fonts.includes("Menlo"), "output applies a fixed-pitch font directly to native text rows");
view.embedded = true; view.render(cx, { selectedId: record.id }); assert.equal(stripCalls, 1, "embedded results omit their internal tab strip");
assert.equal(timers.at(-1).ms, 1500);
view.close(record.id);
assert.equal(result().closed, true); assert.equal(calls.filter(args => args[0] === "kill").length, 0);
view.release(); assert.equal(timers.at(-1).cancelled, true);
await api.stopExecution(record.id);
assert.equal(result().status, "cancelled"); assert.equal(result().exitCode, 7);
assert.deepEqual(calls.filter(args => ["interrupt", "kill"].includes(args[0])).map(args => args[0]), ["interrupt", "kill"]);
running = false; output = Array.from({ length: 2300 }, (_, i) => String(i)).join("\n");
api.runConfiguration(alpha, { id: "fail", name: "Fail", command: "exit 7" }, cx); await drain();
assert.equal(result().status, "failed"); assert.equal(result().output.split("\n").length, 2000);
const noPoll = timers.length; const finished = new api.ExecutionResults(); finished.init({ context: alpha }, cx); await drain();
assert.equal(timers.length, noPoll, "finished history never starts a poll timer"); finished.release();
// Saved running executions recover through ownership inspection, never rerun.
const state = saved.get("ade.execution"), latest = result();
state[projectKey(alpha)].records.at(-1).status = "running";
const runsBeforeRecovery = calls.filter(args => args[0] === "run").length;
const recovered = new api.ExecutionResults(); recovered.init({ context: alpha }, cx); await drain();
assert.equal(result().status, "failed");
assert.equal(calls.filter(args => args[0] === "run").length, runsBeforeRecovery); recovered.release();
saved.set("ade.execution", { ...saved.get("ade.execution"), [projectKey(beta)]: { records: [{ ...latest, id: "cross-copy", context: beta, address: null, status: "starting", startedAt: Date.now() }] } });
const beforeCrossCopy = calls.length, crossCopy = new api.ExecutionResults(); crossCopy.init({ context: beta }, cx); await drain();
assert.equal(calls.length, beforeCrossCopy, "another mod copy waits for the launcher instead of reporting a false ownership failure");
assert.equal(api.executionState(beta).records[0].status, "starting"); crossCopy.release();
// An unowned address must never be read, interrupted, or killed.
state[projectKey(alpha)] = { records: [{ ...latest, status: "running", owner: "forged" }] };
saved.set("ade.execution", state);
const accessBefore = calls.filter(args => ["read", "interrupt", "kill"].includes(args[0])).length;
await assert.rejects(api.stopExecution(latest.id), /소유권/);
assert.equal(result().status, "unknown");
assert.equal(calls.filter(args => ["read", "interrupt", "kill"].includes(args[0])).length, accessBefore);
// Draft mutations and cancellation preserve saved configuration and unknown fields.
const dialog = new api.RunConfigurations(); dialog.init({ context: alpha, overlay: "o" }, cx);
dialog.change("copy", cx); dialog.change("up", cx);
assert.equal(api.selectedConfiguration(alpha).name, "Test");
const untouchedId = dialog.draft[0].id, hoverId = dialog.draft[1].id;
dialog.select(untouchedId); dialog.render(cx);
const hoverOptions = managedLists.get('ade-config-list').options.rowActions({ id: hoverId });
hoverOptions.find(action => action.id === 'copy').action(hoverId, undefined, cx);
assert.equal(dialog.draft.find(config => config.id === dialog.selectedId).name, 'Test 복사', 'hovered config row is copied instead of selected row');
hoverOptions.find(action => action.id === 'remove').action(hoverId, undefined, cx);
assert.equal(dialog.draft.some(config => config.id === hoverId), false); assert.equal(dialog.draft.some(config => config.id === untouchedId), true);
assert.equal(api.selectedConfiguration(alpha).name, "Test", 'row hover changes remain uncommitted configuration drafts');
dialog.apply(cx); assert.equal(closed.at(-1), "o");
assert.equal(saved.get("ade.run-configurations")[projectKey(alpha)].unknown, 9);
assert.equal(saved.get("ade.run-configurations").retained.unknown, true);
dialog.release();
// Bounded history never evicts an active process.
state[projectKey(alpha)] = { records: Array.from({ length: 20 }, (_, i) => ({ ...latest, id: String(i), status: i === 0 ? "running" : "failed" })) };
saved.set("ade.execution", state);
api.runConfiguration(alpha, { name: "Bounded", command: "true" }, cx); await drain();
assert.equal(api.executionState(alpha).records.length, 20);
assert.ok(api.executionState(alpha).records.some(item => item.id === "0"));
state[projectKey(alpha)] = { records: Array.from({ length: 20 }, (_, i) => ({ ...latest, id: String(i), status: "running" })) };
saved.set("ade.execution", state);
assert.throws(() => api.runConfiguration(alpha, { command: "true" }, cx), /20/);
console.log("ADE execution checks passed: ownership, cancellation, output/history bounds, recovery, idle timers, draft preservation");

// Explicit opt-in: these fixtures create and stop only freshly labelled ADE
// processes. The normal validation suite remains independent of a live core.
if (process.argv.includes("--process-fixtures")) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { tmpdir } = await import("node:os");
  const { setTimeout: delay } = await import("node:timers/promises");
  const execute = promisify(execFile);
  handler = async args => {
    try { const { stdout, stderr } = await execute("hc", args, { maxBuffer: 8 * 1024 * 1024 }); return { code: 0, stdout, stderr }; }
    catch (error) { return { code: error.code || 1, stdout: error.stdout || "", stderr: error.stderr || String(error) }; }
  };
  const live = { id: "ade-t41-owned-fixtures", root: tmpdir(), machine: null };
  const launched = [];
  try {
    const failed = api.runConfiguration(live, { id: "failure", name: "T41 failure fixture", command: "printf 'ade-t41-output\\n'; exit 7" }, cx);
    launched.push(failed.id); await drain();
    const watch = new api.ExecutionResults(); watch.init({ context: live }, cx); await drain();
    let actual = api.executionState(live).records.at(-1);
    for (let i = 0; actual.status === "running" && i < 10; i++) {
      await delay(100); watch.refresh(cx); await drain(); actual = api.executionState(live).records.at(-1);
    }
    assert.equal(actual.status, "failed"); assert.equal(actual.exitCode, 7); assert.match(actual.output, /ade-t41-output/);
    watch.release();
    const cancellable = api.runConfiguration(live, { id: "cancel", name: "T41 cancellation fixture", command: "printf 'ade-t41-running\\n'; sleep 30" }, cx);
    launched.push(cancellable.id); await drain();
    assert.equal(api.executionState(live).records.at(-1).status, "running");
    await api.stopExecution(cancellable.id);
    actual = api.executionState(live).records.at(-1);
    assert.equal(actual.status, "cancelled");
    assert.equal(JSON.parse((await handler(["get", actual.address, "--json"])).stdout).state, "finished");
    console.log(`ADE actual process fixtures passed: failure exit 7, transcript, cancellation exit ${actual.exitCode} signal ${actual.exitSignal}`);
  } finally {
    for (const id of launched) await api.stopExecution(id);
  }
}

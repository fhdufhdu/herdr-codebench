// Run: node --experimental-vm-modules design/idea/check_run_sessions.mjs
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../../mods/codenav/run.js", import.meta.url), "utf8");
const historySource = await readFile(new URL("../../mods/codenav/execution-results.js", import.meta.url), "utf8");
const processSource = await readFile(new URL("../../mods/codenav/run-process.js", import.meta.url), "utf8");
const context = vm.createContext({ console, Date, Math });
const store = {}, sends = [], commands = [], notices = [];
let space = { id: "one", active: true, folder: "/repo", tabs: [{ id: "t1", name: "▶ App" }] };
let panes = [{ tab: "t1", terminal: "term1", program: { shell: true } }];
let idea = false, manualSleep = false, sleepResolvers = [], nextProcess = 0, completeProcesses = true, interruptOutcome = "stopped", onOpenResults;
const processes = new Map();
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const nativeInput = () => ({ text: "", set_value(value) { this.text = value; }, value() { return this.text; }, on() {}, focus() {}, release() {} });
const focus = () => ({ focus() {}, release() {} });
const overrides = {
  shared: key => store[key], setShared: (key, value) => { store[key] = value; },
  spaces: () => [space], panes: () => panes, terminals: () => [...processes.values()], isIdea: () => idea,
  editorKey: () => `@area:${space.id}`, toggleTool: (...args) => { commands.push(["toggleTool", args]); onOpenResults?.(); },
  run: (name, args) => { commands.push([name, args]); if (name === "tab.new") { space.tabs.push({ id: "new-tab", name: args.name }); panes.push({ tab: "new-tab", terminal: "new-terminal", program: { shell: true } }); } },
  hc: async args => {
    sends.push(args);
    const pane = panes.find(pane => pane.terminal === args[1]);
    if (args[0] === "run") {
      const address = `process-${++nextProcess}`, label = args[args.indexOf("--label") + 1].slice("codebench.execution=".length), name = args[args.indexOf("--name") + 1];
      processes.set(address, { address, labels: { "codebench.execution": label }, name, state: "live", created_ms: Date.now(), reads: 0, output: `execution ${nextProcess}` });
      return { code: 0, stdout: JSON.stringify({ address }) };
    }
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ terminals: [...processes.values()] }) };
    const process = processes.get(args[1]);
    if (process && args[0] === "get") {
      if (completeProcesses && ++process.reads >= 2) { process.state = "finished"; process.exit_code = 0; process.finished_ms = Date.now(); }
      return { code: 0, stdout: JSON.stringify(process) };
    }
    if (process && args[0] === "read") return { code: 0, stdout: process.output };
    if (process && ["interrupt", "kill"].includes(args[0])) { process.state = "finished"; process.exit_code = 130; return { code: 0, stdout: '{"outcome":"exited"}' }; }
    if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ argv: ["/bin/zsh"], state: "live" }) };
    if (args[0] === "interrupt") { if (interruptOutcome === "stopped" && pane) pane.program.shell = true; return { code: 0, stdout: JSON.stringify({ outcome: interruptOutcome }) }; }
    return { code: 0 };
  },
  exec: async () => { if (manualSleep) await new Promise(resolve => sleepResolvers.push(resolve)); return { code: 0 }; },
  uiNotify: note => notices.push(note), T: text => text, openOverlay: () => "confirm",
  InputState: { new: nativeInput },
  MenuController: class { constructor() { this.focus = focus(); } release() {} ensureVisible() {} },
};
const mod = new vm.SourceTextModule(source, { context });
const history = new vm.SourceTextModule(historySource, { context });
const processModule = new vm.SourceTextModule(processSource, { context });
const external = new Map();
await mod.link(id => {
  if (id === "./execution-results.js") return history;
  if (id === "./run-process.js") return processModule;
  if (!external.has(id)) {
    const names = [...new Set([...`${source}\n${historySource}\n${processSource}`.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].filter(match => match[2] === id).flatMap(match => match[1].split(",").map(name => name.trim().split(/\s+as\s+/)[0])))];
    external.set(id, new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, overrides[name] ?? (() => {})); }, { context }));
  }
  return external.get(id);
});
await mod.evaluate();
const api = mod.namespace;
const legacy = { name: "App", command: "echo app", futureField: 42 };
store["codenav.run"] = { ":/repo": { configs: [legacy], selected: 0, future: true } };
assert.equal(api.configTab(legacy).id, "t1", "unique pre-ID configuration adopts its existing terminal");
const config = new api.RunConfigs();
config.init({}, { focus_handle: focus });
const id = config.configs[0].id;
assert.ok(id); assert.equal(store["codenav.run"][":/repo"].configs[0].id, undefined, "opening/cancelling configuration UI does not persist migration");
config.configs[0].name = "Renamed"; config.apply();
const saved = api.runStore().configs[0];
assert.equal(saved.futureField, 42); assert.equal(api.runStore().future, true);
assert.equal(api.configTab(saved).id, "t1", "renaming a migrated configuration keeps its pre-existing terminal");
await api.runConfig(saved);
assert.equal(sends.at(-1)[1], "term1");
const firstSession = store["codenav.runSessions"][":/repo@one"][id];
assert.equal(firstSession.tab, "t1"); assert.equal(firstSession.terminal, "term1");
space.tabs[0].name = "user renamed terminal";
assert.equal(api.configTab(saved).id, "t1", "terminal attachment uses ID after adoption, not its display name");
await api.runConfig(saved);
assert.notEqual(store["codenav.runSessions"][":/repo@one"][id].executionId, firstSession.executionId);
const fresh = { id: "fresh", name: "App", command: "echo fresh" };
space.tabs[0].name = "▶ App";
assert.equal(api.configTab(fresh), null, "a new same-name configuration cannot capture another configuration's terminal");
await api.runConfig(fresh);
assert.equal(sends.at(-1)[1], "new-terminal");
assert.equal(store["codenav.runSessions"][":/repo@one"].fresh.tab, "new-tab");
config.add(true); assert.notEqual(config.configs.at(-1).id, id); assert.equal(config.configs.at(-1).legacyTabName, undefined);

panes[0].program.shell = false;
api.runConfig(saved);
assert.equal(store["codenav.runPending"].space, "one");
const sent = sends.length;
space = { id: "two", active: true, folder: "/repo", tabs: [] };
await api.restartPending();
assert.equal(sends.length, sent, "restart confirmation cannot send into the previous workspace after switching spaces");
assert.equal(notices.at(-1).title, "Run cancelled");
assert.equal(api.configTab(saved), null);
console.log("PASS run configuration IDs, staged migration, rename/copy, native terminal preservation, execution sessions, same-name isolation and workspace guards");

// Idea uses dedicated processes; a cold results copy may observe queued state
// immediately, but ownership must already exist before the tool is opened.
idea = true; space = { id: "one", active: true, folder: "/repo", tabs: [{ id: "t1", name: "Renamed" }] };
panes = [{ tab: "t1", terminal: "term1", program: { shell: true } }];
manualSleep = true;
const results = history.namespace;
onOpenResults = () => { const entry = results.executionStore().entries.at(-1); if (entry?.processOwned) assert.equal(results.claimExecution(entry.id), false, "claim exists before shared publication opens the results tool"); };
const beforeIdeaCommands = commands.length, beforeIdeaSends = sends.filter(args => args[0] === "send").length;
const launch = api.runConfig(saved); await settle();
let state = results.executionStore();
assert.equal(state.entries.length, 1); assert.equal(state.entries[0].state, "running"); assert.equal(state.entries[0].processOwned, true);
assert.equal(results.closeExecution(state.selected), false);
const firstId = state.selected;
while (sleepResolvers.length) { sleepResolvers.shift()(); await settle(); }
await launch;
state = results.executionStore(); assert.equal(state.entries[0].state, "completed"); assert.equal(state.entries[0].exitCode, 0); assert.match(state.entries[0].output, /execution 1/);
assert.equal(commands.slice(beforeIdeaCommands).some(([command]) => command === "tab.new" || command === "tab.select"), false);
assert.equal(sends.filter(args => args[0] === "send").length, beforeIdeaSends, "idea never sends into a user's interactive terminal");
completeProcesses = false;
const second = api.runConfig(saved); await settle();
const secondId = results.executionStore().selected, secondEntry = results.executionStore().entries.find(entry => entry.id === secondId);
assert.equal(secondEntry.output, "", "active service status does not persist a live TTY mirror");
results.selectExecution(firstId);
// A different mod VM has no local claim. Its authoritative read must still
// report the owned process as running with no completion footer.
const freshContext = vm.createContext({ Date, console }), freshProcess = new vm.SourceTextModule(processSource, { context: freshContext });
await freshProcess.link(() => new vm.SyntheticModule(["hc"], function() { this.setExport("hc", overrides.hc); }, { context: freshContext })); await freshProcess.evaluate();
const coldStatus = await freshProcess.namespace.inspectRunProcess(secondEntry);
assert.equal(coldStatus.state, "running"); assert.match(coldStatus.output, /execution 2/);
results.updateExecution(secondId, coldStatus); assert.equal(results.executionStore().selected, firstId);
for (let i = 0; i < 3; i++) { sleepResolvers.shift()(); await settle(); }
assert.equal(results.executionStore().entries.find(entry => entry.id === secondId).state, "running", "a long-running process never becomes untracked because a footer is absent");
const stopped = api.stopConfig(saved); await settle();
while (sleepResolvers.length) { sleepResolvers.shift()(); await settle(); }
await stopped; await second;
state = results.executionStore(); assert.equal(state.selected, firstId); assert.equal(state.entries.find(entry => entry.id === secondId).state, "cancelled");
assert.equal(sleepResolvers.length, 0);
manualSleep = false; completeProcesses = true; onOpenResults = null;
assert.equal(results.closeExecution(firstId), true); assert.equal(results.executionStore().selected, secondId);

const snapshot = { kind: "sql", name: "SQL", command: "SELECT exact_source", spec: { source_id: "one", database: "main", kind: "console" }, job: { state: "queued", results: [] } };
const sqlId = results.beginExecution(snapshot);
snapshot.command = "changed source"; snapshot.spec.database = "changed database";
assert.equal(results.executionStore().entries.find(entry => entry.id === sqlId).command, "SELECT exact_source");
assert.equal(results.executionStore().entries.find(entry => entry.id === sqlId).spec.database, "main");
results.selectExecution(secondId);
results.updateExecution(sqlId, { state: "running", job: { id: "sql-job", state: "running", results: [] } });
assert.equal(results.closeExecution(sqlId), false);
results.updateExecution(sqlId, { state: "cancelled", job: { id: "sql-job", state: "cancelled", results: [] } });
assert.equal(results.executionStore().selected, secondId, "SQL background updates never select their execution");
assert.equal(results.closeExecution(sqlId), true);

// Preserve a deliberately old selected record as newer jobs complete.
results.updateExecution(secondId, { state: "running" });
for (let i = 0; i < 30; i++) {
  const id = results.beginExecution({ kind: "shell", name: `Run ${i}`, command: "echo" });
  results.selectExecution(secondId); results.updateExecution(id, { state: "completed" });
}
results.updateExecution(secondId, { state: "cancelled" });
state = results.executionStore();
assert.ok(state.entries.some(entry => entry.id === secondId));
assert.equal(state.entries.filter(entry => entry.id !== secondId).length, results.EXECUTION_HISTORY_LIMIT);
results.updateExecution(secondId, { state: "running" });
const protectedId = results.beginExecution({ kind: "sql", name: "Running", command: "SELECT" });
results.selectExecution(secondId);
const large = "x".repeat(17 * 1024 * 1024);
const oversizedId = results.beginExecution({ kind: "sql", name: "Large", command: "SELECT", job: { results: [{ rows: [[large]] }] } });
results.updateExecution(oversizedId, { state: "completed" });
assert.equal(results.executionStore().entries.find(entry => entry.id === oversizedId).job.results[0].rows[0][0].length, large.length, "selected results retain every row value even above the retention budget");
results.selectExecution(secondId);
results.updateExecution(secondId, { state: "cancelled" });
assert.ok(!results.executionStore().entries.some(entry => entry.id === oversizedId), "over-budget completed executions evict whole entries, never row fragments");
assert.ok(results.executionStore().entries.some(entry => entry.id === protectedId), "running entries survive retention pressure");
space = { ...space, id: "other" };
assert.equal(results.executionStore().entries.length, 0, "history is isolated per workspace");
space = { ...space, id: "one" };
store["codenav.runSessions"][":/repo@one"][id] = { configuration: id, terminal: "term1", tab: "t1" };
const untrackedId = results.beginExecution({ kind: "shell", name: "Lost monitor", command: saved.command, configuration: id, terminal: "term1" });
results.updateExecution(untrackedId, { state: "untracked" });
results.markUntrackedSession({ configuration: id, terminal: "term1" });
panes[0].program.shell = true;
assert.equal(results.closeExecution(untrackedId), true);
assert.equal(api.isRunning(saved), true, "closing an untracked result does not permit overwriting its owned terminal");
const sendCount = sends.filter(args => args[0] === "send").length;
api.runConfig(saved);
assert.ok(store["codenav.runPending"], "an untracked owned session still requires restart confirmation");
assert.equal(sends.filter(args => args[0] === "send").length, sendCount);
await api.restartPending();
assert.equal(store["codenav.runSessions"][":/repo@one"][id].processOwned, true, "confirmed interruption migrates the legacy run to a dedicated process");
assert.equal(sends.filter(args => args[0] === "send").length, sendCount, "even confirmed idea reruns never type into the old terminal");
config.release();
console.log("PASS native execution snapshots, independent viewed/active runs, stop, close neighbors, background monitor completion, SQL snapshots, scoped and bounded whole-entry history");

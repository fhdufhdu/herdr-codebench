// Run: node --experimental-vm-modules design/idea/check_run_process.mjs
// Only dedicated synthetic terminals created by this test may be interrupted,
// killed or removed. Existing user terminals and application UI are untouched.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const execute = promisify(execFile), folder = await mkdtemp(join(tmpdir(), "codebench-run-process-")), owned = new Set(), requests = [];
const hc = async args => {
  requests.push(args);
  if (["interrupt", "kill", "rm"].includes(args[0])) assert.ok(owned.has(args[1]), "test cleanup can only target its own synthetic process");
  try { const result = await execute("hc", args, { cwd: folder }); return { code: 0, ...result }; }
  catch (error) { return { code: error.code || 1, stdout: error.stdout || "", stderr: error.stderr || "" }; }
};
const context = vm.createContext({ console, Date });
const module = new vm.SourceTextModule(await readFile(new URL("../../mods/codenav/run-process.js", import.meta.url), "utf8"), { context });
await module.link(() => new vm.SyntheticModule(["hc"], function() { this.setExport("hc", hc); }, { context })); await module.evaluate();
const api = module.namespace, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const entry = name => ({ id: `t36-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`, processOwned: true, state: "queued", launching: true, folder, startedAt: Date.now() });
async function launch(item, command) { item.terminal = await api.launchRunProcess(item, command); owned.add(item.terminal); item.launching = false; item.state = "running"; return item; }
async function finished(item) {
  for (let i = 0; i < 30; i++) { const state = await api.inspectRunProcess(item); if (state.state !== "running") return state; await pause(100); }
  throw new Error("Synthetic process did not finish in time");
}
try {
  const layoutModule = new vm.SourceTextModule(await readFile(new URL("../../mods/codenav/execution-layout.js", import.meta.url), "utf8"), { context });
  const treeModule = new vm.SourceTextModule(await readFile(new URL("../../mods/codenav/layout-tree.js", import.meta.url), "utf8"), { context });
  await treeModule.link(() => {}); await treeModule.evaluate();
  await layoutModule.link(() => treeModule); await layoutModule.evaluate();
  const applyLayout = layoutModule.namespace.executionTerminalLayout, find = treeModule.namespace.find;
  const plain = value => JSON.parse(JSON.stringify(value));
  const hostRoundTrip = value => JSON.parse(JSON.stringify(value, (key, item) =>
    key === "hidden" && item === false || key === "max" && item === null ? undefined : item));
  const original = { id: "bottom-run-results", type: "block", size: { weight: 0.6 }, min: 110, max: 900, hidden: false, content: { mod: "codenav", props: { view: "run-results" } } };
  const other = { id: "user-terminal", type: "block", content: { terminal: "untouched" }, size: { px: 245 } };
  const tree = { id: "bottom-tools", type: "stack", active: original.id, children: [plain(original), plain(other)] };
  assert.equal(applyLayout(tree, { terminal: "synthetic-live" }, 72), true);
  assert.equal(applyLayout(tree, { terminal: "synthetic-live" }, 72), false, "unchanged native content never rewrites the layout");
  assert.equal(applyLayout(hostRoundTrip(tree), { terminal: "synthetic-live" }, 72), false, "host omission of visible defaults must not create a live layout/redraw loop");
  assert.equal(find(tree, "execution-output").type, "stack", "a stable stack isolates native terminal removal from the result column");
  // Mirror host Node::remove: remove the ended chrome terminal; collapse
  // one-child rows/columns, retaining stacks even when they are empty.
  const hostRemove = (parent, id) => {
    if (!parent.children) return;
    parent.children = parent.children.filter(child => child.id !== id);
    for (const child of parent.children) hostRemove(child, id);
    if (parent.type !== "stack") parent.children = parent.children.map(child => {
      if (["row", "column"].includes(child.type) && child.children.length === 1) return { ...child.children[0], size: child.size };
      return child;
    });
  };
  hostRemove(tree, "execution-terminal");
  assert.ok(find(tree, "bottom-run-results"), "native Ended retains the result identity");
  assert.equal(find(tree, "execution-output").children.length, 0);
  assert.equal(applyLayout(tree, null, 72), true);
  assert.equal(find(tree, "execution-controls").size.weight, 1, "final transcript regains the entire available result body");
  assert.equal(find(tree, "execution-output").hidden, true);
  assert.equal(applyLayout(hostRoundTrip(tree), null, 72), false, "host omission of unbounded max must not create a finished transcript layout/redraw loop");
  assert.equal(applyLayout(tree, { terminal: "synthetic-rerun" }, 72), true);
  assert.equal(find(tree, "execution-terminal").content.terminal, "synthetic-rerun");
  for (const key of ["size", "min", "max", "hidden"]) assert.deepEqual(plain(find(tree, original.id)[key]), original[key]);
  assert.equal(tree.active, original.id); assert.deepEqual(plain(find(tree, other.id)), other);
  const collapsed = { id: "bottom-tools", type: "stack", active: original.id, children: [{ ...plain(original), id: "execution-controls", min: 72, max: 72 }, plain(other)] };
  assert.equal(applyLayout(collapsed, null, 72), true, "already-collapsed installed layouts recover their result id");
  assert.equal(find(collapsed, original.id).size.weight, 0.6);
  assert.equal(find(collapsed, original.id).max, undefined, "leaked fixed header bounds no longer clamp the result body");
  assert.equal(find(collapsed, "execution-controls").min, 0);
  assert.deepEqual(plain(find(collapsed, other.id)), other);
  const legacy = { ...plain(original), type: "column", children: [{ id: "execution-controls", type: "block", content: original.content }, { id: "execution-terminal", type: "block", content: { terminal: "old-live" } }] };
  delete legacy.content;
  assert.equal(applyLayout(legacy, { terminal: "old-live" }, 72), true, "existing direct native blocks migrate under the stable stack");
  assert.equal(find(legacy, "execution-output").children[0].id, "execution-terminal");
  const missingBody = { id: "bottom-run-results", type: "column", children: [{ id: "execution-controls", type: "block", content: original.content, size: { px: 84 }, min: 84, max: 84 }], gap: 0, resizable: false };
  assert.equal(applyLayout(missingBody, null, 84), true, "the installed header-only layout regains a transcript body after native Ended");
  assert.equal(find(missingBody, "execution-controls").max, null);
  assert.equal(applyLayout(missingBody, { terminal: "next-live" }, 84), true);
  assert.equal(find(missingBody, "execution-terminal").content.terminal, "next-live", "subsequent live runs recover after the old terminal block was deleted");
  console.log("PASS native Ended layout lifecycle: stable result identity/bounds, removed body repair, rerun, installed collapse migration and unrelated terminal preservation");
  const item = await launch(entry("output"), "printf 'T29-first\\n'; pwd; sleep 0.6; printf 'T29-last\\n'");
  const running = await api.inspectRunProcess(item); assert.equal(running.state, "running"); assert.match(running.output, /T29-first/);
  const beforeStatusReads = requests.filter(args => args[0] === "read").length;
  const statusOnly = await api.inspectRunProcess({ ...item, output: "previous snapshot" }, { captureOutput: false });
  assert.equal(statusOnly.state, "running"); assert.equal(statusOnly.output, "previous snapshot");
  assert.equal(requests.filter(args => args[0] === "read").length, beforeStatusReads, "live status never copies the native TTY screen into shared JSON");
  const recovered = await api.inspectRunProcess({ ...item, terminal: undefined }); assert.equal(recovered.terminal, item.terminal, "a missing address recovers through the unique execution label, never relaunches");
  const done = await finished(item); assert.equal(done.state, "completed"); assert.equal(done.exitCode, 0); assert.match(done.output, /T29-last/); assert.ok(done.output.includes(folder));
  const finalWithoutLiveCapture = await api.inspectRunProcess(item, { captureOutput: false }); assert.match(finalWithoutLiveCapture.output, /T29-last/, "completed jobs still retain their final output fallback");
  assert.equal(api.runTerminalContent({ ...item, ...done }), null, "finished output uses its retained transcript, never a rejected native attach");
  assert.equal(api.runTerminalContent({ ...item, state: "running", nativeState: "finished" }), null, "authoritative native finish wins a stale running state");
  assert.equal(api.runTerminalContent({ ...item, processOwned: false }), null, "legacy/codebench terminals never enter the dedicated native body");
  assert.equal(api.runTerminalContent({ ...item, terminal: null }), null);
  const readsBefore = requests.filter(args => args[0] === "read").length;
  await assert.rejects(() => api.inspectRunProcess({ ...item, id: "not-this-execution" }), /no longer belongs/);
  assert.equal(requests.filter(args => args[0] === "read").length, readsBefore, "mismatched execution IDs never read another terminal's output");
  const queued = await api.inspectRunProcess(entry("not-submitted-yet")); assert.equal(queued.state, "queued");
  await assert.rejects(() => api.inspectRunProcess({ ...entry("lost-launch"), startedAt: Date.now() - 20000 }), /could not be recovered/);
  assert.deepEqual(JSON.parse(JSON.stringify(api.runTerminalContent(item))), { terminal: item.terminal });
  const nonzero = await launch(entry("failure"), "printf 'T29-failure\\n' >&2; exit 7");
  const failed = await finished(nonzero); assert.equal(failed.state, "error"); assert.equal(failed.exitCode, 7); assert.match(failed.output, /T29-failure/);
  const long = await launch(entry("cancel"), "printf 'T29-long\\n'; sleep 30");
  const live = await api.inspectRunProcess(long); assert.equal(live.state, "running");
  const stopped = await api.stopRunProcess(long); assert.equal(stopped.state, "cancelled");
  assert.equal(api.runTerminalContent({ ...long, ...stopped }), null);
  const fast = await launch(entry("fast"), "printf 'T36-fast-out\\n'; printf 'T36-fast-err\\n' >&2; exit 4");
  await pause(100);
  const fastDone = await api.inspectRunProcess(fast, { captureOutput: false });
  assert.equal(fastDone.state, "error"); assert.equal(fastDone.exitCode, 4);
  assert.match(fastDone.output, /T36-fast-out/); assert.match(fastDone.output, /T36-fast-err/);
  assert.equal(api.runTerminalContent({ ...fast, ...fastDone }), null, "commands finished before the first status read still display their transcript");
  const silent = await launch(entry("silent"), "exit 0");
  const silentDone = await finished(silent); assert.equal(silentDone.state, "completed"); assert.equal(silentDone.exitCode, 0);
  assert.equal(api.runTerminalContent({ ...silent, ...silentDone }), null, "silent completion leaves the result renderer responsible for an explicit empty-output state");
  const sends = requests.filter(args => args[0] === "run"); assert.equal(sends.length, 5);
  assert.ok(sends.every(args => args.includes("--no-parent") && args.includes("--no-notify") && !args.includes("--keep")));
  assert.equal(requests.some(args => args[0] === "send"), false, "execution never types into an existing interactive terminal");
  console.log("PASS actual synthetic core processes: live stdout/stderr, cwd, unique-label recovery, native exit codes, precise cancellation, no terminal tab UI or command replay");
} finally {
  for (const terminal of owned) {
    const detail = JSON.parse((await hc(["get", terminal, "--json"])).stdout || "{}");
    if (detail.state !== "finished") await hc(["kill", terminal]);
    await hc(["rm", terminal]);
  }
  await rm(folder, { recursive: true, force: true });
}

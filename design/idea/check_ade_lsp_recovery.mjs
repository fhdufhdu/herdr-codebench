import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../../mods/ade/lsp-session.js", import.meta.url), "utf8");
const unavailable = () => Object.assign(new Error("engine temporarily unavailable"), { code: "engine_unavailable" });
async function fixture() {
  const env = { pid: 1, now: 1000, failSync: 0, conflict: false, lease: null, calls: [], updates: [], timers: [] };
  const status = () => ({ pid: env.pid, version: "fixture", started: env.pid });
  const bindings = { backendStatus: async () => { env.calls.push({ method: "health" }); return status(); },
    backendCleanup: async (_method, body) => { env.calls.push({ method: "close", body }); env.lease = null; return { closed: true }; },
    backend: async (method, body, _cx, options) => {
      if (options?.shouldSend && !options.shouldSend()) throw new Error("closed before send");
      options?.onEngine?.(status()); options?.onSend?.(); env.calls.push({ method, body });
      if (method === "document_sync") {
        if (env.conflict) throw Object.assign(new Error("document owner conflict"), { code: "owner_conflict" });
        if (env.failSync) { env.failSync--; throw unavailable(); }
        env.lease = { ...body }; return { path: body.path, revision: body.revision, document_owner: body.document_owner };
      }
      if (method === "tokens") return [];
      if (!env.lease) throw Object.assign(new Error("document is not open"), { code: "lease_missing" });
      if (env.lease.document_owner !== body.document_owner) throw Object.assign(new Error('document owner conflict'), { code: 'owner_conflict' });
      const snapshot = { path: body.path, revision: body.revision, document_owner: body.document_owner };
      if (method === "symbols") {
        if (env.holdSymbols && body.revision === 0) return new Promise(resolve => { env.releaseSymbols = () => resolve({ ...snapshot, value: [{ name: "stale" }] }); });
        return { ...snapshot, value: [{ name: `symbols-${body.revision}`, line: 0, col: 0 }] };
      }
      return { ...snapshot, value: method === "diagnostics" ? { items: [], version_confidence: "matched" } : [] };
    } };
  const context = vm.createContext({ console, Date: class extends Date { static now() { return env.now; } } }), module = new vm.SourceTextModule(source, { context });
  await module.link(async () => new vm.SyntheticModule(Object.keys(bindings), function () { for (const [name, value] of Object.entries(bindings)) this.setExport(name, value); }, { context }));
  await module.evaluate();
  const cx = { spawn(fn) { void fn(cx); }, timer: { after(ms, fn) { const timer = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; env.timers.push(timer); return timer; } } };
  const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  const fire = async ms => {
    const timer = env.timers.find(timer => timer.ms === ms && !timer.cancelled);
    assert.ok(timer, `missing ${ms}ms timer`); env.now += ms; timer.cancelled = true; timer.fn(cx); await settle();
  };
  const doc = { project: { id: "fixture", root: "/fixture" }, path: "/fixture/main.ts", text: "const count = 1;", revision: 0, selection: { head: 5 } };
  const session = new module.namespace.LspSession(); session.init(cx, { onUpdate: state => env.updates.push(state) }); session.setActive(true, cx);
  return { env, cx, doc, session, fire, settle };
}

const recovered = await fixture();
recovered.env.failSync = 1; recovered.session.sync(recovered.doc, recovered.cx); await recovered.fire(0);
assert.equal(recovered.session.state.status, "error"); const owner = recovered.session.owner;
recovered.session.sync({ ...recovered.doc, selection: { head: 6 } }, recovered.cx);
await recovered.fire(500);
assert.equal(recovered.session.state.status, "ready"); assert.equal(recovered.session.state.symbolsStatus, "ready");
assert.equal(recovered.session.owner, owner); assert.equal(recovered.env.calls.filter(call => call.method === "document_sync").length, 2);
assert.equal(recovered.env.calls.filter(call => call.method === "document_sync").at(-1).body.revision, 0, "unchanged text/revision is resynchronized after failure");

const bounded = await fixture(); bounded.env.failSync = Infinity; bounded.session.sync(bounded.doc, bounded.cx); await bounded.fire(0);
for (const delay of [500, 1500, 4000]) await bounded.fire(delay);
assert.equal(bounded.env.calls.filter(call => call.method === "document_sync").length, 4);
bounded.session.sync(bounded.doc, bounded.cx); await bounded.settle();
assert.ok(!bounded.env.timers.some(timer => [500, 1500, 4000].includes(timer.ms) && !timer.cancelled), "unchanged cursor events cannot reset an exhausted retry budget");
bounded.env.failSync = 0; await bounded.session.retry(bounded.cx); assert.equal(bounded.session.state.status, "ready");

const conflict = await fixture(); conflict.env.conflict = true; conflict.session.sync(conflict.doc, conflict.cx); await conflict.fire(0);
assert.equal(conflict.session.state.status, "error");
const conflictedOwner = conflict.session.owner;
for (const delay of [500, 1500, 4000]) await conflict.fire(delay);
assert.equal(conflict.env.calls.filter(call => call.method === 'document_sync').length, 4);
assert.ok(conflict.env.calls.filter(call => call.method === 'document_sync').every(call => call.body.document_owner === conflictedOwner), 'handoff retries keep the same owner and never steal or rotate');
assert.match(conflict.session.state.error, /다른 편집기/);
assert.ok(!conflict.env.calls.some(call => call.method === 'close'), 'conflict repair never closes an unknown owner');
conflict.env.now += 65000; await conflict.fire(10000);
assert.equal(conflict.env.calls.filter(call => call.method === 'document_sync').length, 5, 'one same-owner recheck follows server expiry eligibility');
await conflict.fire(10000);
assert.equal(conflict.env.calls.filter(call => call.method === 'document_sync').length, 5, 'a still-live owner is not probed endlessly');
conflict.env.pid = 2; conflict.env.conflict = false; await conflict.fire(10000);
assert.equal(conflict.session.state.status, 'ready'); assert.equal(conflict.session.owner, conflictedOwner, 'a new engine can recover a previously conflicting unchanged buffer');

const restarted = await fixture(); restarted.session.sync(restarted.doc, restarted.cx); await restarted.fire(0);
const originalOwner = restarted.session.owner, originalGeneration = restarted.session.generation;
restarted.env.pid = 2; restarted.env.lease = null;
// A dead earlier task is bypassed only after authoritative engine identity changes.
restarted.session.serial = new Promise(() => {}); restarted.session.flushPromise = new Promise(() => {}); restarted.session.flushGeneration = originalGeneration;
await restarted.fire(10000);
assert.equal(restarted.session.state.status, "ready"); assert.equal(restarted.session.state.symbols[0].name, "symbols-0");
assert.ok(restarted.session.generation > originalGeneration); assert.equal(restarted.session.owner, originalOwner);
assert.equal(restarted.env.lease.text, restarted.doc.text, "restart repair preserves the unsaved snapshot");
const beforeQuiet = restarted.env.updates.length; await restarted.fire(10000);
assert.equal(restarted.env.updates.length, beforeQuiet, "an unchanged engine health check does not redraw");
assert.equal(restarted.env.calls.at(-1).method, 'document_touch');
assert.equal(restarted.env.calls.at(-1).body.document_owner, originalOwner); assert.equal(restarted.env.calls.at(-1).body.revision, 0);
assert.equal(restarted.env.calls.at(-1).body.text, undefined, 'heartbeat renews only the exact lease metadata, never resends source');
restarted.session.setActive(false, restarted.cx);
assert.ok(!restarted.env.timers.some(timer => timer.ms === 10000 && !timer.cancelled), "inactive buffers stop identity observation");

const missing = await fixture(); missing.session.sync(missing.doc, missing.cx); await missing.fire(0);
missing.env.lease = null;
missing.session.serial = new Promise(() => {}); missing.session.flushPromise = new Promise(() => {}); missing.session.flushGeneration = missing.session.generation;
await missing.session.request("definition", missing.cx); assert.equal(missing.session.synced, null);
await missing.fire(500); assert.equal(missing.session.state.status, "ready");

const stale = await fixture(); stale.env.holdSymbols = true; stale.session.sync(stale.doc, stale.cx); await stale.fire(0);
stale.session.sync({ ...stale.doc, text: "const count = 2;", revision: 1 }, stale.cx); await stale.fire(250);
assert.equal(stale.session.state.symbols[0].name, "symbols-1"); stale.env.releaseSymbols(); await stale.settle();
assert.equal(stale.session.state.symbols[0].name, "symbols-1", "delayed pre-recovery symbols cannot replace the latest outline");
const lostHeartbeat = await fixture(); lostHeartbeat.session.sync(lostHeartbeat.doc, lostHeartbeat.cx); await lostHeartbeat.fire(0);
lostHeartbeat.env.lease = null; await lostHeartbeat.fire(10000); assert.equal(lostHeartbeat.session.synced, null);
await lostHeartbeat.fire(500); assert.equal(lostHeartbeat.session.state.status, 'ready');
for (const item of [recovered, bounded, conflict, restarted, missing, stale, lostHeartbeat]) await item.session.close(item.cx);
console.log("ADE LSP recovery: bounded unchanged-buffer retry, owner safety, active restart recovery, quiet health checks, missing-lease repair and stale outline guards passed");

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function load(file, bindings, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  const module = new vm.SourceTextModule(await fs.readFile(new URL(`../../mods/ade/${file}`, import.meta.url), "utf8"), { context });
  await module.link(async name => {
    const values = bindings[name]; assert.ok(values, `Unexpected dependency ${name}`);
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  });
  await module.evaluate(); return module.namespace;
}
const files = new Map(), fetches = [], processCalls = [];
const service = { engine: "herdr-codebench-go", version: "fixture", pid: 42, port: 12345, token: "fixture-private-value" };
let fail = false, portOccupied = false;
const transport = await load("backend.js", {
  herdr: { home: () => "/home", appHome: () => "/app", readTextFile: async path => files.get(path) ?? null,
    exec: async (...args) => { processCalls.push(args); return { code: 0, stdout: "herdr-codebench-go fixture darwin/arm64\n" }; },
    hc: async args => { processCalls.push(args); files.set("/home/.cache/herdr-codenav/engine.json", JSON.stringify(service)); return { code: 0 }; } },
  os: { platform: () => "darwin", arch: () => "arm64" },
}, { fetch: async (url, options) => {
  fetches.push({ url, options });
  if (!options.headers["X-Codenav-Token"]) {
    if (!portOccupied) throw new Error("connection refused");
    return { ok: false, status: 401, json: async () => ({ ok: false }) };
  }
  assert.equal(options.headers["X-Codenav-Token"], service.token);
  if (fail && !url.endsWith('/health')) throw new Error("disconnected");
  return { ok: true, status: 200, json: async () => ({ ok: true, result: url.endsWith("/health") ? service : { success: true } }) };
} });
files.set("/home/.cache/herdr-codenav/engine.json", JSON.stringify(service));
const phases = [];
const phaseTurns = [];
await transport.backend("tokens", { text: "unsaved" }, { sleep: async ms => phaseTurns.push(ms) }, { onPhase: phase => phases.push(phase) });
assert.deepEqual(phaseTurns, [], "diagnostic phases do not introduce speculative task turns");
assert.deepEqual(phases, ["read-state", "health", "request", "reply"]);
assert.equal(fetches.length, 2); assert.equal(processCalls.length, 0);
fail = true;
await assert.rejects(transport.backend("database_apply", { query: "mutating" }), /자동 재실행/);
assert.equal(fetches.filter(call => call.url.endsWith("/database_apply")).length, 1, "mutations are never replayed");
fail = false; files.clear();
await assert.rejects(transport.backend("tokens", {}, { sleep: async () => {} }), /설치된 엔진이 없습니다/);
files.set("/app/data/codebench-engine/manifest.json", JSON.stringify({ engine: service.engine, version: service.version, targets: [{ os: "darwin", arch: "arm64", file: "darwin-arm64/herdr-engine" }] }));
files.set("/app/mods/codenav/bridge/servers.json", "{}");
await transport.backend("tokens", {}, { sleep: async () => {} });
const launch = processCalls.find(args => args[0] === "run");
assert.ok(launch.includes("--no-parent") && launch.includes("--no-notify"));
assert.equal(launch[launch.indexOf("--port") + 1], "47822");
assert.equal(launch[launch.indexOf("--state") + 1], "/home/.cache/herdr-codenav/engine.json");
fail = true; await assert.rejects(transport.backend("tokens", {})); fail = false;
files.delete("/home/.cache/herdr-codenav/engine.json"); portOccupied = true;
const processCount = processCalls.length;
await assert.rejects(transport.backend("tokens", {}, { sleep: async () => {} }), /47822/);
assert.equal(processCalls.length, processCount, "an unknown occupied port is never replaced");

const calls = [], timers = [], tasks = [], updates = [], navigations = [];
let delayed = null, confidence = "unversioned", cleanupHandler = null;
const sessionAPI = await load("lsp-session.js", { "./backend.js": { backend: async (method, body, _cx, options) => {
  if (options?.shouldSend && !options.shouldSend()) throw new Error('session closed before send');
  options?.onSend?.();
  calls.push({ method, body });
  if (delayed?.method === method && delayed.revision === body.revision) return new Promise((resolve, reject) => { delayed.resolve = resolve; delayed.reject = reject; });
  if (body.path === '/cache/sources/library.java') {
    if (method === 'info') return { lang: 'java', library: true, semantic: true };
    if (method === 'tokens') return [];
    if (method === 'diagnostics') return { items: [], supported: false, version_confidence: 'unversioned' };
    if (method === 'symbols') return [{ name: 'LibraryType', line: 0, col: 0 }];
    if (method === 'hover') return { markdown: 'original URI type info' };
    if (method === 'definition') return [{ path: '/cache/sources/target.java', external: true, line: 1, col: 0 }];
    throw new Error('unexpected library write or request ' + method);
  }
  const snapshot = { path: body.path, document_owner: body.document_owner, revision: body.revision };
  if (method === "document_sync") return snapshot;
  if (method === "document_close") return { ...snapshot, closed: true };
  if (method === "tokens") return [{ start: 0, end: 2, kind: "keyword" }];
  if (method === "diagnostics") return { ...snapshot, value: { items: [{ message: `revision ${body.revision}` }], version_confidence: confidence } };
  return { ...snapshot, value: method === "hover" ? { markdown: "hover" } : [{ path: "/target", line: 1, col: 2 }] };
}, backendStatus: async () => ({ pid: 1, version: 'fixture' }), backendCleanup: async (method, body, _cx, options) => {
  calls.push({ method, body, options });
  return cleanupHandler ? cleanupHandler(method, body) : { ...body, closed: true };
} } });
const nativeOwner = { nativeADEFrame: true }, taskOwners = [];
const cx = { sleep: async () => {}, notify() {}, spawn(fn, options) { taskOwners.push(options?.owner); const task = fn(cx); tasks.push(task); }, timer: { after(ms, fn, options) { taskOwners.push(options?.owner);
  const timer = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(timer); return timer;
} } };
const drain = async () => { while (tasks.length) await tasks.shift(); };
const doc = { project: { id: "a", root: "/project", machine: null }, path: "/project/main.ts", text: "😀one\nsecond", revision: 0, selection: { head: 2 } };
const session = new sessionAPI.LspSession(); session.init(cx, { owner: nativeOwner, onUpdate: state => updates.push(state), onNavigate: item => navigations.push(item) });
session.sync(doc, cx); session.sync({ ...doc, revision: 1, text: "😀two\nsecond" }, cx);
assert.equal(timers[0].ms, 0, 'first document open does not wait for the edit debounce');
assert.equal(timers[0].cancelled, true); assert.equal(timers.at(-1).ms, 250);
assert.equal(calls.length, 0, "typing is debounced");
timers.at(-1).fn(cx); await drain();
assert.deepEqual(calls.slice(0, 4).map(call => call.method), ["document_sync", "symbols", "diagnostics", "tokens"]);
assert.equal(session.state.revision, 1); assert.equal(session.state.confidence, "unversioned");
assert.ok(taskOwners.length > 0); assert.ok(taskOwners.every(owner => owner === nativeOwner), "session timers and nested spawns retain the native ADE owner");
const selectionTimers = timers.length, selectionCalls = calls.length;
session.sync({ ...session.snapshot, selection: { head: 2, anchor: 2 } }, cx);
assert.equal(timers.length, selectionTimers); assert.equal(calls.length, selectionCalls, "selection alone does not reparse or resync text");
await session.request("definition", cx);
assert.equal(calls.at(-1).body.col, 2, "astral graphemes retain UTF16 offsets"); assert.equal(navigations.length, 1);
const definitionList = await session.request('definition', cx, { navigate: false });
assert.equal(definitionList.locations.length, 1); assert.equal(navigations.length, 1, 'definition lists do not navigate before choosing a location');
for (const [kind, route, wireKind] of [['super', 'related', 'super'], ['implementation', 'definition', 'implementation'], ['type-definition', 'definition', 'typeDefinition']]) {
  await session.request(kind, cx, { navigate: false });
  assert.equal(calls.at(-1).method, route); assert.equal(calls.at(-1).body.kind, wireKind);
  assert.equal(calls.at(-1).body.document_owner, session.owner, 'new navigation keeps the unsaved buffer lease');
}
const completionReply = await session.editorRequest('completion', cx);
assert.equal(completionReply.revision, 1); assert.equal(completionReply.offset, 2);
assert.equal(calls.at(-1).body.document_owner, session.owner); assert.equal(calls.at(-1).body.col, 2);
await session.editorRequest('formatting', cx, { tab_size: 4, insert_spaces: true });
assert.equal(calls.at(-1).body.tab_size, 4); assert.equal(calls.at(-1).body.line, undefined);
// Same-revision caret movement also invalidates completion, without resyncing text.
delayed = { method: 'completion', revision: 1 };
const movedCompletion = session.editorRequest('completion', cx); await Promise.resolve();
session.sync({ ...session.snapshot, selection: { head: 3 } }, cx);
assert.equal(session.state.status, 'ready', 'caret cancellation resets pending request immediately');
delayed.resolve({ path: doc.path, document_owner: session.owner, revision: 1, value: { items: [{ label: 'old' }] } });
assert.equal(await movedCompletion, null); assert.equal(session.state.status, 'ready'); delayed = null;
// References have the same cancellation rule, even before their transport resolves.
delayed = { method: 'references', revision: 1 };
const movedReferences = session.request('references', cx); await Promise.resolve();
session.sync({ ...session.snapshot, selection: { head: 4 } }, cx);
assert.equal(session.state.status, 'ready'); assert.equal(session.state.locations.length, 0);
delayed.resolve({ path: doc.path, document_owner: session.owner, revision: 1, value: [{ path: '/stale' }] });
assert.equal(await movedReferences, undefined); assert.equal(session.state.status, 'ready'); delayed = null;
session.sync({ ...session.snapshot, selection: { head: 2 } }, cx);
const position = sessionAPI.utf16Position(doc.text, 8);
assert.equal(position.line, 1); assert.equal(position.col, 2);
// A delayed old semantic response must not publish after the next revision.
delayed = { method: "hover", revision: 1 };
const oldHover = session.request("hover", cx);
await Promise.resolve();
session.sync({ ...doc, revision: 2, text: "new", selection: null }, cx);
delayed.resolve({ path: doc.path, document_owner: session.owner, revision: 1, value: { markdown: "stale" } });
await oldHover;
assert.equal(session.state.hover, null);
delayed = null; timers.at(-1).fn(cx); await drain();
const beforeNoCursor = calls.length;
await session.request("hover", cx);
assert.equal(calls.length, beforeNoCursor); assert.match(session.state.error, /커서/);
session.sync({ ...session.snapshot, selection: { head: 0 } }, cx);
delayed = { method: 'references', revision: 2 };
const timedReference = session.request('references', cx); await Promise.resolve();
const deadline = timers.findLast(timer => timer.ms === 30000 && !timer.cancelled);
assert.ok(deadline); deadline.fn(cx); assert.equal(session.state.requestPhase, 'timeout'); assert.equal(session.state.status, 'error');
delayed.resolve({ path: doc.path, document_owner: session.owner, revision: 2, value: [{ path: '/late' }] });
await timedReference; delayed = null; assert.equal(session.state.requestPhase, 'timeout', 'late transport cannot replace deadline error');
await session.close(cx);
assert.equal(calls.at(-1).method, "document_close"); assert.equal(calls.at(-1).body.revision, 2);
assert.equal(calls.at(-1).body.document_owner, session.owner);
const count = updates.length; session.sync(doc, cx); assert.equal(updates.length, count);
const remote = new sessionAPI.LspSession(); remote.init(cx, {});
const beforeRemote = calls.length; remote.sync({ ...doc, project: { ...doc.project, machine: "remote" } }, cx);
assert.equal(remote.state.status, "unavailable"); assert.equal(calls.length, beforeRemote);
// Write acknowledgements are ordered even when the newer timer fires before
// the old transport response; old diagnostics are never requested afterward.
const ordered = new sessionAPI.LspSession(); ordered.init(cx, {});
delayed = { method: "document_sync", revision: 0 };
ordered.sync(doc, cx); timers.at(-1).fn(cx);
await Promise.resolve(); await Promise.resolve();
ordered.sync({ ...doc, revision: 1, text: "new revision" }, cx); timers.at(-1).fn(cx);
const orderedStart = calls.length;
delayed.resolve({ path: doc.path, document_owner: ordered.owner, revision: 0 }); delayed = null;
await drain();
assert.ok(!calls.slice(orderedStart).some(call => call.method === "diagnostics" && call.body.revision === 0));
assert.equal(ordered.state.revision, 1); assert.equal(ordered.state.status, "ready");
await ordered.close(cx);
// A close waits only for its pending write and releases that exact lease;
// semantic replies received after close have no update callback.
const closing = new sessionAPI.LspSession(); closing.init(cx, {});
delayed = { method: "document_sync", revision: 0 };
closing.sync(doc, cx); timers.at(-1).fn(cx);
await Promise.resolve(); await Promise.resolve();
const released = closing.close(cx);
delayed.resolve({ path: doc.path, document_owner: closing.owner, revision: 0 }); delayed = null;
await drain(); await released;
assert.equal(calls.at(-1).method, "document_close"); assert.equal(calls.at(-1).body.revision, 0);
// Published diagnostics can arrive after sync. Observation is bounded, and
// closing/editing cancels its owned timer.
confidence = "pending";
const publishing = new sessionAPI.LspSession(); publishing.init(cx, {});
publishing.sync(doc, cx); timers.at(-1).fn(cx); await drain();
assert.equal(timers.at(-1).ms, 500);
confidence = "matched"; timers.at(-1).fn(cx); await drain();
assert.equal(publishing.state.confidence, "matched");
await publishing.close(cx);
// HMR cancels old tasks: their pending promise must never hold final cleanup.
const cancelled = new sessionAPI.LspSession(); cancelled.init(cx, {});
cancelled.attempted = { ...doc, revision: 7 }; cancelled.serial = new Promise(() => {});
let cleanupFinished = false;
const cancellationClose = cancelled.close(cx).then(() => { cleanupFinished = true; });
for (let i = 0; i < 6; i++) await Promise.resolve();
assert.equal(cleanupFinished, true, 'close must not await a cancelled never-resolving serial promise'); await cancellationClose;
assert.equal(calls.at(-1).body.revision, 7);
const singleClose = new sessionAPI.LspSession(); singleClose.init(cx, {});
singleClose.attempted = { ...doc }; singleClose.engineIdentity = { pid: 43, version: 'fixture', started: 19 };
let rejectClose;
cleanupHandler = () => new Promise((_resolve, reject) => { rejectClose = reject; });
const beforeSingleClose = calls.length, closeOnce = singleClose.close(cx), closeAgain = singleClose.close(cx);
assert.equal(closeOnce, closeAgain, 'concurrent cleanup must share one pending promise even after alive=false');
assert.equal(singleClose.alive, false); assert.equal(calls.length, beforeSingleClose + 1);
assert.equal(calls.at(-1).options.engine, singleClose.engineIdentity, 'cleanup carries the engine generation that accepted its lease');
rejectClose(new Error('temporary cleanup transport failure'));
await assert.rejects(closeOnce, /temporary cleanup/);
assert.equal(singleClose.closed, undefined);
cleanupHandler = null;
const retriedClose = singleClose.close(cx);
assert.notEqual(retriedClose, closeOnce, 'failed exact-owner cleanup remains retryable');
await retriedClose;
assert.equal(singleClose.closed, true); assert.equal(calls.length, beforeSingleClose + 2);
assert.equal(calls.at(-1).body.document_owner, singleClose.owner, 'cleanup retries preserve the exact old owner');
await singleClose.close(cx); assert.equal(calls.length, beforeSingleClose + 2, 'successful close remains idempotent');
// Latest attempted revision not yet accepted: closing the acknowledged lease
// retires the same owner, preventing that late sync from resurrecting it.
const retired = new Set(), racing = new sessionAPI.LspSession(); racing.init(cx, {});
racing.attempted = { ...doc, revision: 2 }; racing.acknowledged = { ...doc, revision: 1 };
let lease = { owner: racing.owner, revision: 1 };
cleanupHandler = async (_method, body) => {
  assert.equal(body.document_owner, racing.owner);
  if (body.document_owner !== lease.owner) throw new Error('document owner conflict');
  if (body.revision !== lease.revision) throw new Error('stale document revision');
  retired.add(lease.owner); lease = { owner: null, revision: null }; return { closed: true };
};
await racing.close(cx); assert.ok(retired.has(racing.owner));
assert.deepEqual(calls.slice(-2).map(call => call.body.revision), [2, 1]);
const acceptLateSync = owner => { if (retired.has(owner)) throw new Error('document owner session is closed'); lease = { owner, revision: 2 }; };
assert.throws(() => acceptLateSync(racing.owner), /session is closed/);
assert.equal(lease.owner, null, 'same-owner tombstone prevents a late revision from recreating the lease');
const other = new sessionAPI.LspSession(); other.init(cx, {}); other.attempted = { ...doc, revision: 3 };
cleanupHandler = async () => { throw new Error('document owner conflict'); };
const conflictCalls = calls.length; await assert.rejects(other.close(cx), /owner conflict/);
assert.equal(calls.length, conflictCalls + 1, 'owner conflicts never trigger fallback or steal another lease');
cleanupHandler = async () => { throw Object.assign(new Error('document owner conflict'), { code: 'owner_conflict' }); };
const supersededCalls = calls.length;
await other.close(cx);
assert.equal(other.closed, true, 'a confirmed foreign owner completes cleanup of a lease this session no longer owns');
assert.equal(calls.length, supersededCalls + 1, 'superseded cleanup never closes or retries the foreign owner');
cleanupHandler = null;

// Cleanup also bypasses a discovery promise owned by an already cancelled task.
let stateReads = 0, resumeDiscovery, maySend = true;
const freshURLs = [];
const fresh = await load('backend.js', {
  herdr: { home: () => '/home', appHome: () => '/app', readTextFile: async () => ++stateReads === 1 ? new Promise(resolve => { resumeDiscovery = resolve; }) : JSON.stringify(service), exec: async () => { throw new Error('must not launch'); }, hc: async () => { throw new Error('must not launch'); } },
  os: { platform: () => 'darwin', arch: () => 'arm64' },
}, { fetch: async (url, options) => { freshURLs.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, result: url.endsWith('/health') ? service : url.endsWith('/db_sources') ? { sources: [{ id: 'newly-saved-fourth' }] } : { closed: true, revision: JSON.parse(options.body).revision } }) }; } });
const abandonedDiscovery = fresh.backend('document_sync', {}, cx, { shouldSend: () => maySend }); await Promise.resolve();
maySend = false;
const direct = await fresh.backendCleanup('document_close', { path: doc.path, document_owner: 'owned', revision: 4 }, cx);
assert.equal(direct.closed, true); assert.equal(direct.revision, 4); assert.equal(stateReads, 2);
const independentSourceList = await fresh.backend('db_sources', { database: {} }, cx);
assert.equal(independentSourceList.sources[0].id, 'newly-saved-fourth', 'normal refresh does not wait for a prior cancelled discovery');
assert.equal(stateReads, 3);
resumeDiscovery(JSON.stringify(service)); await assert.rejects(abandonedDiscovery, /종료/);
assert.ok(!freshURLs.some(url => url.endsWith('/document_sync')), 'a delayed discovery cannot dispatch a retired session write after close');
const closesBeforeReplacement = freshURLs.filter(url => url.endsWith('/document_close')).length;
const retiredEngine = await fresh.backendCleanup('document_close', { path: doc.path, document_owner: 'old-engine-owner', revision: 0 }, cx, { engine: { pid: service.pid - 1, version: service.version } });
assert.equal(retiredEngine.engine_changed, true);
assert.equal(freshURLs.filter(url => url.endsWith('/document_close')).length, closesBeforeReplacement, 'an old engine lease is never closed against the replacement engine');
// Pending keeps provisional arrays, while independent current responses replace
// only their own field. A slow diagnostic provider must not hold back tokens.
const visual = new sessionAPI.LspSession(); visual.init(cx, {});
visual.sync(doc, cx); timers.at(-1).fn(cx); await drain();
const priorDiagnostics = visual.state.diagnostics, priorTokens = visual.state.tokens;
delayed = { method: 'diagnostics', revision: 1 };
visual.sync({ ...doc, revision: 1, text: 'edited' }, cx);
assert.equal(visual.state.diagnostics, priorDiagnostics); assert.equal(visual.state.tokens, priorTokens);
assert.equal(visual.state.diagnosticsRevision, 0); assert.equal(visual.state.tokensRevision, 0); assert.equal(visual.state.confidence, 'pending');
timers.at(-1).fn(cx);
for (let i = 0; i < 12; i++) await Promise.resolve();
assert.equal(visual.state.tokensRevision, 1, 'tokens publish without waiting for diagnostics');
assert.equal(visual.state.diagnosticsRevision, 0); assert.equal(visual.state.diagnostics, priorDiagnostics);
delayed.resolve({ path: doc.path, document_owner: visual.owner, revision: 1, value: { items: [], version_confidence: 'matched' } }); delayed = null;
await drain(); assert.equal(visual.state.diagnosticsRevision, 1); assert.equal(visual.state.diagnostics.length, 0);
confidence = 'pending';
visual.state.diagnostics = [{ message: 'provisional mapped underline' }];
visual.sync({ ...doc, revision: 2, text: 'edited again' }, cx); timers.at(-1).fn(cx); await drain();
assert.equal(visual.state.diagnosticsRevision, 1, 'engine pending empty array is not an authoritative clear');
assert.equal(visual.state.diagnostics[0].message, 'provisional mapped underline');
confidence = 'matched';
const diagnosticPoll = timers.findLast(timer => timer.ms === 500 && !timer.cancelled); diagnosticPoll.fn(cx); await drain();
assert.equal(visual.state.diagnosticsRevision, 2); await visual.close(cx);
const library = new sessionAPI.LspSession(); library.init(cx, { owner: nativeOwner });
const libraryCalls = calls.length;
library.sync({ ...doc, path: '/cache/sources/library.java', library: true }, cx); timers.at(-1).fn(cx); await drain();
assert.equal(library.state.status, 'ready'); assert.equal(library.state.symbols[0].name, 'LibraryType');
assert.equal(library.state.diagnosticsSupported, false, 'unsupported external diagnostics are not reported as no errors');
await library.request('hover', cx); assert.equal(library.state.hover.markdown, 'original URI type info');
await library.request('definition', cx, { navigate: false }); assert.equal(library.state.locations[0].external, true);
assert.equal(await library.editorRequest('formatting', cx), null);
await library.retry(cx); assert.ok(calls.slice(libraryCalls).some(call => call.method === 'symbols' && call.body.retry === true), 'explicit library retry reaches original server restart boundary');
await library.close(cx);
assert.ok(calls.slice(libraryCalls).every(call => !call.method.startsWith('document_') && call.body.document_owner === undefined), 'readonly library analysis never creates, touches, closes or mutates a buffer lease');
console.log("ADE backend/LSP checks passed: authenticated identity, no mutation replay, shared singleton startup/occupied-port refusal, ordered buffered revisions, stale replies, UTF16 navigation, lease release");

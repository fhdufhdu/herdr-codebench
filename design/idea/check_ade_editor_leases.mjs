import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const a = { id: "a", root: "/a" }, b = { id: "b", root: "/b" }, path = "/shared/source.ts";
let openTabs = [path];
let current = a, leaseOwner = null, sequence = 0;
const shared = new Map(), sessions = [], events = [], tasks = [];
const element = () => new Proxy({}, { get: (_target, key) => key === "then" ? undefined : () => element() });
const key = (project, file) => JSON.stringify([project.id, project.root, project.machine ?? null, file]);
const projectKey = project => project?.id ?? "none";
class Session {
  init(_cx, callbacks) { this.owner = `owner-${++sequence}`; this.callbacks = callbacks; sessions.push(this); }
  setActive() {}
  sync(snapshot) { assert.ok(!leaseOwner || leaseOwner === this.owner, 'another lease must close before a new owner syncs'); leaseOwner = this.owner; this.snapshot = snapshot; events.push(`sync:${this.owner}`); }
  async close() { await this.closeGate; if (this.closeFailure) throw this.closeFailure; if (leaseOwner === this.owner) leaseOwner = null; this.closed = true; events.push(`close:${this.owner}`); }
}
const bindings = {
  "gpui-kit": { View: class {}, div: element }, "gpui-base": { h_flex: element, v_flex: element, TextView: { markdown: element, html: element } },
  herdr: { readTextFile: async () => null, writeTextFile: async () => {}, window: () => ({ platform: 'macos' }), shared: name => shared.get(name), setShared: (name, value) => shared.set(name, value) },
  "./idea-design.js": { ADE: { rowHeight: 30, radius: 6 }, adeUI: value => value, adeColors: () => ({}), adeSize: value => value, adeButton: element, adeTab: element, adeNote: element, adeManagedList: element, adeCompletionPopup: element, MenuController: class {} },
  "./ui-icons.js": { uiIcon: element }, "./workspace.js": { currentProject: () => current, projectKey, documentState: () => ({ tabs: openTabs, active: path }), selectDocument() {}, closeDocument() {}, openDocument() {} },
  "./editor-document.js": { externalSource: () => false, documentKey: key, isDirty: doc => doc.state.value() !== doc.saved, markdownFile: () => false, sourceHTML: value => value },
  "./code-input.js": { CodeInput: class {} }, "./lsp-session.js": { LspSession: Session },
  "./idea-tokens.js": { IDEA_TOKENS: { 'herdr.ux': { syntax: {} } } }, "./editor-menu.js": { openEditorMenu() {} },
  "./editor-completion.js": { completionEdits() {}, textEdits() {}, lineCommentPrefix() {}, completionBounds() {}, completionCandidates() {} },
};
bindings["./http-client.js"] = { isHttp: path => /\.(http|rest)$/i.test(path), httpEnvs: async () => ({ names: [] }), runHttp() {} };
bindings["./execution.js"] = { runConfiguration() {} };
Object.assign(bindings.herdr, { openOverlay() {}, run() {}, notify() {} });
bindings['./sql-assist.js'] = { SQLAssist: class { release() {} } };
bindings['./gutter-navigation.js'] = { GutterNavigation: class { sync() {} release() {} } };
const context = vm.createContext({ console }), module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/text-editor.js", import.meta.url), 'utf8'), { context });
await module.link(async name => { const values = bindings[name]; return new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context }); });
await module.evaluate();
let loop; const queueTimers = [];
const cx = { sleep: async () => {}, focus_handle: () => ({ focus() {}, release() {} }), notify() {}, timer: { every(_ms, fn) { const timer = { cancelled: false, cancel() { this.cancelled = true; }, fire() { if (!this.cancelled) fn(cx); } }; queueTimers.push(timer); return timer; } }, spawn(fn) { const task = Promise.resolve().then(() => fn(cx)); if (!loop) loop = task; else tasks.push(task); } };
const settle = async () => { for (let i = 0; i < 30; i++) { for (const timer of queueTimers) timer.fire(); await Promise.resolve(); } };
const editor = new module.namespace.default(); editor.init({ embedded: true }, cx);
const doc = (project, text) => ({ key: key(project, path), project, path, saved: 'saved', state: { revision: 4, value: () => text, selection: () => ({ head: 0 }), release() {} } });
const first = doc(a, 'unsaved A'), second = doc(b, 'unsaved B'); editor.documents.set(first.key, first); editor.documents.set(second.key, second);
editor.syncLsp(first, cx); await settle(); assert.equal(sessions.length, 1); const original = first.lsp;
assert.equal(second.lsp, undefined, 'inactive restored buffers never acquire a lease');
const cached = [];
for (let index = 0; index < 9; index++) {
 const file = `/a/cached-${index}.ts`; openTabs.push(file);
 const item = { ...doc(a, 'cached'), key: key(a, file), path: file, lsp: { setActive() {}, async close() { this.closed = true; } } };
 cached.push(item); editor.documents.set(item.key, item);
}
editor.retireInactive(cx); await settle();
assert.equal(cached.filter(item => item.lsp).length, 0, 'only the selected file retains an analysis lease');
assert.equal(cached[0].lsp, null, 'least recently used analysis is evicted');
assert.ok(cached.every(item => item.state.value() === 'cached'), 'inactive source buffers remain cached after analysis retires');
let allowClose; original.closeGate = new Promise(resolve => { allowClose = resolve; });
current = b; editor.refresh(cx, b); await settle();
assert.equal(first.lsp, null); assert.equal(second.lsp, undefined); assert.equal(sessions.length, 1, 'same-path activation waits for the exact previous owner close');
assert.equal(first.state.value(), 'unsaved A'); allowClose(); await settle();
assert.equal(sessions.length, 2); assert.ok(original.closed); assert.equal(second.state.value(), 'unsaved B');
assert.ok(events.indexOf(`close:${original.owner}`) < events.indexOf(`sync:${second.lsp.owner}`));
const oldCallback = original.callbacks; oldCallback.onUpdate({ revision: 4, symbolsStatus: 'ready', symbols: [{ name: 'stale owner' }] }, cx);
assert.ok(!first.lspState?.symbols?.some(item => item.name === 'stale owner'), 'retired callbacks cannot update a reactivated owner');
shared.set('ade.editor-mode', { b: 'review' }); editor.refresh(cx, b); await settle(); assert.equal(leaseOwner, null, 'review mode releases hidden file analysis');
shared.set('ade.editor-mode', { b: 'file' }); editor.refresh(cx, b); await settle(); assert.equal(sessions.length, 3); assert.equal(second.state.value(), 'unsaved B');
const failedOwner = second.lsp;
failedOwner.closeFailure = Object.assign(new Error('document owner conflict'), { code: 'owner_conflict' });
current = a; editor.refresh(cx, a); await settle();
assert.equal(sessions.length, 3, 'failed exact-owner cleanup blocks a new same-file owner');
assert.equal(first.lsp, null); assert.equal(first.lspState.status, 'error');
assert.match(first.lspState.error, /이전 분석 세션/);
assert.equal(editor.leaseClosings.get(path).session, failedOwner, 'failed cleanup retains the exact session for retry');
assert.equal(await editor.awaitClosing(path, cx), false, 'handoff never bypasses an unresolved foreign-owner conflict');
failedOwner.closeFailure = null;
assert.equal(await editor.awaitClosing(path, cx), true, 'the same known session can complete cleanup on a later attempt');
assert.equal(editor.leaseClosings.has(path), false); assert.equal(second.retiringLsp, null);
editor.syncLsp(first, cx); await settle();
assert.equal(sessions.length, 4); assert.equal(first.state.value(), 'unsaved A');
await editor.release(cx); await loop; await Promise.all(tasks); assert.equal(leaseOwner, null); assert.ok(sessions.every(session => session.closed));
console.log('ADE active analysis leases: inactive acquisition blocked, same-path close gate, unsaved buffer retention, retired callbacks, review release and final cleanup passed');

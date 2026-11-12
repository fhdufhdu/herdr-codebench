import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { CodeDocument } from '../../mods/ade/code-document.js';
const context = vm.createContext({});
const element = () => ({});
const timers = [], tasks = [], owners = [];
class MenuController {
  constructor() { this.at = 0; this.focus = { release() {} }; }
  ensureVisible() {} release() { this.released = true; }
  key(event) { this.at += event.keystroke === 'down' ? 1 : -1; }
}
const modules = new Map();
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = name === 'gpui-kit' ? { div: element } : name === './idea-design.js' ? {
    ADE: { rowHeight: 28 }, adeSize: n => n || 13, MenuController, adeCompletionPopup: element,
  } : null;
  const module = exports ? new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context })
    : new vm.SourceTextModule(await fs.readFile(new URL(`../../mods/ade/${name.replace('./', '')}`, import.meta.url), 'utf8'), { context });
  modules.set(name, module); await module.link(load); return module;
}
const assistModule = await load('./sql-assist.js'); await assistModule.evaluate();
const catalogModule = await load('./sql-catalog.js'); await catalogModule.evaluate();
const { SQLAssist } = assistModule.namespace, { SQLCatalog } = catalogModule.namespace;
const cx = { notify() {}, spawn(fn, options) { owners.push(options.owner); tasks.push(Promise.resolve().then(() => fn(cx))); }, timer: { after(_ms, fn, options) {
  owners.push(options.owner); const timer = { cancel() { this.cancelled = true; }, fire() { if (!this.cancelled) fn(cx); } }; timers.push(timer); return timer;
} } };
const drain = async () => { while (tasks.length) await tasks.shift(); };
const calls = [], service = { async catalog(sourceId, node) {
  calls.push([sourceId, node]);
  return { nodes: node.kind === 'schema' ? [{ kind: 'table', name: 'customers' }, { kind: 'table', name: 'orders' }] :
    (node.name === 'customers' ? ['id', 'email', 'name'] : ['id', 'customer_id', 'total']).map(name => ({ kind: 'column', name, data_type: name === 'email' ? 'TEXT' : 'INTEGER' })) };
} };
const catalog = new SQLCatalog(service, { id: 'owned', driver: 'sqlite', password: 'must-not-propagate' }, {});
const tables = await catalog.resolve([{ name: 'customers' }, { name: 'customers' }, { name: 'orders' }], cx);
assert.equal(calls.length, 3, 'one schema + one call per referenced base table');
await catalog.resolve([{ name: 'customers' }], cx); assert.equal(calls.length, 3, 'catalog cache survives keystrokes');
await catalog.resolve([{ name: 'cu' }], cx);
assert.equal(calls.length, 3, 'incomplete FROM prefix never requests columns for a nonexistent table');
assert.equal(catalog.error, '', 'partial typing does not create a catalog warning');
assert.equal(tables.find(t => t.name === 'customers').columns[1].name, 'email');
assert.equal(JSON.stringify(calls).includes('must-not-propagate'), false);
const noDB = new SQLCatalog(service, { id: 'other', driver: 'postgres' }, {});
assert.equal((await noDB.load(cx)).length, 0); assert.match(noDB.error, /데이터베이스/); assert.equal(calls.length, 3);

let active = true, focused = 0, assist;
const input = {
  model: new CodeDocument('SELECT c.em FROM customers c'), hasPendingText: false, viewport: { width: 800, height: 400 },
  value() { return this.model.value(); }, get revision() { return this.model.revision; }, selection() { return this.model.selection(); }, focus() { focused++; },
  applyEdits(edits, eventCx, options) { const changed = this.model.applyEdits(edits, options); if (changed) { assist.trigger(eventCx); assist.selection(this.selection(), eventCx); } return changed; },
};
input.model.setSelection({anchor:11,head:11});
const owner = {}, make = extra => new SQLAssist(cx, { input, owner, current: () => active, driver: 'sqlite', catalog, ...extra });
assist = make(); assist.trigger(cx); timers.at(-1).fire(); await drain();
assert.deepEqual(Array.from(assist.popup.items, item => item.label), ['email']); assert.equal(focused, 0);
assert.equal(assist.command('tab', cx), true); assert.equal(input.value(), 'SELECT c.email FROM customers c'); assert.equal(input.selection().head, 14);
assert.equal(assist.popup, null, 'acceptance does not reopen completion');
assert.equal(input.model.undo(), true); assert.equal(input.value(), 'SELECT c.em FROM customers c', 'one completion is one undo step');
input.model.setSelection({anchor:11,head:11}); assist.request({ revision: input.revision, offset: 11 }, cx); await drain();
assert.ok(assist.popup); assist.command('escape', cx); assert.equal(assist.popup, null);
assert.equal(assist.command('newline', cx), false, 'ordinary newline works when list is closed');
input.hasPendingText = true; assist.trigger(cx); assert.equal(assist.pending, null, 'IME composition is never queried'); input.hasPendingText = false;

let finish;
assist.release(); assist = make({ catalog: { resolve: () => new Promise(resolve => { finish = resolve; }) } });
assist.request({ revision: input.revision, offset: 11 }, cx); await Promise.resolve();
input.model.replace('changed'); finish(tables); await drain(); assert.equal(assist.popup, null, 'stale revision never shows old metadata');
input.model = new CodeDocument('SELECT c.em FROM customers c'); input.model.setSelection({anchor:11,head:11});
assist.request({ revision: input.revision, offset: 11 }, cx); await Promise.resolve(); active = false; finish(tables); await drain();
assert.equal(assist.popup, null, 'project/document switch rejects late response');
active = true; assist.request({ revision: input.revision, offset: 11 }, cx); await Promise.resolve(); assist.release(); finish(tables); await drain();
assert.equal(assist.popup, null); assert.equal(owners.every(value => value === owner), true, 'all async UI work has native owner');
console.log('PASS SQL assist: lazy/cached metadata, credential isolation, native owner, automatic trigger, Tab/undo/Esc, IME, stale edits/project/close');

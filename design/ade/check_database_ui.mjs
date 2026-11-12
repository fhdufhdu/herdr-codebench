import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const store = new Map(), tasks = [], sourceRequests = [], catalogs = [], mutations = [], buttons = new Map(), opened = [];
const managedLists = new Map();
const profile = { id: 'p1', name: 'Profile', driver: 'postgres', host: 'localhost', port: 5432, user: 'tester', database: 'app', tls: 'disable', has_password: true, password_storage: 'keychain' };
const service = {
  sources: () => new Promise(resolve => sourceRequests.push(resolve)),
  catalog: (id, node) => new Promise((resolve, reject) => catalogs.push({ id, node, resolve, reject })),
  save: async source => { mutations.push(['save', source]); return { ...source, id: source.id ?? 'new-profile', has_password: Boolean(source.password), password_storage: source.password ? 'keychain' : 'none' }; },
  remove: async id => { mutations.push(['remove', id]); }, test: async source => { mutations.push(['test', source]); return {}; },
};
const element = () => { let proxy; proxy = new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : key === 'when' ? (condition, fn) => condition ? fn(proxy) : proxy : () => proxy }); return proxy; };
class MenuController { constructor() { this.at = 0; this.focus = { focus() {}, release() {} }; this.scroll = {}; } release() {} ensureVisible() {} normalize() {} select(at) { this.at = at; } key(event) { this.lastChord = event.keystroke; if (this.nextAt !== undefined) { this.at = this.nextAt; delete this.nextAt; } } }
class InputState { static new() { return new InputState(); } constructor() { this.text = ''; this.handlers = {}; } on(name, fn) { this.handlers[name] = fn; } set_value(value) { this.text = value; } value() { return this.text; } set_masked(value) { this.masked = value; } release() {} }
const context = vm.createContext({ console });
const bindings = {
  'gpui-kit': { div: element }, 'gpui-base': { h_flex: element, v_flex: element, v_virtual_list: element, Scrollbar: { vertical: element }, InputState, Input: { new: element } },
  herdr: { shared: key => store.get(key), setShared: (key, value) => store.set(key, value), closeOverlay: value => opened.push(['closed', value]) },
  './idea-design.js': { ADE: { rowHeight: 28 }, adeUI: value => value, adeSize: value => value ?? 13, adeColors: () => ({}), adeRow: element,
    adeButton: (id, _label, action) => { buttons.set(id, action); return element(); }, adeInputBox: value => value, adeManagedList: (id, rows, _controller, _cx, options) => { managedLists.set(id, { rows, options }); return element(); }, adePanel: element, adeNote: element, MenuController },
  './ui-icons.js': { uiIcon: element }, './workspace.js': { currentProject: () => ({ id: 'space', root: '/repo', machine: null }), projectKey: value => JSON.stringify([value.machine, value.root, value.id]) },
  './backend.js': { backend: () => { throw new Error('test must never reach live backend'); } },
};
const modules = new Map();
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  if (name === './database-model.js') { const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/database-model.js', import.meta.url), 'utf8'), { context }); modules.set(name, module); await module.link(load); return module; }
  const values = bindings[name], module = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); modules.set(name, module); return module;
}
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/database.js', import.meta.url), 'utf8'), { context });
await module.link(load); await module.evaluate(); const api = module.namespace;
const cx = { notify() {}, stop_propagation() {}, spawn(fn) { tasks.push(fn(cx)); } }, plain = value => JSON.parse(JSON.stringify(value));
const tree = new api.DatabaseTree(); tree.init({ service, onOpen: spec => opened.push(spec) }, cx);
sourceRequests.shift()({ sources: [{ ...profile, password: 'must-not-retain' }] }); await tasks.at(-1);
assert.equal(tree.sources[0].password, undefined); assert.equal(catalogs.length, 0, 'catalog does not connect until expansion');
tree.activate(tree.rows()[0], cx); catalogs.shift().reject(new Error('catalog offline')); await tasks.at(-1);
assert.equal(tree.rows()[1].retry, true); tree.activate(tree.rows()[1], cx);
catalogs.shift().resolve({ nodes: [{ kind: 'schema', name: 'public', database: 'app' }] }); await tasks.at(-1);
const schema = tree.rows()[1]; tree.activate(schema, cx);
catalogs.shift().resolve({ nodes: [{ kind: 'table', name: 'users' }, { kind: 'view', name: 'active_users' }] }); await tasks.at(-1);
let rows = tree.rows(); assert.deepEqual(plain(rows.filter(row => row.group).map(row => [row.label, row.detail])), [['테이블', '1'], ['뷰', '1']]);
tree.activate(rows.find(row => row.label === '뷰'), cx); tree.activate(tree.rows().find(row => row.label === 'active_users'), cx);
assert.equal(opened.at(-1).table_type, 'view'); assert.equal(opened.at(-1).schema, 'public'); assert.equal(opened.at(-1).database, 'app');
tree.activate(tree.rows().find(row => row.label === '테이블'), cx);
const userRow = tree.rows().find(row => row.label === 'users'), viewRow = tree.rows().find(row => row.label === 'active_users'), schemaRow = tree.rows().find(row => row.label === 'public');
tree.click(userRow.id, {}, cx); const openedBeforeModifiers = opened.length;
tree.click(viewRow.id, { platform: true }, cx); assert.equal(tree.objectSelection.size, 2); assert.equal(opened.length, openedBeforeModifiers, 'Cmd-click selects without opening a document');
tree.click(userRow.id, { control: true }, cx); assert.equal(tree.objectSelection.size, 1, 'Ctrl-click toggles selection');
tree.click(schemaRow.id, { platform: true }, cx); tree.openDDL(cx);
assert.equal(opened.at(-1).kind, 'ddl'); assert.equal(opened.at(-1).selection.length, 1); assert.equal(opened.at(-1).selection[0].kind, 'schema', 'schema DDL covers selected nested views');
const model = modules.get('./database-model.js').namespace;
const dbA = { kind: 'database', name: 'app', database: 'app' }, dbB = { kind: 'database', name: 'audit', database: 'audit' };
const schemaA = { kind: 'schema', name: 'public', database: 'app', schema: 'public' }, schemaB = { kind: 'schema', name: 'audit', database: 'audit', schema: 'audit' };
const tableA = { kind: 'table', name: 'users', database: 'app', schema: 'public' }, tableB = { kind: 'view', name: 'events', database: 'audit', schema: 'audit' };
const key = node => model.catalogKey('p1', node);
tree.nodes.set('source:p1', { children: [dbA, dbB] }); tree.nodes.set(key(dbA), { children: [schemaA] }); tree.nodes.set(key(dbB), { children: [schemaB] }); tree.nodes.set(key(schemaA), { children: [tableA] }); tree.nodes.set(key(schemaB), { children: [tableB] });
tree.expanded = new Set(['source:p1', key(dbA), key(dbB), key(schemaA), key(schemaB), key(schemaA) + ':tables', key(schemaB) + ':views']);
tree.click(key(tableA), {}, cx); tree.click(key(tableB), { platform: true }, cx); tree.openDDL(cx);
assert.deepEqual(plain(opened.at(-1).selection).map(node => [node.kind, node.database, node.schema]), [['table', 'app', 'public'], ['view', 'audit', 'audit']], 'mixed database/schema objects retain their own scope');
tree.click(key(dbA), { control: true }, cx); tree.openDDL(cx);
assert.equal(opened.at(-1).selection.some(node => node.kind === 'database' && node.name === 'app'), true, 'whole-database selection reaches DDL provider');
assert.equal(opened.at(-1).selection.some(node => node.kind === 'table' && node.database === 'app'), false, 'whole database covers nested objects');
tree.click(key(dbA), {}, cx); tree.expanded.add(key(dbA));
tree.click(key(schemaB), { shift: true }, cx);
assert.equal(tree.objectSelection.has(key(dbA)), true); assert.equal(tree.objectSelection.has(key(dbB)), true); assert.equal(tree.objectSelection.has(key(schemaB)), true, 'Shift range spans qualified visible objects');
const rangeCount = tree.objectSelection.size;
tree.menu.nextAt = tree.rows().findIndex(row => row.id === key(tableB)); tree.key({ key: 'down', keystroke: 'shift-down', modifiers: { shift: true } }, cx);
assert.equal(tree.menu.lastChord, 'down'); assert.equal(tree.objectSelection.has(key(tableB)), true); assert.equal(tree.objectSelection.size >= rangeCount, true);
tree.key({ key: 'a', keystroke: 'ctrl-a', modifiers: { control: true } }, cx); assert.equal(tree.objectSelection.size, tree.rows().filter(row => tree.objectRow(row)).length);
const otherSource = { ...profile, id: 'p2', name: 'Other profile', driver: 'mysql' }, otherDB = { kind: 'database', name: 'other_db', database: 'other_db' };
tree.sources.push(otherSource); tree.nodes.set('source:p2', { children: [otherDB] }); tree.expanded.add('source:p2');
tree.click(key(dbA), {}, cx); tree.click(model.catalogKey('p2', otherDB), { control: true }, cx);
const beforeCrossSource = opened.length; tree.openDDL(cx);
assert.deepEqual(opened.slice(beforeCrossSource).map(spec => spec.source_id), ['p1', 'p2'], 'DDL keeps different connections in separate review documents');
assert.equal(opened.at(-1).selection[0].database, 'other_db');
assert.equal(mutations.length, 0, 'DDL selection/opening never executes a query or profile mutation');
tree.refresh(cx); sourceRequests.shift()({ sources: [profile] }); await tasks.at(-1);
tree.activate(tree.rows()[0], cx); const stale = catalogs.shift(); tree.refresh(cx);
sourceRequests.shift()({ sources: [] }); await tasks.at(-1); stale.resolve({ nodes: [{ kind: 'schema', name: 'stale' }] }); await tasks.at(-2);
assert.equal(tree.rows().length, 0, 'late catalog cannot restore refreshed data'); assert.equal(tree.objectSelection.size, 0); tree.release();
const manager = new api.DatabaseManager(); manager.init({ overlay: 'manager', service }, cx);
sourceRequests.shift()({ sources: [profile] }); await tasks.at(-1);
assert.equal(mutations.length, 0, 'opening manager never writes/tests'); assert.equal(manager.inputs.password.masked, true);
manager.inputs.password.set_value('new-secret'); manager.inputs.password.handlers.change({}, cx);
assert.equal(manager.payload(manager.sources[0]).password, 'new-secret');
manager.inputs.password.set_value(''); manager.inputs.password.handlers.change({}, cx);
assert.equal('password' in manager.payload(manager.sources[0]), false, 'empty password input preserves existing credential');
manager.render(cx); buttons.get('clear-database-password')(undefined, cx);
assert.equal(manager.payload(manager.sources[0]).password, '', 'explicit clear queues engine credential removal');
manager.passwords.clear(); manager.inputs.name.set_value('Renamed'); manager.inputs.name.handlers.change({}, cx);
manager.add(cx, manager.sources[0]); assert.equal(manager.sources.length, 2); assert.equal(manager.sources[1].has_password, false, 'copy never implies copying credentials');
manager.move(-1, cx); assert.equal(manager.sources[0].name, 'Renamed 복사');
assert.equal(mutations.length, 0, 'copy/reorder/name remain draft');
manager.select('p1', cx); manager.test(cx); await tasks.at(-1);
assert.equal(mutations[0][0], 'test'); assert.equal(mutations.some(([kind]) => kind === 'save'), false, 'test does not save');
service.test = async () => { throw new Error('authentication failed'); }; manager.test(cx); await tasks.at(-1); assert.match(manager.error, /authentication failed/);
manager.apply(cx); await tasks.at(-1);
assert.equal(mutations.filter(([kind]) => kind === 'save').length, 2);
assert.deepEqual(plain(store.get('ade.database.order')), ['new-profile', 'p1']);
manager.select('p1', cx); manager.remove(cx); assert.equal(mutations.some(([kind]) => kind === 'remove'), false);
manager.apply(cx); await tasks.at(-1); assert.equal(mutations.filter(([kind]) => kind === 'remove').length, 1);
assert.equal(JSON.stringify([...store]).includes('new-secret'), false); assert.equal(JSON.stringify([...store]).includes('must-not-retain'), false, 'no credentials enter shared state');
manager.release(); assert.equal(manager.passwords.size, 0);
const addManager = new api.DatabaseManager(); addManager.init({ overlay: 'add', service, add: true }, cx);
sourceRequests.shift()({ sources: [] }); await tasks.at(-1); assert.equal(addManager.sources.length, 1, 'header plus creates a draft after async loading'); addManager.release();
const hoverManager = new api.DatabaseManager(); hoverManager.init({ service }, cx);
sourceRequests.shift()({ sources: [profile, { ...profile, id: 'hover-target', name: 'Hovered Profile' }] }); await tasks.at(-1); hoverManager.render(cx);
const managerList = managedLists.get('database-profiles'), hoverRow = managerList.rows.find(row => row.id === 'hover-target'), hoverActions = managerList.options.rowActions(hoverRow), beforeHoverWrites = mutations.length;
hoverActions.find(action => action.id === 'copy').action('hover-target', undefined, cx);
assert.equal(hoverManager.sources.at(-1).name, 'Hovered Profile 복사', 'hover copy belongs to exact row rather than current selection');
hoverActions.find(action => action.id === 'remove').action('hover-target', undefined, cx);
assert.equal(hoverManager.sources.some(source => source.id === 'hover-target'), false); assert.equal(hoverManager.sources.some(source => source.id === profile.id), true); assert.equal(mutations.length, beforeHoverWrites, 'hover profile edits remain draft'); hoverManager.release();
// Render only queues revision descriptors. All source work uses the worker's
// init-owned AsyncContext, even when another view's save woke this tree.
const refreshTasks = [], refreshRequests = [], spawnParents = []; let ownerId = 0, cancelled = 0;
function spawnOwned(fn) {
  spawnParents.push(this.owner);
  const taskCx = { owner: ++ownerId, notify() {}, spawn: spawnOwned };
  refreshTasks.push(fn(taskCx)); return { cancel() { cancelled++; } };
}
const initCx = { owner: 'init', notify() {}, spawn: spawnOwned };
const renderCx = { spawn() { throw new Error('render must not spawn'); }, notify() { throw new Error('render must not notify'); } };
const refreshService = { sources: owner => new Promise((resolve, reject) => refreshRequests.push({ owner, resolve, reject })) };
const autoTree = new api.DatabaseTree(); autoTree.init({ service: refreshService }, initCx);
refreshRequests.shift().resolve({ sources: [profile] }); await refreshTasks.at(-1);
const revision = Number(store.get('ade.database.changed') || 0);
store.set('ade.database.changed', revision + 1); autoTree.render(renderCx); autoTree.render(renderCx);
store.set('ade.database.changed', revision + 2); autoTree.render(renderCx);
assert.equal(autoTree.refreshJobs.length, 1); assert.equal(refreshRequests.length, 0, 'render does not start source work');
await Promise.resolve();
assert.equal(refreshRequests.length, 1, 'repeated/newer queued revisions coalesce'); assert.equal(autoTree.refreshJobs.length, 0);
assert.equal(spawnParents.at(-1), 1, 'automatic fetch is spawned by retained worker context');
refreshRequests.shift().resolve({ sources: Array.from({ length: 4 }, (_value, index) => ({ ...profile, id: `new-${index}` })) }); await refreshTasks.at(-1);
assert.equal(autoTree.sources.length, 4); assert.equal(autoTree.loading, false, 'automatic save revision reaches the updated profile list');
autoTree.render(renderCx); await Promise.resolve(); assert.equal(refreshRequests.length, 0, 'same revision cannot form a render-refresh loop');
store.set('ade.database.changed', revision + 3); autoTree.render(renderCx); await Promise.resolve();
const staleRefresh = refreshRequests.shift(), staleTask = refreshTasks.at(-1);
autoTree.refresh(initCx); refreshRequests.shift().resolve({ sources: [{ ...profile, id: 'manual-latest' }] }); await refreshTasks.at(-1);
staleRefresh.resolve({ sources: [{ ...profile, id: 'old-auto' }] }); await staleTask;
assert.equal(autoTree.sources[0].id, 'manual-latest', 'late automatic response cannot overwrite a newer manual refresh');
store.set('ade.database.changed', revision + 4); autoTree.render(renderCx); autoTree.refresh(initCx); await Promise.resolve();
assert.equal(refreshRequests.length, 1, 'manual refresh cancels redundant queued automatic descriptor');
refreshRequests.shift().resolve({ sources: [profile] }); await refreshTasks.at(-1);
store.set('ade.database.changed', revision + 5); autoTree.render(renderCx); await Promise.resolve();
refreshRequests.shift().reject(new Error('source list offline')); await refreshTasks.at(-1);
assert.equal(autoTree.loading, false); assert.match(autoTree.error, /source list offline/);
store.set('ade.database.changed', revision + 6); autoTree.render(renderCx);
assert.equal(autoTree.refreshJobs.length, 1); autoTree.release(); await refreshTasks[0];
assert.equal(autoTree.refreshJobs.length, 0); assert.equal(refreshRequests.length, 0); assert.equal(cancelled, 1, 'release wakes/cancels its owned worker and drops queued refresh');
console.log('PASS ADE database UI: lazy/retry/stale catalog, Cmd/Ctrl/Shift and scoped DDL, global draft CRUD/credential secrecy, retained-owner automatic revision refresh/coalescing, manual races and queue cleanup');

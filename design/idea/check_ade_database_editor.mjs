import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
const tasks = [], calls = [], files = new Map([['/import.csv', 'id,name\r\n3,third'], ['/existing.csv', 'old']]);
let sharedValues = {}, rejectApply = false, rendering = false;
let rows = [[1, 'first'], [2, null]];
const project = { id: 'fixture', root: '/fixture', machine: null, name: 'Fixture' };
let currentProject = project;
const renderedGridRows = [];
const resizers = [], buttonIds = [];
const element = () => new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : (...args) => {
  if (name === 'id' && /-row-\d+$/.test(String(args[0]))) renderedGridRows.push(args[0]);
  if (name === 'on_resize') resizers.push(args[0]);
  if (name === 'on_mouse_down_out') { assert.equal(args.length, 1); assert.equal(typeof args[0], 'function'); }
  return element();
} });
class State {
  static new(options = {}) { assert.equal(rendering, false, 'native retained state must be made outside render'); return new State(options.value ?? ''); }
  constructor(text) { this.text = text; this.events = {}; }
  value() { return this.text; } set_value(text) { this.text = text; this.events.change?.({}, cx); }
  on(event, fn) { this.events[event] = fn; } release() {} focus() {}
}
class CodeInput {
  init(text, _cx, options = {}) { assert.equal(rendering, false, 'CodeInput state must be made outside render'); this.options = options; this.text = text; this.range = { anchor: 0, head: 0, start: 0, end: 0 }; return this; }
  value() { return this.text; } selection() { return this.range; } focus() {} release() {} render() { return element(); }
}
class MenuController {
  constructor() { assert.equal(rendering, false, 'menu handles must be made outside render'); this.focus = { focus() {}, release() {} }; this.scroll = {}; this.at = 0; }
  release() {} ensureVisible() {} key(event, _cx, rows) {
    if (event.keystroke === 'end') this.at = rows.length - 1;
    else if (event.keystroke === 'home') this.at = 0;
    else return false;
    return true;
  }
}
const cx = { notify() {}, spawn(fn) { tasks.push(Promise.resolve().then(() => fn(cx))); }, sleep: async () => {}, timer: { after: () => ({ cancel() {} }) },
  write_to_clipboard(text) { this.clipboard = text; }, stop_propagation() {}, focus_handle: () => ({ focus() {}, release() {} }) };
const backend = async (method, payload) => {
  calls.push({ method, payload }); const request = payload.database;
  if (method === 'db_sources') return { sources: [{ id: 'source', name: 'Fixture SQLite', driver: 'sqlite' }] };
  if (method === 'db_rows') return { columns: [{ name: 'id', data_type: 'integer' }, { name: 'name', data_type: 'text' }], rows: rows.map(row => [...row]), primary_keys: ['id'], offset: request.offset, limit: request.limit, elapsed_ms: 2 };
  if (method === 'db_ddl') return { sql: 'CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT);', warnings: [] };
  if (method === 'db_query') return { job_id: 'job-1' };
  if (method === 'db_job' || method === 'db_cancel') return { id: 'job-1', state: 'completed', current: 1, total: 1, elapsed_ms: 3, results: [{ columns: [{ name: 'one' }], rows: [[1]], elapsed_ms: 3, statement: 'SELECT 1' }] };
  if (method === 'db_apply') {
    if (rejectApply) throw new Error('stale row');
    for (const change of request.changes) {
      if (change.op === 'update') { const row = rows.find(item => item[0] === change.original.id); if (Object.hasOwn(change.values, 'name')) row[1] = change.values.name; }
      if (change.op === 'insert') rows.push([change.values.id, change.values.name]);
    }
    return { applied: request.changes.length };
  }
  throw new Error(`Unexpected endpoint ${method}`);
};
const stubs = {
  'gpui-kit': { div: element },
  'gpui-base': { h_flex: element, v_flex: element, InputState: State, Input: { new: element }, h_resizable: element, resizable_panel: element },
  'herdr': { shared: name => sharedValues[name], setShared: (name, value) => { sharedValues[name] = value; }, closeOverlay() {}, openOverlay() {}, run() {}, window: () => ({ platform: 'macos' }),
    readTextFile: async path => files.get(path) ?? null,
    writeTextFile: async (path, text, expected) => { assert.equal(files.get(path) ?? null, expected, 'export must use the expected file snapshot'); files.set(path, text); } },
  './idea-design.js': { adeUI: value => value, adeColors: () => ({}), adeSize: value => value, adeButton: id => { buttonIds.push(id); return element(); }, adeTab: element, adeNote: element, adeInputBox: value => value, MenuController, adeManagedList: element },
  './idea-tokens.js': { IDEA_TOKENS: { 'herdr.ux': { syntax: { keyword: 'keyword', string: 'string', comment: 'comment', number: 'number' } } } },
  './ui-icons.js': { uiIcon: element }, './code-input.js': { CodeInput },
  './workspace.js': { currentProject: () => currentProject, projectKey: p => JSON.stringify([p.machine, p.root, p.id]) },
  './backend.js': { backend },
};
stubs['./sql-assist.js'] = { SQLAssist: class { constructor() {} clear() {} release() {} trigger() {} selection() {} render() { return element(); } } };
stubs['./sql-catalog.js'] = { SQLCatalog: class {} };
const modules = new Map();
for (const [name, exports] of Object.entries(stubs)) modules.set(name, new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context }));
for (const name of ['database-model', 'data-extract', 'database-editor']) modules.set(`./${name}.js`, new vm.SourceTextModule(fs.readFileSync(new URL(`../../mods/ade/${name}.js`, import.meta.url), 'utf8'), { context }));
const module = modules.get('./database-editor.js'); await module.link(name => modules.get(name)); await module.evaluate();
const { DatabaseEditor, DatabaseResults, DatabaseTransfer, cellValue } = module.namespace;
const model = modules.get('./database-model.js').namespace;
const flush = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };
const renderView = view => { rendering = true; try { view.render(cx); } finally { rendering = false; } };
assert.equal(cellValue('5', 1), 5); assert.throws(() => cellValue('9007199254740993', 1)); assert.equal(cellValue('false', true), false);
model.openDatabaseDocument({ kind: 'table', source_id: 'source', table: 'items' }, project);
const editor = new DatabaseEditor(); editor.init({ context: project }, cx); await flush();
let doc = editor.active(); const tableDoc = doc; assert.equal(doc.page.rows.length, 2);
editor.edit(doc, 0, 1, cx); doc.cell.set_value('changed'); editor.stage(doc, cx);
assert.equal(doc.grid.dataset.rows[0][1], 'changed'); assert.equal(calls.filter(call => call.method === 'db_apply').length, 0, 'staging must never write');
rejectApply = true; editor.apply(doc, cx); await flush(); assert.match(doc.error, /stale row/); assert.equal(doc.changes.dirty, true);
rejectApply = false; editor.apply(doc, cx); await flush(); assert.equal(rows[0][1], 'changed'); assert.equal(doc.changes.dirty, false);
const update = calls.find(call => call.method === 'db_apply').payload.database.changes[0]; assert.equal(update.original.name, 'first');
model.openDatabaseDocument({ kind: 'console', source_id: 'source' }, project); editor.refresh(cx); await flush(); doc = editor.active();
doc.input.text = 'SELECT 1;\nSELECT 2;'; doc.input.range = { anchor: 2, head: 2, start: 2, end: 2 };
doc.input.options.onExecute(cx); renderView(editor); assert.equal(calls.filter(call => call.method === 'db_query').length, 0, 'opening candidates cannot execute');
const pendingCandidates = editor.candidates, candidate = pendingCandidates.rows.find(item => item.kind === 'statement');
editor.documents.delete(doc.key); editor.execute(doc, candidate, cx); await flush();
assert.equal(calls.filter(call => call.method === 'db_query').length, 0, 'a closed document candidate cannot start SQL');
editor.documents.set(doc.key, doc); editor.candidates = pendingCandidates;
model.selectDatabaseDocument(tableDoc.id, project); editor.execute(doc, candidate, cx); await flush();
assert.equal(calls.filter(call => call.method === 'db_query').length, 0, 'an inactive document candidate cannot start SQL');
model.selectDatabaseDocument(doc.id, project); editor.candidates = pendingCandidates;
currentProject = { ...project, id: 'other', root: '/other' }; editor.execute(doc, candidate, cx); await flush();
assert.equal(calls.filter(call => call.method === 'db_query').length, 0, 'a previous project candidate cannot start SQL');
currentProject = project; editor.candidates = pendingCandidates;
editor.execute(doc, candidate, cx); await flush();
assert.equal(calls.filter(call => call.method === 'db_query').length, 1); assert.deepEqual([...calls.find(call => call.method === 'db_query').payload.database.statements], ['SELECT 1']);
const published = model.databaseExecutionState(project).records[0]; assert.equal(published.resultCount, 1); assert.equal(Object.hasOwn(published, 'results'), false);
const results = new DatabaseResults(); results.init({ context: project }, cx); await flush(); assert.equal(results.cache.size, 1); renderView(results);
assert.equal(results.tooltip('job-1', project), 'SELECT 1');
assert.equal(JSON.stringify(model.databaseExecutionState(project)).includes('SELECT 1'), false, 'full SQL tooltip remains local rather than persisted metadata');
const dataset = { columns: [{ name: 'id', data_type: 'integer' }, { name: 'name', data_type: 'text' }], rows: rows.map(row => [...row]), primary_keys: ['id'] };
const transfer = new DatabaseTransfer(); transfer.init({ context: project, mode: 'export', spec: { source_id: 'source', table: 'items' }, source: { driver: 'sqlite' }, dataset, selection: [0] }, cx);
assert.equal(transfer.text, 'id,name\r\n1,changed'); transfer.path.set_value('/existing.csv'); transfer.save(cx); await flush();
assert.equal(files.get('/existing.csv'), 'old', 'existing file must be reviewed before overwrite'); assert.equal(transfer.confirmPath, '/existing.csv');
transfer.save(cx); await flush(); assert.equal(files.get('/existing.csv'), transfer.text);
const importing = new DatabaseTransfer(); importing.init({ context: project, mode: 'import', spec: { source_id: 'source', table: 'items' }, source: { driver: 'sqlite' }, dataset }, cx);
importing.path.set_value('/import.csv'); const before = calls.filter(call => call.method === 'db_apply').length;
importing.load(cx); await flush(); assert.equal(importing.prepared.count, 1); assert.equal(calls.filter(call => call.method === 'db_apply').length, before, 'preview must never import');
importing.apply(cx); await flush(); assert.equal(calls.filter(call => call.method === 'db_apply').length, before + 1); assert.equal(importing.prepared, null);
model.selectDatabaseDocument(tableDoc.id, project); editor.refresh(cx); await flush(); assert.equal(tableDoc.page.rows.length, 3, 'an imported data-version change reloads a clean active table');
editor.edit(tableDoc, 0, 1, cx); tableDoc.cell.set_value('local staged'); editor.stage(tableDoc, cx);
const dirtyPage = tableDoc.page;
files.set('/another.csv', 'id,name\r\n4,fourth'); importing.path.set_value('/another.csv'); importing.load(cx); await flush(); importing.apply(cx); await flush();
editor.watchUpdates(cx); await flush(); assert.equal(tableDoc.page, dirtyPage); assert.equal(tableDoc.changes.dirty, true); assert.match(tableDoc.notice, /현재 변경/);
tableDoc.changes.revert(); editor.watchUpdates(cx); await flush(); assert.equal(tableDoc.page.rows.length, 4);
assert.ok(Object.values(sharedValues['ade.database-data-changed']).every(value => typeof value === 'number'));
const copying = new DatabaseTransfer(); copying.init({ context: project, intent: 'copy', mode: 'export', spec: { source_id: 'source', table: 'items' }, source: { driver: 'sqlite' }, dataset, selection: [0] }, cx);
copying.chooseFormat('json', cx); copying.copy(cx); assert.equal(JSON.parse(cx.clipboard).length, 1); assert.equal(copying.text, copying.preview.value());
copying.chooseFormat('sql-insert', cx); copying.copy(cx); assert.match(cx.clipboard, /^INSERT INTO "items"/);
const grid = tableDoc.grid;
grid.update(dataset); grid.viewportWidth = 1000; const firstButtons = buttonIds.length; grid.render(cx);
assert.ok(Math.abs(grid.widths.reduce((a, b) => a + b, 44) - 1000) < 0.5, 'automatic columns fill the viewport');
assert.equal(buttonIds.slice(firstButtons).some(id => id === `${grid.id}-previous` || id === `${grid.id}-next`), false, 'small results have no redundant pager');
const resized = [...grid.widths]; resized[1] = 300; resizers.at(-1)(resized, cx); grid.viewportWidth = 1200; grid.render(cx); assert.equal(grid.widths[1], 300, 'manual column width survives viewport resizing');
grid.update({ columns: dataset.columns, rows: Array.from({ length: 500 }, (_value, i) => [i, `row${i}`]) });
grid.select(301, { modifiers: {} }, cx); assert.ok(grid.windowStart <= 301 && grid.windowStart + grid.windowRows > 301);
grid.scrollRows(-10000, cx); assert.equal(grid.windowStart, 0); assert.deepEqual([...grid.selected], [301]);
grid.select(305, { modifiers: { shift: true } }, cx); grid.copy(cx, 'json');
assert.equal(JSON.parse(cx.clipboard).length, 5); assert.equal(JSON.parse(cx.clipboard)[4].id, 305, 'copy preserves absolute selected rows across viewport pages');
grid.key({ keystroke: 'end' }, cx); assert.ok(grid.selected.has(499)); assert.ok(grid.windowStart + grid.windowRows > 499);
const beforeRows = renderedGridRows.length; rendering = true; try { grid.render(cx); } finally { rendering = false; }
assert.ok(renderedGridRows.length - beforeRows <= grid.windowRows, 'large grids render only bounded native viewport rows');
renderView(editor); renderView(transfer); renderView(importing);
editor.release(); results.release(); transfer.release(); importing.release(); copying.release();
console.log('ADE DB UI: explicit staging/apply/CAS failure, SQL candidate-only execution, local job results, unified extraction, export overwrite snapshot and import preview/apply passed');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const context = vm.createContext({}), modules = new Map(), tasks = [], store = new Map();
const project = { id: 'fixture', root: '/fixture' };
let clipboard = '';
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
const input = () => ({ text: '', value() { return this.text; }, set_value(text) { this.text = text; }, on() {}, focus() {}, release() {} });
class MenuController { constructor() { this.focus = { focus() {}, release() {} }; } release() {} }
const mocks = {
  herdr: { shared: key => store.get(key), setShared: (key, value) => store.set(key, value), window: () => ({ platform: 'macos' }), readTextFile() {}, writeTextFile() {}, closeOverlay() {}, openOverlay() {}, run() {} },
  'gpui-kit': { div: element },
  'gpui-base': { h_flex: element, v_flex: element, InputState: { new: input }, Input: { new: element }, h_resizable: element, resizable_panel: element },
  './idea-design.js': { adeUI: element, adeColors: () => ({}), adeSize: value => value ?? 13, adeButton: element, adeTab: element, adeNote: element, adeInputBox: element, MenuController, adeManagedList: element },
  './idea-tokens.js': { IDEA_TOKENS: {} }, './ui-icons.js': { uiIcon: element },
  './workspace.js': { currentProject: () => project, projectKey: item => item.id },
  './backend.js': { backend() { throw new Error('unexpected backend call'); } },
  './code-input.js': { CodeInput: class {} }, './sql-assist.js': { SQLAssist: class {} },
};
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const values = mocks[name];
  const module = values ? new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context })
    : new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/' + name.replace('./', ''), import.meta.url), 'utf8'), { context });
  modules.set(name, module); return module;
}
const module = await load('./database-editor.js'); await module.link(load); await module.evaluate();
const { cycleOrder, tablePage, resultTarget } = modules.get('./database-grid.js').namespace;
const { editableSelect } = modules.get('./sql-completion.js').namespace;
const plain = value => JSON.parse(JSON.stringify(value));
assert.equal(cycleOrder('', 'name', false, 'sqlite'), '"name" ASC');
assert.equal(cycleOrder('"name" ASC', 'name', false, 'sqlite'), '"name" DESC');
assert.equal(cycleOrder('"name" DESC', 'name', false, 'sqlite'), '');
assert.equal(cycleOrder('"name" ASC', 'id', true, 'sqlite'), '"name" ASC, "id" ASC');
assert.equal(cycleOrder('"name" ASC, "id" ASC', 'name', true, 'sqlite'), '"name" DESC, "id" ASC');
assert.equal(cycleOrder('"name" ASC, "id" DESC', 'id', true, 'sqlite'), '"name" ASC');
assert.equal(cycleOrder('', 'a"b', false, 'postgres'), '"a""b" ASC');
assert.throws(() => cycleOrder('lower(name)', 'id', true, 'sqlite'));
assert.deepEqual(plain(editableSelect('SELECT u.id AS row_id, u.name FROM main.users AS u WHERE id > 2 ORDER BY id DESC LIMIT 2', 'sqlite')).projections, ['id', 'name']);
for (const sql of ['SELECT COUNT(*) FROM users', 'SELECT DISTINCT id FROM users', 'SELECT * FROM users u JOIN orders o ON u.id=o.id', 'SELECT * FROM users, orders', 'WITH x AS (SELECT * FROM users) SELECT * FROM x', 'SELECT * FROM users UNION SELECT * FROM users', 'SELECT * FROM (SELECT * FROM users)', 'SELECT id+1 FROM users', 'SELECT * FROM users; SELECT * FROM orders']) assert.equal(editableSelect(sql, 'sqlite'), null, sql);
const source = { id: 's', driver: 'sqlite', database: 'main' }, target = { source_id: 's', database: 'main', schema: 'main', table: 'users' };
const fields = [{ kind: 'column', name: 'id', primary_key: true }, { kind: 'column', name: 'name' }];
const data = { statement: 'SELECT id AS row_id, name FROM users WHERE id=1', columns: [{ name: 'row_id' }, { name: 'name' }], rows: [[1, 'old']] };
let sql, cancelled = false;
const service = {
  sources: async () => ({ sources: [source] }),
  catalog: async (_id, node) => ({ nodes: node.kind === 'schema' ? [{ kind: 'table', name: 'users' }] : fields }),
  rows: async () => ({ baseline: true }),
  query: async (_target, statements) => { sql = statements[0]; return { job_id: 'own-job' }; },
  job: async () => ({ id: 'own-job', state: 'completed', results: [{ ...data, rows: [[1, 'a'], [2, 'b'], [3, 'c']] }] }),
  cancel: async () => { cancelled = true; },
};
const cx = { notify() {}, stop_propagation() {}, write_to_clipboard(text) { clipboard = text; }, sleep: async () => {}, spawn(fn) { tasks.push(fn(cx)); } };
assert.equal((await tablePage(service, target, source, { limit: 2, offset: 0 }, cx, () => true)).baseline, true);
const page = await tablePage(service, target, source, { limit: 2, offset: 4, where: "name <> 'x'", order: '"name" DESC' }, cx, () => true);
assert.match(sql, /WHERE \(name <> 'x'\n\) ORDER BY "name" DESC LIMIT 3 OFFSET 4$/); assert.equal(page.rows.length, 2); assert.deepEqual(plain(page.primary_keys), ['id']);
let checks = 0; await tablePage(service, target, source, { limit: 2, offset: 0, order: 'id' }, cx, () => ++checks < 2); assert.equal(cancelled, true);
const origin = await resultTarget(service, { spec: target }, data, cx);
assert.deepEqual(plain(origin.page.columns), ['id', 'name']);
assert.equal(await resultTarget(service, { spec: target }, { ...data, statement: 'SELECT name FROM users', columns: [{ name: 'name' }] }, cx), null);
const { DataGrid, DatabaseResults } = module.namespace;
const grid = new DataGrid(); grid.init('test', cx); grid.update(data);
grid.select(0, {}, cx); grid.selectedCell = { row: 0, column: 1 }; grid.key({ keystroke: 'cmd-c' }, cx); assert.equal(clipboard, 'old');
grid.select(0, {}, cx); grid.key({ keystroke: 'cmd-c' }, cx); assert.match(clipboard, /row_id,name\r?\n1,old/);
const actual = modules.get('./database-model.js').namespace.databaseService;
Object.assign(actual, service);
let applied;
actual.apply = async (spec, changes) => { applied = { spec, changes }; };
const results = new DatabaseResults(); results.init({ context: project }, cx);
const resultGrid = results.grid('fixture:job:0', data, cx, { spec: target });
results.editResult(resultGrid, { spec: target }, data, 0, 1, cx); await tasks.at(-1);
assert.equal(resultGrid.editDoc.editing.column, 1); resultGrid.editDoc.cell.set_value('new');
results.applyResult(resultGrid, cx); await tasks.at(-1);
assert.equal(applied.changes[0].values.name, 'new'); assert.equal(applied.changes[0].original.id, 1); assert.equal(applied.spec.table, 'users');
assert.equal(resultGrid.dataset.columns[0].name, 'row_id'); assert.equal(resultGrid.dataset.rows[0][1], 'new');
assert.equal(resultGrid.editDoc.changes.dirty, false);
results.editResult(resultGrid, { spec: target }, data, 0, 1, cx); assert.equal(results.closeExecution('job', cx), false);
results.release(); grid.release();
console.log('PASS database grid: cell/row copy, sorting, filtered pagination/cancel, direct SELECT origins/aliases/PK guards and staged result writes');

if (process.argv.includes('--live')) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-grid-owned-'));
  const root = new URL('../../', import.meta.url);
  const binary = fileURLToPath(new URL(`engine/dist/${process.platform}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}/herdr-engine`, root));
  const statePath = path.join(directory, 'runtime.json');
  const child = spawn(binary, ['--port', '0', '--state', statePath, '--config', fileURLToPath(new URL('mods/codenav/bridge/servers.json', root))], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ended = new Promise(resolve => child.once('exit', resolve));
  try {
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); break; } catch {}
      if (child.exitCode !== null) throw new Error(stderr);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(state, 'owned engine starts');
    const live = new (modules.get('./database-model.js').namespace.DatabaseService)();
    live.request = async (method, database) => {
      const response = await fetch(`http://127.0.0.1:${state.port}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Codenav-Token': state.token }, body: JSON.stringify({ database }) });
      const envelope = await response.json();
      if (!envelope.ok) throw new Error(envelope.error);
      return envelope.result;
    };
    const saved = await live.save({ name: 'Owned grid fixture', driver: 'sqlite', path: path.join(directory, 'fixture.sqlite') });
    const liveTarget = { source_id: saved.id, database: 'main', schema: 'main', table: 'users' };
    const liveCx = { sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) };
    async function query(statements) {
      const started = await live.query(liveTarget, statements);
      let job = { id: started.job_id, state: "queued" };
      while (['queued', 'running'].includes(job.state)) { await liveCx.sleep(20); job = await live.job(job.id); }
      assert.equal(job.state, 'completed', job.error);
      return job.results;
    }
    await query(['CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, plan TEXT)', "INSERT INTO users VALUES (1,'Alice','pro'),(2,'Bob','free'),(3,'Chen','pro')"]);
    const filtered = await tablePage(live, liveTarget, saved, { where: "plan = 'pro'", order: '"name" DESC', limit: 1, offset: 1 }, liveCx, () => true);
    assert.equal(filtered.rows[0][1], 'Alice');
    const [selected] = await query(['SELECT id AS row_id, name FROM users WHERE id=2']);
    const editable = await resultTarget(live, { spec: liveTarget }, selected, liveCx);
    assert.ok(editable);
    const changes = new (modules.get('./database-model.js').namespace.TableChanges)(editable.page);
    changes.update(0, 'name', 'Bobby');
    await changes.apply(live, editable.target, liveCx);
    const [verified] = await query(['SELECT name FROM users WHERE id=2']);
    assert.equal(verified.rows[0][0], 'Bobby');
    console.log('PASS owned SQLite engine: WHERE/ORDER BY/pagination and aliased SELECT result update persisted');
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await ended;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

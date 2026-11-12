import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const plain = value => JSON.parse(JSON.stringify(value));
let current = { id: 'a', root: '/a', name: 'Alpha' };
const saved = new Map(), lists = new Map(), calls = [], tasks = [];
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
class MenuController { constructor() { this.focus = { focus() {}, release() {} }; } release() {} }
const input = () => ({ text: '', value() { return this.text; }, on() {}, release() {} });
const key = project => JSON.stringify([project.id, project.root]);
const cx = { notify() {}, timer: { after() {} }, spawn(fn) { tasks.push(Promise.resolve().then(() => fn(cx))); } };
const bindings = {
  'gpui-kit': { div: element },
  'gpui-base': { h_flex: element, v_flex: element, InputState: { new: input }, Input: { new: element }, TextView: { html: element }, Textarea: { new: element }, TextareaState: { new: input } },
  herdr: { shared: name => saved.get(name), setShared: (name, value) => saved.set(name, value), closeOverlay: id => calls.push(['close', id]), openOverlay: value => calls.push(['overlay', value]),
    agents: () => [{ address: 't1', space: 'a', title: 'Local agent', status: 'working' }, { address: 'remote/t2', space: 'remote/b', title: 'Remote agent', status: 'done' }],
    spaces: () => [{ id: 'a', name: 'Alpha' }, { id: 'remote/b', name: 'Beta' }], run: (...args) => calls.push(['run', ...args]), knownAgents: async () => [], readTextFile: async () => null, exec: async () => ({ code: 0 }), props: () => ({}) },
  './idea-design.js': { adeUI: value => value, adePanel: element, adeButton: element, adeNote: element, adeColors: () => ({}), adeInputBox: value => value, MenuController,
    adeManagedList: (id, rows, _menu, _cx, options) => { lists.set(id, { rows, options }); return element(); } },
  './ui-icons.js': { uiIcon: element }, './workspace.js': { currentProject: () => current, projectKey: key, documentState: () => ({ active: '/a/main.kt' }), openDocument: (...args) => calls.push(['open', ...args]) },
  './terminal.js': { showTerminal: (...args) => calls.push(['show', ...args]) },
  './http-client.js': { httpRequests: () => [{ line: 1, start: 0, end: 2 }], httpEnvs: async () => ({ names: ['local'] }), chosenEnv: () => 'local' },
  './backend.js': { backend: async (route, args) => {
    calls.push(['backend', route, args]);
    return route === 'spring_markers' ? [{ kind: 'spring', title: 'Inject service', name: 'service', line: 1, col: 2 }] : [{ path: '/a/Service.kt', line: 3, col: 1, name: 'Service' }];
  } },
};
async function load(name) {
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(await fs.readFile(new URL(`../../mods/ade/${name}`, import.meta.url), 'utf8'), { context });
  await module.link(name => { const values = bindings[name]; return new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context }); });
  await module.evaluate(); return module.namespace;
}
const { AgentPanel } = await load('agents.js');
const agents = new AgentPanel(); agents.init({}, cx); agents.render(cx);
const all = lists.get('ade-agents'); assert.equal(all.rows.length, 2); assert.match(all.options.caption, /모든 프로젝트/); assert.match(all.rows[1].detail, /Beta/);
all.options.onActivate('remote/t2', null, cx);
assert.deepEqual(plain(calls.slice(-2)), [['run', 'space.select', { id: 'remote/b' }], ['run', 'pane.focus', { terminal: 'remote/t2' }]]);
all.options.rowActions(all.rows[1])[1].action('remote/t2');
assert.equal(calls.at(-1)[1].props.context.id, 'a', 'cross-project attachment keeps the source file project');
assert.equal(calls.at(-1)[1].props.address, 'remote/t2');
agents.release();
const { SpringBrowser, HttpRequests } = await load('project-services.js');
const context = { ...current }, p = { context, path: '/a/main.kt', text: 'unsaved source', revision: 7, overlay: 'fixture' };
const spring = new SpringBrowser(); spring.init(p, cx); await tasks.at(-1);
assert.equal(calls.at(-1)[2].text, 'unsaved source', 'Spring must analyze the current unsaved text');
spring.activate('0', cx); await tasks.at(-1);
assert.equal(saved.get('ade.navigation')[key(context)].path, '/a/Service.kt');
assert.equal(saved.get('ade.navigation')[key(context)].line, 4);
spring.kind = 'beans'; spring.load(cx); await tasks.at(-1);
assert.equal(calls.at(-1)[1], 'spring_project'); assert.equal(calls.at(-1)[2].kind, 'beans');
const count = calls.length; current = { id: 'other', root: '/other' }; spring.activate('0', cx); assert.equal(calls.length, count, 'late navigation cannot affect another project'); spring.release();
current = context;
const http = new HttpRequests(); http.init({ ...p, path: '/a/request.http', text: '### fixture\nGET http://127.0.0.1/' }, cx); await tasks.at(-1);
assert.equal(saved.has('ade.editor-request'), false, 'opening request selection never executes HTTP');
http.execute();
assert.deepEqual(plain(saved.get('ade.editor-request')[key(context)]).request, { line: 1, start: 0, end: 2 });
assert.equal(saved.get('ade.editor-request')[key(context)].revision, 7); assert.equal(saved.get('ade.editor-request')[key(context)].environment, 'local'); http.release();
console.log('PASS ADE project services: global/local/remote agents, source-scoped attachment context, unsaved Spring targets, stale project navigation and explicit HTTP request descriptors');

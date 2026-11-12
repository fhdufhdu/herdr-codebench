import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

let project = { id: 's1', root: '/repo', machine: null, name: 'Repo' }, requests = [], tasks = [], timers = [], saved = new Map(), opened = [], closed = [];
const projectKey = value => JSON.stringify([value.machine ?? null, value.root, value.id]);
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
class MenuController { constructor() { this.at = 0; this.focus = { focus() {}, release() {} }; } release() {} ensureVisible() {} }
class InputState {
  static new() { return new InputState(); }
  constructor() { this.handlers = {}; this.text = ''; }
  on(name, callback) { this.handlers[name] = callback; } value() { return this.text; } focus() {} release() {}
}
const context = vm.createContext({ console });
const bindings = {
  'gpui-kit': { div: element },
  'gpui-base': { h_flex: element, v_flex: element, InputState, Input: { new: element } },
  herdr: { exec: (...args) => new Promise(resolve => requests.push({ args, resolve })), shared: key => saved.get(key), setShared: (key, value) => saved.set(key, value), closeOverlay: id => closed.push(id) },
  './idea-design.js': { MenuController, adeUI: value => value, adeManagedList: element, adeInputBox: value => value, adeButton: element, adeNote: element, adePanel: element },
  './ui-icons.js': { uiIcon: element },
  './workspace.js': { currentProject: () => project, projectKey, openDocument: (...args) => opened.push(args) },
};
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/navigation.js', import.meta.url), 'utf8'), { context });
await module.link(async name => new vm.SyntheticModule(Object.keys(bindings[name]), function () { for (const [key, value] of Object.entries(bindings[name])) this.setExport(key, value); }, { context }));
await module.evaluate(); const api = module.namespace;
const plain = value => JSON.parse(JSON.stringify(value));
const match = (path, line, text) => JSON.stringify({ type: 'match', data: { path: { text: path }, line_number: line, lines: { text } } });
assert.equal(api.parseSearchResults(match('./a.js', 4, 'hello\n'), '/repo')[0].path, '/repo/a.js');
assert.equal(api.parseSearchResults(Array.from({ length: 600 }, () => match('a', 1, 'x')).join('\n'), '/repo').length, 500);
const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); }, timer: { after(_ms, fn) { const timer = { fn, cancelled: false, cancel() { this.cancelled = true; } }; timers.push(timer); return timer; } } };
const search = new api.SearchDialog(); search.init({ context: project, overlay: 'search' }, cx);
const first = requests.shift();
search.input.text = 'quoted'; search.input.handlers.change({}, cx);
timers.at(-1).fn(cx); const second = requests.shift();
second.resolve({ code: 0, stdout: './quoted name.js\0./other.js\0' }); await tasks.at(-1);
first.resolve({ code: 0, stdout: './stale.js\0' }); await tasks[0];
assert.deepEqual(plain(search.rows).map(row => row.path), ['/repo/quoted name.js']);
search.activate(search.rows[0].id, cx);
assert.equal(opened[0][0], '/repo/quoted name.js'); assert.deepEqual(closed, ['search']);
assert.equal(saved.get('ade.navigation')[projectKey(project)].line, 1);
search.mode = 'content'; search.query = '-literal'; search.search(cx);
const content = requests.shift(); assert.equal(content.args[0], 'rg');
assert.equal(content.args[1][content.args[1].indexOf('-e') + 1], '-literal');
assert.deepEqual(Array.from(content.args[1].slice(-2)), ['--', '.']);
content.resolve({ code: 0, stdout: match('./match.js', 21, '<script>\n') }); await tasks.at(-1);
search.activate(search.rows[0].id, cx); assert.equal(saved.get('ade.navigation')[projectKey(project)].line, 21);
search.input.text = 'new'; search.input.handlers.change({}, cx);
assert.equal(search.rows.length, 0, 'old query cannot open stale results during debounce');
search.search(cx); const failure = requests.shift(); failure.resolve({ code: 2, stderr: 'invalid regex' }); await tasks.at(-1);
assert.match(search.error, /invalid regex/);
search.release();
console.log('PASS ADE navigation: bounded file/content search, argv query/path guards, retained input/debounce, stale query rejection and navigation target');

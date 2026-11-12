import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const project = { id: 'owned', root: '/project', machine: null };
let current = project, delayRead, opened, closed, navigation, releases = 0;
const calls = [], tasks = [], owner = {};
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
class MenuController {
  constructor() { this.focus = { focus() {}, release() { releases++; } }; }
  ensureVisible() {} release() { releases++; }
}
const input = () => ({ text: '', value() { return this.text; }, on() {}, focus() {}, release() { releases++; } });
const values = {
  herdr: {
    panes: () => [{ terminal: 't-owned', cwd: '/project/sub' }], terminals: () => [],
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: '/project\n' };
      if (command === 'git') return { code: 0, stdout: 'nested/Missing.kt\0' };
      if (args[1].includes('printf %s')) return { code: 0, stdout: '/home/fixture' };
      return { code: 0, stdout: args.slice(3).filter(path => path === '/project/src/file.ts').join('\n') };
    },
    hc: async args => { calls.push({ hc: args }); if (delayRead) await delayRead; return { code: 0, stdout: 'src/file.ts:8:2\nhttps://example.test/not-a-file.ts\nMissing.kt:4\nversion 1.2.3' }; },
    openOverlay: spec => { opened = spec; }, closeOverlay: id => { closed = id; }, shared: () => ({}), setShared: (_key, value) => { navigation = value; },
  },
  'gpui-base': { h_flex: element, v_flex: element, Input: { new: element }, InputState: { new: input } },
  './idea-design.js': { MenuController, adeManagedList: element, adeInputBox: element, adePanel: element, adeButton: element, adeNote: element },
  './ui-icons.js': { uiIcon: element },
  './workspace.js': { currentProject: () => current, projectKey: value => value.id, openDocument: (path, context) => { opened = { path, context }; } },
};
const sandbox = vm.createContext({}), modules = new Map();
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = values[name];
  const module = exports ? new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context: sandbox })
    : new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/' + name.replace('./', ''), import.meta.url), 'utf8'), { context: sandbox });
  modules.set(name, module); await module.link(load); return module;
}
const module = await load('./terminal-files.js'); await module.evaluate();
const parser = modules.get('./terminal-paths.js').namespace;
const parsed = parser.pathsIn('file:///project/a.kt:42:5\n./src/a.ts(3,2)\nhttps://example.test/a.ts\n1.2.3');
assert.equal(parsed.length, 2); assert.equal(parsed[1].line, 42); assert.equal(parsed[1].col, 5);
const cx = { notify() {}, spawn(fn, options) { assert.equal(options.owner, owner); tasks.push(fn(cx)); } };
const api = module.namespace, view = new api.TerminalFiles(); view.init({ context: project, terminal: 't-owned', overlay: 'owned-overlay', owner }, cx); await tasks.at(-1);
assert.deepEqual(Array.from(view.rows, row => [row.abs, row.line, row.col]), [['/project/nested/Missing.kt', 4, null], ['/project/src/file.ts', 8, 2]]);
assert.ok(calls.some(call => JSON.stringify(call.hc) === JSON.stringify(['read', 't-owned'])));
assert.equal(calls.some(call => call.command === 'git' && call.args[0] === 'rev-parse'), false);
assert.equal(calls.some(call => call.command === 'sh' && call.args[1].includes('printf %s')), false);
view.input.text = 'file.ts'; assert.equal(view.shown().length, 1); view.open(view.shown()[0].id, cx);
assert.equal(opened.path, '/project/src/file.ts'); assert.equal(navigation.owned.line, 8); assert.equal(navigation.owned.column, 2); assert.equal(closed, 'owned-overlay');
current = { id: 'other' }; opened = null; view.open(view.rows[0].id, cx); assert.equal(opened, null);
view.release(); assert.equal(releases, 3);
current = project; let finish; delayRead = new Promise(resolve => { finish = resolve; });
const late = new api.TerminalFiles(); late.init({ context: project, terminal: 't-owned', owner }, cx); late.release(); finish(); await tasks.at(-1); assert.equal(late.rows.length, 0);
console.log('PASS terminal files: shared parsing/resolution, exact terminal, suffix lookup, file/line/column, filter, stale project and release');

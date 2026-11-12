import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createFrameLayout, toggleRegion } from '../../mods/ade/frame-layout.js';
const metrics = { appbarHeight: 48, statusHeight: 26, stripeWidth: 44, leftWidth: 218, rightWidth: 244, lowerHeight: 180, radius: 4, splitterWidth: 6, toolHeaderHeight: 36, tabHeight: 40 };
let current = { id: 'remote/s1', root: '/repo with spaces', machine: 'remote', name: 'Repo', branch: 'main' };
const projectKey = value => JSON.stringify([value.machine ?? null, value.root ?? '', value.id ?? '']);
let tree = toggleRegion(createFrameLayout(metrics), 'terminal'), calls = [], messages = [], tasks = [], tabElements = [];
const saved = new Map();
const space = { id: 'remote/s1', machine: 'remote', tabs: [{ id: 'remote/tab1', name: 'One', active: true }, { id: 'remote/tab2', name: 'Two', active: false }] };
const paneData = [{ pane: 'remote/p1', tab: 'remote/tab1', terminal: 'remote/t1', title: 'Shell' }, { pane: 'remote/p2', tab: 'remote/tab2', terminal: 'remote/t4', title: 'Split shell' }];
const live = [{ address: 'remote/t1', name: 'Existing', labels: {} }, { address: 'remote/t2', labels: { 'herdr.space': 's1' } }, { address: 'remote/t3', labels: { 'herdr.space': 'other' } }, { address: 't1', labels: { 'herdr.space': 's1' } }, { address: 'remote/t4', labels: {} }];
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
const context = vm.createContext({ console });
const values = {
  'gpui-kit': { div: element }, 'gpui-base': { h_flex: element, v_flex: element },
  herdr: { spaces: () => [space], panes: () => paneData, agents: () => [], terminals: () => live, focused: () => ({ terminal: 'remote/t1' }), props: () => ({}),
    layout: () => tree, shared: key => saved.get(key) ?? {}, setShared: (key, value) => saved.set(key, value), closeOverlay() {}, notify: value => messages.push(value),
    exec: async (...args) => { calls.push(['exec', ...args]);
      if (args[1][1] === 'tab.new') { space.tabs.push({ id: 'remote/anchor', name: 'ADE 작업 공간', active: true }); return { code: 0, stdout: JSON.stringify({ tab: 'remote/anchor' }) }; }
      tree = JSON.parse(args[1][2]).layout; return { code: 0 }; }, run: (...args) => calls.push(['run', ...args]) },
  './idea-design.js': { ADE: metrics, MenuController: class {}, adeUI: value => value, adeManagedList: element, adeButton: element, adeNote: element, adeColors: () => ({}), adeTab: (id, label, options) => { tabElements.push({ id, label, options }); return element(); } },
  './ui-icons.js': { uiIcon: element }, './workspace.js': { currentProject: () => current, projectKey },
  './terminal-files.js': { showTerminalFiles: (terminal, context) => calls.push(['files', terminal, context.id]) },
};
const root = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/terminal.js', import.meta.url), 'utf8'), { context });
await root.link(async name => {
  if (name === './project-tools.js') return new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/project-tools.js', import.meta.url), 'utf8'), { context });
  if (name === './frame-layout.js') return new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/frame-layout.js', import.meta.url), 'utf8'), { context });
  return new vm.SyntheticModule(Object.keys(values[name]), function () { for (const [key, value] of Object.entries(values[name])) this.setExport(key, value); }, { context });
});
await root.evaluate(); const api = root.namespace, plain = value => JSON.parse(JSON.stringify(value));
const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); }, focus_handle: () => ({ focus() {}, release() {} }) };
assert.deepEqual(Array.from(api.terminalChoices(current), value => value.address), ['remote/t1', 'remote/t2', 'remote/t4']);
api.openTerminalFiles(current, 'remote/t4');
assert.deepEqual(plain(calls.at(-1)), ['files', 'remote/t4', current.id], 'pane file action keeps the explicitly clicked terminal');
api.openTerminalFiles(current);
assert.deepEqual(plain(calls.at(-1)), ['files', 'remote/t1', current.id], 'tool header file action uses the focused terminal');
calls.length = 0;
api.showTerminal('remote/t3', current, cx); assert.equal(calls.length, 0); assert.equal(messages.length, 1);
api.showTerminal('remote/t1', current, cx); await tasks.at(-1);
assert.deepEqual(plain(calls[0]), ['run', 'tab.select', { id: 'remote/tab1' }]);
const changed = JSON.parse(calls[1][2][2]).layout, nodes = node => [node, ...(node.children ?? []).flatMap(nodes)];
assert.equal(nodes(changed).find(node => node.id === 'ade-terminal-body').content.tab, 'active');
assert.equal(nodes(changed).find(node => node.id === 'ade-terminal-body').content.terminal, undefined, 'never replace split tree with a single address');
calls = []; api.showTerminal('remote/t2', current, cx);
assert.deepEqual(plain(calls), [['run', 'terminal.peek', { terminal: 'remote/t2' }]], 'only scoped orphan terminals peek');
calls = []; api.openTerminal(current, cx); await tasks.at(-1);
assert.deepEqual(plain(calls[0]), ['run', 'tab.new', { space: 'remote/s1', folder: '/repo with spaces' }]);
assert.equal(calls.length, 1, 'already visible native tab body needs no layout rewrite');
calls = []; const old = current; current = { ...current, root: '/changed' };
api.openTerminal(old, cx); assert.equal(calls.length, 0);
current = { ...current, machine: null, root: '/picked-local' };
api.openTerminal(current, cx); assert.equal(calls.length, 0, 'local override cannot create native tab on remote core');
current = old;
const tabs = new api.TerminalTabs(); tabs.init({}, cx); tabs.select('remote/tab2', cx); await tasks.at(-1);
assert.deepEqual(plain(calls[0]), ['run', 'tab.select', { id: 'remote/tab2' }]);
calls = []; tabs.select('foreign-tab', cx); assert.equal(calls.length, 0);
tabs.render(cx); assert.deepEqual(tabElements.map(tab => tab.label), ['One', 'Two']);
assert.equal(tabElements[0].options.selected, true); tabElements[0].options.onClose(undefined, cx);
assert.deepEqual(plain(calls[0]), ['run', 'tab.close', { id: 'remote/tab1' }], 'normal native confirmation is preserved'); tabs.release();
calls = []; const header = new api.PaneHeader(); header.init({ pane: 'remote/p1' }, cx);
for (const [command, args] of [['pane.split', { direction: 'right' }], ['pane.split', { direction: 'down' }], ['pane.zoom', {}], ['pane.close', {}]]) header.command(command, args, cx);
assert.deepEqual(plain(calls), [['run', 'pane.split', { direction: 'right', pane: 'remote/p1' }], ['run', 'pane.split', { direction: 'down', pane: 'remote/p1' }], ['run', 'pane.zoom', { pane: 'remote/p1' }], ['run', 'tab.close', { id: 'remote/tab1' }]]);
space.tabs = [space.tabs[0]]; calls = [];
api.closeTerminalTab('remote/tab1', cx); api.closeTerminalTab('remote/tab1', cx); await tasks.at(-1);
assert.equal(calls.length, 2, 'concurrent last-tab clicks create one workspace tab before closing');
assert.equal(calls[0][2][1], 'tab.new');
assert.deepEqual(JSON.parse(calls[0][2][2]), { space: 'remote/s1', name: 'ADE 작업 공간', mod: 'ade', props: { view: 'project-idle' } });
assert.deepEqual(plain(calls[1]), ['run', 'tab.close', { id: 'remote/tab1' }]);
assert.equal(saved.get('ade.project-tabs')['remote/s1'], 'remote/anchor');
tabElements = []; tabs.render(cx); assert.equal(tabElements.length, 1, 'workspace anchor is not a terminal tab');
header.release(); assert.equal(calls.some(call => call[1] === 'kill' || call[1] === 'send'), false);
console.log('PASS ADE native tabs/panes: scope guards, whole split tree composition, core tab creation/selection/normal close, explicit pane split/zoom/close ids, orphan peek fallback');

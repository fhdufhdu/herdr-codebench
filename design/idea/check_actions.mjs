// Run: node --experimental-vm-modules design/idea/check_actions.mjs
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

const raw = await readFile(new URL('../../mods/codenav/actions.js', import.meta.url), 'utf8');
// The registry is intentionally portable and cannot import a view/runtime cycle.
assert.ok(!/^import\s/m.test(raw));
const module = new vm.SourceTextModule(raw, { context: vm.createContext({}) });
await module.link(() => { throw Error('pure registry imported a runtime dependency'); });
await module.evaluate();
const { ACTIONS, ACTION_GROUPS, getAction, listActions, actionPresentation, effectiveShortcuts, formatShortcut, actionForTerminalKey, normalizeChord } = module.namespace;
const iconRegistry = JSON.parse(await readFile(new URL('./icons.json', import.meta.url), 'utf8'));
assert.ok(ACTIONS.length >= 50);
assert.equal(new Set(ACTIONS.map(action => action.id)).size, ACTIONS.length);
for (const action of ACTIONS) {
  assert.equal(action.command, action.id);
  assert.equal(getAction(action.id), action);
  assert.ok(action.label && action.category && action.owner);
  const role = iconRegistry.aliases[action.icon] ?? action.icon;
  const asset = iconRegistry.roles[role];
  assert.ok(asset, `Action icon role exists: ${action.icon}`);
  await access(new URL(`../../mods/codenav/ui-icons/${asset}.svg`, import.meta.url));
}
for (const [name, group] of Object.entries(ACTION_GROUPS)) {
  assert.equal(new Set(group.items.map(item => item.id)).size, group.items.length, `${name}: stable unique occurrence IDs`);
  for (const item of group.items) if (item.kind === 'action') assert.ok(getAction(item.action), `${name}: ${item.action}`);
}
assert.equal(ACTION_GROUPS['MainToolbar.left'].items[0].widget, 'project');
assert.equal(getAction('terminal-files').keymapSection, 'terminal');
assert.deepEqual(Array.from(getAction('terminal-files').defaultKeys), ['cmd-shift-o']);
assert.ok(ACTION_GROUPS['header.Project'].items.some(item => item.action === 'activity.project-refresh'));
assert.ok(ACTION_GROUPS['HTTP.toolbar'].items.some(item => item.action === 'codenav.http-run-all'));

const local = { layout: 'idea', document: { kind: 'file', path: '/repo/Main.kt' }, workspace: { folder: '/repo' } };
assert.equal(actionPresentation('definition', local).enabled, true);
assert.equal(actionPresentation('definition', { ...local, document: { ...local.document, on: 'sshbox' } }).enabled, false);
assert.equal(actionPresentation('definition', { ...local, area: 'review' }).enabled, false);
assert.equal(actionPresentation('definition', { ...local, document: { kind: 'file', path: '/repo/image.png' } }).enabled, false);
for (const suffix of ['db','sqlite','flac','tiff','class','dylib','tar','woff2']) {
  assert.equal(actionPresentation('activity.save', { ...local, document: { kind: 'file', path: '/repo/sample.'+suffix } }).enabled, false, 'media viewers do not become owned source editors');
}
assert.equal(actionPresentation('activity.save', local).enabled, true, 'IDEA source and editing share one editable document');
assert.equal(actionPresentation('activity.save', local).command, 'codenav.save', 'UI actions reach the shown owned editor');
assert.equal(actionPresentation('activity.preview', { ...local, document: { kind: 'file', path: '/repo/README.md' } }).command, 'codenav.rich-view');
assert.equal(actionPresentation('activity.save', { ...local, document: { kind: 'file', path: '/repo/a.kt', on: 'remote', edit: true } }).command, 'activity.save');
assert.equal(actionPresentation('activity.save', { ...local, document: { kind: 'database', path: 'db://console', database: { kind: 'console' } } }).command, 'codenav.save');
assert.equal(actionPresentation('activity.save', { ...local, layout: 'codebench' }).enabled, false, 'codebench keeps explicit native editing');
assert.equal(actionPresentation('definition', { ...local, document: { ...local.document, edit: true } }).enabled, true);
assert.equal(actionPresentation('activity.save', { ...local, document: { ...local.document, edit: true } }).enabled, true);
assert.equal(actionPresentation('codenav.http-run-all', local).enabled, false);
assert.equal(actionPresentation('codenav.http-run-all', { ...local, document: { kind: 'file', path: '/repo/requests.http' } }).enabled, true);
assert.equal(actionPresentation('stop', { ...local, running: false }).enabled, false);
assert.equal(actionPresentation('stop', { ...local, running: true }).enabled, true);
assert.equal(actionPresentation('problems-errors-only', { problemsOptions: { errorsOnly: true } }).selected, true);
assert.equal(actionPresentation('review-next-diff', local).enabled, false);
assert.equal(actionPresentation('review-next-diff', { ...local, area: 'review' }).enabled, true);
assert.equal(actionPresentation('nonexistent', local).visible, false);
assert.equal(listActions({ layout: 'codebench' }).length, 1, 'IDEA surfaces are not injected into codebench');

let bindings = [
  { section: 'layout:idea', keys: 'cmd-shift-space', action: 'codenav.find-all' },
  { section: 'layout:idea', keys: 'cmd-shift-o', action: 'codenav.find-file' },
  { section: 'layout:idea', keys: 'cmd-,', action: 'app.settings' },
  { section: 'layout:idea', keys: 'cmd-shift-,', action: 'codenav.settings' },
  { section: 'terminal', keys: 'cmd-shift-o', action: 'codenav.key:cmd-shift-o' },
  { section: 'terminal', keys: 'cmd-shift-space', action: 'codenav.key:cmd-shift-space' },
  { section: 'layout:codebench', keys: 'cmd-shift-o', action: 'codenav.terminal-files' },
  { section: 'mod:activity', keys: 'cmd-b', action: 'activity.bold' },
  { section: 'mod:codenav', keys: 'cmd-b', action: 'codenav.definition' },
];
const asArray = value => Array.from(value);
assert.deepEqual(asArray(effectiveShortcuts('find-all', bindings, { layout: 'idea' })), ['cmd-shift-space']);
assert.equal(formatShortcut('shift shift'), '⇧ ⇧');
assert.equal(formatShortcut('cmd-O'), '⌘⇧O', 'display matches GPUI uppercase-key semantics');
assert.equal(formatShortcut('ctrl--'), '⌃-');
assert.equal(formatShortcut('cmd-shift-,'), '⌘⇧,');
assert.deepEqual(asArray(effectiveShortcuts('definition', bindings, { layout: 'idea', mod: 'activity' })), []);
assert.deepEqual(asArray(effectiveShortcuts('definition', bindings, { layout: 'idea', mod: 'codenav' })), ['cmd-b']);
assert.deepEqual(asArray(effectiveShortcuts('file-structure', bindings, { layout: 'idea' })), [], 'removed/unbound defaults must not be advertised');
assert.deepEqual(asArray(effectiveShortcuts('find-file', bindings, { layout: 'idea', terminal: true })), ['cmd-shift-o']);
assert.equal(actionForTerminalKey('cmd-,', bindings).command, 'app.settings');
assert.equal(actionForTerminalKey('cmd-shift-,', bindings).command, 'codenav.settings');
assert.equal(actionForTerminalKey('cmd-shift-o', bindings, { layout: 'codebench' }), null);
bindings = bindings.map(binding => binding.section === 'layout:idea' && binding.keys === 'cmd-shift-o' ? { ...binding, action: 'codenav.find-class' } : binding);
assert.deepEqual(asArray(effectiveShortcuts('find-file', bindings, { layout: 'idea' })), []);
assert.deepEqual(asArray(effectiveShortcuts('find-class', bindings, { layout: 'idea' })), ['cmd-shift-o']);
assert.equal(actionForTerminalKey('cmd-shift-o', bindings).command, 'codenav.find-class', 'terminal routing follows a user reassignment');
assert.equal(normalizeChord('cmd-O'), 'cmd-shift-o');
assert.equal(actionForTerminalKey('cmd-shift-O', bindings).command, 'codenav.find-class', 'literal forwarded aliases resolve the current assignment');
const aliases = [{ section: 'layout:idea', keys: 'cmd-O', action: 'codenav.find-file' },
  { section: 'terminal', keys: 'cmd-shift-o', action: 'codenav.key:cmd-O' }];
assert.deepEqual(asArray(effectiveShortcuts('find-file', aliases, { layout: 'idea', terminal: true })), ['cmd-shift-o']);
assert.equal(actionForTerminalKey('cmd-b', bindings, { layout: 'idea', mod: 'codenav' }).command, 'codenav.definition');
assert.equal(actionForTerminalKey('cmd-b', bindings, { layout: 'idea', mod: 'activity' }), null, 'an unknown owning-mod assignment cannot fall through to the source action');
const declared = [
  { section: 'layout:idea', keys: 'cmd-shift-o', action: 'codenav.find-file' },
  { section: 'terminal', keys: 'cmd-shift-o', action: 'codenav.terminal-files' },
];
assert.deepEqual(asArray(effectiveShortcuts('find-file', declared, { layout: 'idea', mod: 'codenav' })), ['cmd-shift-o']);
assert.deepEqual(asArray(effectiveShortcuts('find-file', declared, { layout: 'idea', terminal: true })), []);
assert.deepEqual(asArray(effectiveShortcuts('terminal-files', declared, { layout: 'idea', terminal: true })), ['cmd-shift-o']);
assert.deepEqual(asArray(effectiveShortcuts('terminal-files', declared, { layout: 'codebench', terminal: true })), ['cmd-shift-o']);
const terminalAlias = declared.map(binding => binding.section === 'terminal' ? { ...binding, keys: 'cmd-O' } : binding);
assert.deepEqual(asArray(effectiveShortcuts('find-file', terminalAlias, { layout: 'idea', terminal: true })), []);
assert.deepEqual(asArray(effectiveShortcuts('terminal-files', terminalAlias, { layout: 'idea', terminal: true })), ['cmd-O'], 'physical-equivalent spelling still selects the terminal-specific action');
console.log('PASS pure action registry, supported icon/group references, contextual presentation, effective keymap and terminal reassignment');

// Exercise the actual picker compute/pick, not a duplicate of its implementation.
const source = await readFile(new URL('../../mods/codenav/everywhere.js', import.meta.url), 'utf8');
const state = { 'layout': 'idea' }, calls = [];
const stub = () => new Proxy({}, { get: () => stub });
let editor = { kind: 'file', path: '/repo/Main.kt' };
const context = vm.createContext({ console, Date });
const mods = {
  'gpui-kit': { div: stub },
  'gpui-base': { v_flex: stub, h_flex: stub, InputState: {}, Input: {}, v_virtual_list: stub, VirtualListScrollHandle: {}, Scrollbar: {} },
  herdr: { theme: () => ({}), props: () => ({ overlay: 'test' }), closeOverlay: () => calls.push('close'), openOverlay: stub,
    exec: stub, run: name => calls.push(name), commands: () => [{ name: 'codenav.find-file', about: 'duplicate', args: [] }, { name: 'space.new', about: 'New Space', args: [] }],
    keys: () => bindings, shared: key => state[key], settings: () => ({}), focused: () => null, spaces: () => [{ active: true, folder: '/repo' }] },
  './i18n.js': { T: text => text },
  './idea-design.js': { IDEA: {}, isIdea: () => true, uiSize: () => 13, popupSurface: stub, uiInputBox: stub, uiListRow: stub, uiCaption: stub, uiSeparator: stub, uiTab: stub },
  './common.js': { icon: stub, location: () => ({ cwd: '/repo' }), openPath: stub, editorSpec: () => editor, editorKey: () => 'test', basename: path => path.split('/').pop(), tilde: text => text, uiFontFamily: () => 'system' },
  './lsp.js': { lsp: stub }, './ideaicons.js': { ideaImage: stub, symbolImage: stub, toolImage: stub },
  './run.js': { runStore: () => ({ configs: [], selected: 0 }), isRunning: () => false },
};
const actionModule = new vm.SourceTextModule(raw, { context }); await actionModule.link(() => {}); await actionModule.evaluate();
const pickerModule = new vm.SourceTextModule(source, { context });
await pickerModule.link(name => {
  if (name === './actions.js') return actionModule;
  const values = mods[name]; assert.ok(values, `missing mock ${name}`);
  return new vm.SyntheticModule(Object.keys(values), function() { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
});
await pickerModule.evaluate();
const picker = new pickerModule.namespace.Everywhere();
picker.mode = 'actions'; picker.input = { value: () => 'go to' }; picker.context = { cwd: '/repo' };
picker.files = []; picker.symbols = []; picker.root = '/repo';
const rows = await picker.compute({ sleep: async () => {} }, () => false);
assert.equal(rows.filter(row => row.name === 'codenav.find-file').length, 1, 'registered native duplicates cannot produce two action results');
assert.equal(rows.find(row => row.name === 'codenav.find-class').key, '⌘⇧O');
assert.equal(rows.find(row => row.name === 'codenav.find-file').key, '');
const declaration = rows.find(row => row.name === 'codenav.definition');
editor = null;
picker.pick(declaration, {});
assert.equal(calls.length, 0, 'context is checked again before execution; stale source actions cannot close the picker or run');
editor = { kind: 'file', path: '/repo/Main.kt' };
picker.pick(declaration, {});
assert.deepEqual(calls, ['close', 'codenav.definition']);
console.log('PASS actual Find Action metadata/keymap/dedup and stale-context execution guard');

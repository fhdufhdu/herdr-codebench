import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createFrameLayout } from '../../mods/ade/frame-layout.js';
const metrics = { appbarHeight: 48, statusHeight: 26, stripeWidth: 44, leftWidth: 218, rightWidth: 244, lowerHeight: 180, radius: 4, splitterWidth: 6, toolHeaderHeight: 36, tabHeight: 40 };
const nodes = node => [node, ...(node.children ?? []).flatMap(nodes)];
let tree = createFrameLayout(metrics), file = JSON.stringify({ global: { 'ctrl-r': 'native.run' }, 'layout:ade': { 'cmd-p': 'ade:search' }, unknown: { future: [1, 2] } }), tasks = [], writes = [], commands = [], saved = new Map();
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
class InputState { static new({ value }) { return new InputState(value); } constructor(value) { this.text = value; } value() { return this.text; } set_value(value) { this.text = value; } on() {} release() {} }
class MenuController { constructor() { this.focus = { focus() {}, release() {} }; } release() {} ensureVisible() {} }
const bindings = {
  'gpui-kit': { div: element }, 'gpui-base': { h_flex: element, v_flex: element, InputState, Input: { new: element } },
  herdr: { keys: () => [{ section: 'global', keys: 'ctrl-r', action: 'native.run' }, { section: 'layout:ade', keys: 'cmd-p', action: 'ade:search' }], settings: () => ({ editor_font: 'My Mono' }),
    shared: key => saved.get(key), setShared: (key, value) => saved.set(key, value), layout: () => tree, appHome: () => '/app', closeOverlay() {}, openOverlay() {},
    readTextFile: async () => file, writeTextFile: async (...args) => { assert.equal(args[2], file); writes.push(args); file = args[1]; }, exec: async (...args) => { commands.push(args); tree = JSON.parse(args[1][2]).layout; return { code: 0 }; } },
  './idea-design.js': { MenuController, adeUI: value => value, adeManagedList: element, adeInputBox: value => value, adeButton: element, adeNote: element, adePanel: element }, './ui-icons.js': { uiIcon: element },
};
bindings['./workspace.js'] = { currentProject: () => ({ id: 'project' }), projectKey: context => context.id };
const context = vm.createContext({ console });
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/settings.js', import.meta.url), 'utf8'), { context });
await module.link(async name => {
  if (name === './project-tools.js') return new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/project-tools.js', import.meta.url), 'utf8'), { context });
  if (name === './frame-layout.js') return new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/frame-layout.js', import.meta.url), 'utf8'), { context });
  return new vm.SyntheticModule(Object.keys(bindings[name]), function () { for (const [key, value] of Object.entries(bindings[name])) this.setExport(key, value); }, { context });
});
await module.evaluate(); const api = module.namespace, plain = value => JSON.parse(JSON.stringify(value));
assert.equal(api.validateADEChord('Ctrl-R'), 'ctrl-r'); assert.equal(api.validateADEChord('Meta-Shift-P'), 'cmd-shift-p');
assert.notEqual(api.validateADEChord('ctrl-r'), api.validateADEChord('cmd-r'));
for (const chord of ['', 'ctrl', 'ctrl-', '\ncmd-x', 'cmd-ctrl']) assert.throws(() => api.validateADEChord(chord));
const source = JSON.parse(file), initial = JSON.stringify(source);
const changed = api.applyADEBindingEdits(source, [{ section: 'layout:ade', chord: 'ctrl-r', action: 'ade:run', expected: null }]);
assert.equal(changed.global['ctrl-r'], 'native.run'); assert.equal(changed['layout:ade']['ctrl-r'], 'ade:run');
assert.deepEqual(plain(changed.unknown), source.unknown); assert.equal(JSON.stringify(source), initial);
assert.throws(() => api.applyADEBindingEdits(source, [{ section: 'global', chord: 'ctrl-r', action: 'ade:run', expected: 'native.run' }]), /덮어쓸/);
assert.throws(() => api.applyADEBindingEdits(source, [{ section: 'layout:ade', chord: 'cmd-p', action: 'space.close', expected: 'ade:search' }]), /ADE/);
assert.throws(() => api.applyADEBindingEdits(source, [{ section: 'layout:ade', chord: 'cmd-p', action: null, expected: 'ade:run' }]), /변경/);
const removed = api.applyADEBindingEdits(source, [{ section: 'layout:ade', chord: 'cmd-p', action: null, expected: 'ade:search' }]);
assert.equal(removed['layout:ade']['cmd-p'], undefined); assert.equal(removed.global['ctrl-r'], 'native.run');
const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); } };
const view = new api.SettingsView(); view.init({ overlay: 'settings' }, cx); await tasks.at(-1);
assert.equal(writes.length, 0); assert.equal(commands.length, 0); assert.equal(saved.size, 0, 'opening settings never changes preferences or bindings');
view.apply(cx); assert.equal(saved.size, 0); assert.equal(writes.length, 0, 'unchanged Apply preserves defaults');
view.inputs.font.set_value('New Mono'); view.inputs.size.set_value('17'); view.apply(cx);
assert.deepEqual(plain(saved.get('ade.preferences')), { editorFont: 'New Mono', editorSize: 17 }); assert.equal(writes.length, 0);
view.category = 'keymap'; view.inputs.chord.set_value('cmd-shift-r'); view.inputs.action.set_value('ade:run'); view.editBinding('add', cx);
assert.equal(view.edits.length, 1); assert.equal(writes.length, 0, 'edits remain staged');
view.inputs.font.set_value('Whole Dialog Mono'); view.tools.terminal.position = 'left-top';
file += ' '; view.apply(cx); await tasks.at(-1); assert.equal(writes.length, 0); assert.match(view.error, /다른 곳/);
assert.equal(saved.get('ade.preferences').editorFont, 'New Mono'); assert.equal(commands.length, 0); assert.equal(view.edits.length, 1, 'CAS failure keeps every remaining category draft');
file = view.keyText; view.apply(cx); await tasks.at(-1);
assert.equal(writes.length, 1); assert.equal(JSON.parse(file).global['ctrl-r'], 'native.run'); assert.equal(JSON.parse(file)['layout:ade']['cmd-shift-r'], 'ade:run');
assert.equal(saved.get('ade.preferences').editorFont, 'Whole Dialog Mono'); assert.equal(saved.get('ade.project-tools').project.tools.terminal.position, 'left-top'); assert.equal(commands.length, 1, 'one Apply saves edited categories across pages');
commands = [];
view.category = 'tools'; view.tools.terminal.position = 'left-top'; view.tools.project.hidden = true;
nodes(tree).find(node => node.id === 'ade-agents').hidden = true;
nodes(tree).find(node => node.id === 'ade-terminal').size = { px: 233 };
view.apply(cx); await tasks.at(-1);
assert.equal(commands.length, 1); assert.equal(commands[0][0], 'herdr-app');
const layout = JSON.parse(commands[0][1][2]).layout;
assert.equal(nodes(layout).find(node => node.id === 'ade-left').children.some(node => node.id === 'ade-terminal'), true);
assert.equal(nodes(layout).find(node => node.id === 'ade-project').hidden, true);
assert.equal(nodes(layout).find(node => node.id === 'ade-agents').hidden, true, 'unedited live visibility is preserved');
assert.equal(nodes(layout).find(node => node.id === 'ade-terminal').size.px, 233, 'live manual sizes survive arrangement');
assert.equal(saved.get('ade.project-tools').project.tools.terminal.position, 'left-top');
view.release();
console.log('PASS ADE settings: Ctrl/Meta boundary, owned binding edits, native conflicts/unknown preservation, no initial writes, staged edits/CAS, editor prefs, all-position native layout application');

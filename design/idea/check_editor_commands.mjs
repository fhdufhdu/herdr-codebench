// node --experimental-vm-modules design/idea/check_editor_commands.mjs
// Real effective-keymap resolver and bridge; native action dispatch is a fixture.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

let bindings = [], rendering = false, pending = false;
const installed = [], timers = [], calls = [], commands = [];
const element = () => {
  const node = { styles: {}, handlers: {}, children: [] };
  const root = new Proxy(node, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      if (name === 'on_action') target.handlers[args[0]] = args[1];
      else if (name === 'child') target.children.push(args[0]);
      else target.styles[name] = args;
      return root;
    };
  } }); return root;
};
const cx = {
  bind_keys(list) { assert.equal(rendering, false, 'native bindings cannot be installed during render'); installed.push(...list); },
  timer: { after(delay, action) { assert.equal(delay, 0); timers.push(action); } },
  notify() { calls.push('notify'); }, propagate() { calls.push('propagate'); }, stop_propagation() { calls.push('stop'); },
};
const context = vm.createContext({});
const actions = new vm.SourceTextModule(await readFile(new URL('../../mods/codenav/actions.js', import.meta.url), 'utf8'), { context });
await actions.link(() => { throw new Error('unexpected action dependency'); });
const bridgeModule = new vm.SourceTextModule(await readFile(new URL('../../mods/codenav/editor-commands.js', import.meta.url), 'utf8'), { context });
await bridgeModule.link(id => {
  if (id === './actions.js') return actions;
  const values = id === 'gpui-kit' ? { div: element } : { keys: () => bindings };
  return new vm.SyntheticModule(Object.keys(values), function() { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context });
});
await bridgeModule.evaluate(); const { EditorCommands } = bridgeModule.namespace;
const draw = bridge => {
  rendering = true;
  try { return bridge.render(element(), cx); } finally { rendering = false; }
};
const flush = () => { while (timers.length) timers.shift()(cx); };
const make = () => { const bridge = new EditorCommands(); bridge.init(cx, { onCommand: command => { commands.push(command); }, pending: () => pending }); return bridge; };
const keymap = (chord, action = 'activity.save', section = 'layout:idea') => ({ section, keys: chord, action });
const actionFor = (root, chord) => installed.findLast(binding => binding.keystroke === chord && binding.context === root.styles.key_context[0])?.action;
const activate = (root, chord) => { const action = actionFor(root, chord); assert.ok(action, `bound ${chord}`); root.handlers[action]({}, cx); };

assert.throws(() => new EditorCommands().init(cx), /callbacks/);
const empty = make(); assert.equal(installed.length, 0, 'no hardcoded/default Cmd+S or preview fallback');
const emptyRoot = draw(empty); assert.equal(Object.keys(emptyRoot.handlers).length, 0); empty.release();

bindings = [keymap('ctrl-s'), keymap('cmd-S'), keymap('ctrl-k ctrl-p', 'activity.preview'), keymap('cmd-s', 'other.action')];
const bridge = make(); let root = draw(bridge);
assert.equal(installed.length, 6); assert.ok(actionFor(root, 'ctrl-s')); assert.ok(actionFor(root, 'cmd-shift-s')); assert.ok(actionFor(root, 'ctrl-k ctrl-p'));
assert.equal(actionFor(root, 'cmd-s'), undefined, 'an unrelated user assignment is not stolen');
const documentContext = root.styles.key_context[0];
assert.equal(installed.filter(binding => binding.context === documentContext).length, 3, 'preview retains document-level bindings');
assert.equal(installed.filter(binding => binding.context === `${documentContext} > Input`).length, 3, 'text descendants also match at the native Input depth');
for (const chord of ['ctrl-s', 'cmd-shift-s', 'ctrl-k ctrl-p']) {
  const aliases = installed.filter(binding => binding.keystroke === chord);
  assert.equal(aliases[0].action, aliases[1].action, 'both predicates invoke the same guarded owner callback');
}
assert.deepEqual(root.styles.size_full, []); assert.deepEqual(root.styles.flex_1, []);
assert.deepEqual(root.styles.min_w, [0]); assert.deepEqual(root.styles.min_h, [0]);
activate(root, 'ctrl-s'); activate(root, 'cmd-shift-s'); activate(root, 'ctrl-k ctrl-p');
assert.deepEqual(commands, ['save', 'save', 'preview']); assert.equal(calls.at(-1), 'stop');
assert.equal(calls.filter(call => call === 'notify').length, 3, 'handled commands repaint state-only Preview changes');
const beforePending = commands.length; pending = true; activate(root, 'ctrl-s');
assert.equal(commands.length, beforePending); assert.equal(calls.at(-1), 'propagate', 'IME stays native'); pending = false;

// Reassignment/removal immediately changes context even before the deferred bind.
const oldRoot = root, oldContext = root.styles.key_context[0], oldSave = actionFor(root, 'ctrl-s');
bindings = [keymap('ctrl-s', 'other.action'), keymap('cmd-k cmd-s'), keymap('alt-p', 'activity.preview')];
const beforeInstall = installed.length; root = draw(bridge);
assert.notEqual(root.styles.key_context[0], oldContext); assert.equal(installed.length, beforeInstall);
assert.equal(actionFor(root, 'ctrl-s'), undefined); assert.equal(actionFor(root, 'cmd-k cmd-s'), undefined);
oldRoot.handlers[oldSave]({}, cx); assert.equal(commands.length, beforePending); assert.equal(calls.at(-1), 'propagate', 'stale render handler cannot execute a reassigned key');
flush(); root = draw(bridge); assert.ok(actionFor(root, 'cmd-k cmd-s')); activate(root, 'cmd-k cmd-s');
assert.equal(commands.at(-1), 'save');
assert.equal(actionFor(root, 'ctrl-s'), undefined);
const stableInstallCount = installed.length; draw(bridge); flush(); assert.equal(installed.length, stableInstallCount, 'stable renders do not churn application keymap');

// A higher-priority codenav assignment overrides global/layout actions.
bindings = [keymap('cmd-q', 'activity.save', 'global'), keymap('cmd-q', 'other.action'), keymap('cmd-q', 'activity.preview', 'mod:codenav'), keymap('cmd-s', 'activity.save', 'mod:activity'), keymap('ctrl-r', 'other.action', 'terminal')];
root = draw(bridge); flush(); root = draw(bridge);
activate(root, 'cmd-q'); assert.equal(commands.at(-1), 'preview'); assert.equal(Object.keys(root.handlers).length, 1);
assert.equal(actionFor(root, 'cmd-s'), undefined, 'hidden activity-specific bindings do not become codenav focus bindings');

// Only the latest deferred keyset may be installed; release cancels callbacks.
bindings = [keymap('alt-a')]; const intermediate = draw(bridge).styles.key_context[0];
bindings = [keymap('alt-b')]; root = draw(bridge); flush();
assert.equal(installed.some(binding => binding.context === intermediate), false);
assert.ok(actionFor(root, 'alt-b'));
bindings = []; root = draw(bridge); flush(); assert.equal(Object.keys(root.handlers).length, 0);
assert.equal(actionFor(root, 'alt-b'), undefined, 'removed shortcuts do not continue matching old registered contexts');
bindings = [keymap('ctrl-z')]; root = draw(bridge); const beforeRelease = installed.length; bridge.release(); flush();
assert.equal(installed.length, beforeRelease);
const afterReleaseCommands = commands.length;
Object.values(root.handlers)[0]({}, cx); assert.equal(commands.length, afterReleaseCommands); assert.equal(calls.at(-1), 'propagate');

// Two visible copies share declarations, but only the focused wrapper handles
// its event. No global broadcast/nextCommand queue is introduced.
bindings = [keymap('ctrl-j')];
const first = make(), second = make(), firstRoot = draw(first), secondRoot = draw(second);
assert.equal(firstRoot.styles.key_context[0], secondRoot.styles.key_context[0]);
const beforeFocused = commands.length; activate(secondRoot, 'ctrl-j'); assert.equal(commands.length, beforeFocused + 1);
first.release(); second.release();
console.log('PASS real effective-keymap bridge: no defaults, Ctrl/Meta/shift/sequences, reassignment/removal/context isolation, deferred bind race, IME propagation, release and focused callback ownership');
console.log('UNVERIFIED native key-context specificity/sequence dispatch and IME/global-action fallback; parent native UI validation required');

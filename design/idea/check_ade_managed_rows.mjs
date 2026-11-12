import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
let elements = [], deferred = false, virtualCount = 0, scrollbarCount = 0;
class Element {
  constructor() {
    this.calls = []; let proxy;
    proxy = new Proxy(this, { get: (target, key) => key in target ? target[key] : (...args) => {
      assert(!deferred || !String(key).startsWith('on_'), 'no event handlers in deferred item renderer');
      target.calls.push([key, ...args]); return proxy;
    } }); elements.push(proxy); return proxy;
  }
  when(condition, fn) { return condition ? fn(this) : this; }
}
const el = () => new Element(), context = vm.createContext({ console });
const tokens = JSON.parse(await fs.readFile(new URL('./tokens.json', import.meta.url), 'utf8'));
const modules = {
  'gpui-kit': { div: el, PathBuilder: { stroke: el } },
  'gpui-base': { h_flex: el, v_flex: el, Button: { new: id => el().id(id) }, Scrollbar: { vertical: () => { scrollbarCount++; return el(); } }, HoverCard: { new: el }, TextView: { html: el },
    VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
    v_virtual_list: (_id, count, _height, _key, render) => { virtualCount++; deferred = true; try { render({ start: 0, end: Math.min(10, count) }); } finally { deferred = false; } return el(); } },
  herdr: { shared() {}, setShared() {}, settings: () => ({}), theme: () => ({}), notify() {}, playSound() {}, openOverlay() {}, closeOverlay() {} },
  './idea-tokens.js': { IDEA_TOKENS: tokens },
};
const module = new vm.SourceTextModule(await fs.readFile(new URL('./ui.js', import.meta.url), 'utf8'), { context });
await module.link(async name => new vm.SyntheticModule(Object.keys(modules[name]), function () { for (const [key, value] of Object.entries(modules[name])) this.setExport(key, value); }, { context }));
await module.evaluate(); const ui = module.namespace;
const cx = { focus_handle: () => ({ focus() {}, release() {} }), notify() {}, stop_propagation() {} };
const controller = new ui.MenuController(cx); controller.windowHeight = 280;
let rows = Array.from({ length: 1000 }, (_value, index) => ({ id: `r${index}`, label: `Row ${index}`, icon: el, disabled: index === 5 }));
let selectedId = 'r0', activated = 0, activateOnClick = false, lastSelectEvent, produced = 0; const acted = [];
const options = () => ({ selectedId, activateOnClick, onSelect: (id, event) => { selectedId = id; lastSelectEvent = event; }, onActivate: () => activated++,
  rowActions: () => { produced++; return [{ id: 'copy', label: 'Copy', icon: el, action: id => acted.push(id) }]; } });
const render = () => { elements = []; produced = 0; ui.adeManagedList('managed', rows, controller, cx, options()); };
const find = id => elements.find(item => item.calls.some(call => call[0] === 'id' && call[1] === id));
const callback = (item, name) => item.calls.find(call => call[0] === name)?.at(-1);
const key = chord => { callback(elements.find(item => item.calls.some(call => call[0] === 'on_key_down')), 'on_key_down')({ keystroke: chord }, cx); render(); };
render(); assert.equal(produced, 10); assert.equal(virtualCount, 0); assert.equal(scrollbarCount, 0, 'window mode has no unattached scrollbar');
assert(find('managed-r0-copy'), 'selected row exposes keyboard accessible actions');
callback(find('managed-r3'), 'on_hover')(true, cx); render();
const exactAction = callback(find('managed-r3-copy'), 'on_click'); selectedId = 'r4'; render(); exactAction({}, cx);
assert.deepEqual(acted, ['r3']); assert.equal(selectedId, 'r4'); assert.equal(activated, 0, 'row action neither selects nor activates another item');
callback(find('managed-r2'), 'on_click')({}, cx); assert.equal(selectedId, 'r2'); assert.equal(lastSelectEvent, undefined, 'ordinary pointer selection preserves managed-list callback semantics'); render();
activateOnClick = true; render(); key('down'); assert.equal(activated, 0, 'arrow selects without activating context menus');
callback(find('managed-r2'), 'on_click')({}, cx); assert.equal(activated, 1, 'opt-in pointer activation runs once'); render();
key('enter'); assert.equal(activated, 2, 'Enter activates once independently of pointer mode'); activateOnClick = false;
callback(find('managed-window'), 'on_scroll_wheel')({ delta: { x: 0, y: -280 } }, cx); assert.equal(controller.windowStart, 10); render();
assert.equal(controller.windowStart, 10, 'wheel position survives unchanged selection and redraw');
key('end'); assert.equal(selectedId, 'r999'); assert.equal(controller.windowStart, 990); assert(find('managed-r999'));
key('pageup'); assert.equal(selectedId, 'r989'); assert(controller.windowStart <= 989 && controller.windowStart + controller.windowCount > 989);
key('home'); assert.equal(selectedId, 'r0'); assert.equal(controller.windowStart, 0);
selectedId = 'r700'; render(); assert(find('managed-r700'), 'externally changed selected id is revealed');
callback(find('managed-window'), 'on_size_change')({ height: 28 }, cx); render(); assert.equal(controller.windowCount, 1); assert(find('managed-r700'), 'resize keeps previously visible selection on screen');
controller.windowHeight = 4000; render(); assert.equal(produced, 25, 'large viewport stays bounded');
rows = [...rows].reverse(); render(); assert(find('managed-r700'), 'reordering reveals same stable selected id');
selectedId = 'r5'; render(); const disabled = find('managed-r5-copy'); assert(disabled.calls.some(call => call[0] === 'disabled' && call[1] === true)); assert.equal(callback(disabled, 'on_click'), undefined);
assert.throws(() => ui.adeManagedList('bad', [{ id: 'one', label: 'One' }], controller, cx, { selectedId: 'one', rowActions: () => [{ id: 'bad', icon: el() }] }), /factories/);
ui.adeManagedList('virtual-default', rows, controller, cx, { selectedId }); assert.equal(virtualCount, 1); assert.equal(scrollbarCount, 1, 'default remains virtual with attached native scrollbar');
controller.release(); controller.focus.release();
console.log('PASS ADE row hover: bounded ordinary rows, exact-row native actions, disabled/factory states, End/Page/Home/reorder/resize reveal, wheel retention, no deferred handlers or fake scrollbar, virtual default');

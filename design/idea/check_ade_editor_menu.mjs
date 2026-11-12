import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const saved = new Map(), overlays = [], closed = []; let renderedRows, listOptions;
const element = () => new Proxy({}, { get: (_target, key) => key === "then" ? undefined : () => element() });
class MenuController { constructor() { this.focus = { focus() {}, release() {} }; } release() {} }
const bindings = {
  "gpui-base": { v_flex: element },
  herdr: { shared: key => saved.get(key), setShared: (key, value) => saved.set(key, value), openOverlay: spec => overlays.push(spec), closeOverlay: id => closed.push(id) },
  "./idea-design.js": { ADE: { rowHeight: 30, radius: 6 }, adeUI: value => value, adeColors: () => ({}), adeSize: () => 13, MenuController,
    adeManagedList: (_id, rows, _controller, _cx, options) => { renderedRows = rows; listOptions = options; return element(); } },
  "./ui-icons.js": { uiIcon: element }, "./workspace.js": { projectKey: project => project.id },
};
const context = vm.createContext({ console }), module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/editor-menu.js", import.meta.url), "utf8"), { context });
await module.link(async name => { const values = bindings[name]; return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
await module.evaluate();
const { navigationRows, editorMenuSize, openEditorMenu, EditorNavigationMenu } = module.namespace;
const locations = [{ path: '/a.ts', line: 0, col: 1 }, { path: '/a.ts', line: 2, col: 3 }, { path: '/b.ts', line: 4, col: 0, external: true }];
assert.equal(navigationRows('reference-files', locations).length, 2);
assert.match(navigationRows('reference-files', locations)[0].label, /2곳/);
assert.equal(navigationRows('locations', locations).length, 3);
assert.equal(navigationRows('locations', locations)[2].disabled, false);
assert.ok(navigationRows('actions', [], false).every(row => row.disabled));
assert.ok(editorMenuSize(100).height <= 440 && editorMenuSize(0).height > 0);
const project = { id: 'fixture' }, request = { path: '/source.ts', revision: 3, offset: 7, position: { x: 20, y: 30 } };
openEditorMenu(project, request); assert.equal(overlays[0].kind, 'popup'); assert.equal(overlays[0].at.x, 20); assert.ok(overlays[0].width > 0 && overlays[0].height > 0);
const menu = new EditorNavigationMenu(); menu.init({ context: project, request, mode: 'actions', available: true, overlay: 'owned-menu' }, {});
menu.render({}); assert.ok(renderedRows.every(row => typeof row.icon === 'function'));
assert.equal(listOptions.activateOnClick, true);
listOptions.onSelect('definition', undefined, { notify() {} }); assert.equal(saved.get('ade.editor-request'), undefined, 'arrow selection cannot activate a menu action');
listOptions.onActivate('reference-files');
const action = saved.get('ade.editor-request').fixture;
assert.equal(action.kind, 'reference-files'); assert.equal(action.path, request.path); assert.equal(action.revision, 3); assert.equal(action.offset, 7); assert.equal(closed.at(-1), 'owned-menu');
menu.release();
const externalMenu = new EditorNavigationMenu(); externalMenu.init({ context: project, request, mode: 'locations', locations, overlay: 'library-menu' }, {});
externalMenu.activate(navigationRows('locations', locations)[2].id);
assert.equal(saved.get('ade.editor-request').fixture.location.external, true, 'external provenance reaches the owning editor');
assert.equal(saved.get('ade.editor-request').fixture.location.path, '/b.ts'); externalMenu.release();
const disabled = new EditorNavigationMenu(); disabled.init({ context: project, request, mode: 'actions', available: false }, {});
const previous = saved.get('ade.editor-request'); disabled.activate('definition'); assert.equal(saved.get('ade.editor-request'), previous); disabled.release();
console.log('ADE editor menu: native popup bounds, scoped descriptors, disabled actions and navigable external rows, location grouping and icon factories passed');

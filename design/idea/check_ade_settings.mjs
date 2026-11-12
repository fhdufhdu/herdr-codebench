import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const saved = new Map(), mutations = [], overlays = [], closed = [], buttons = new Map(), tasks = [];
const element = () => { const proxy = new Proxy({}, { get: (_target, key) => key === "then" ? undefined : key === "when" ? (condition, fn) => condition ? fn(proxy) : proxy : () => proxy }); return proxy; };
class MenuController { constructor() { this.focus = { focus() {}, release() {} }; } release() {} }
const input = ({ value = "" } = {}) => ({ value: () => value, set_value: next => { value = next; }, on() {}, release() {} });
const bindings = {
  "gpui-kit": { div: element }, "gpui-base": { h_flex: element, v_flex: element, InputState: { new: input }, Input: { new: element } },
  herdr: { keys: () => [], settings: () => ({}), shared: key => saved.get(key), setShared: (key, value) => { mutations.push(key); saved.set(key, value); },
    layout: () => ({}), exec: async () => { mutations.push("exec"); return { code: 0 }; }, appHome: () => "/app", readTextFile: async () => "{}",
    writeTextFile: async () => { mutations.push("write"); }, closeOverlay: id => closed.push(id), openOverlay: spec => overlays.push(spec) },
  "./idea-design.js": { MenuController, adeUI: value => value, adeManagedList: element, adeInputBox: element, adeNote: element, adePanel: element,
    adeButton: (id, label, action) => { buttons.set(id, { label, action }); return element(); } },
  "./ui-icons.js": { uiIcon: element },
  "./frame-layout.js": { REGIONS: { project: { label: "Project", icon: "folder" } }, regionSettings: () => ({ project: { position: "left-top", order: 0, hidden: false } }), arrangeRegions: value => value, toggleRegion: value => value },
};
const context = vm.createContext({ console }), module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/settings.js", import.meta.url), "utf8"), { context });
await module.link(async name => {
  const values = bindings[name]; assert.ok(values, name);
  return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
});
await module.evaluate();
const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); } };
const view = new module.namespace.SettingsView(); view.init({ overlay: "settings", context: { id: "fixture" } }, cx); await Promise.all(tasks.splice(0));
view.inputs.font.set_value("Unsaved Font"); view.category = "database"; view.render(cx);
assert.ok(buttons.has("settings-database")); buttons.get("settings-database-manage").action({}, cx);
assert.equal(overlays.at(-1).mod, "ade"); assert.equal(overlays.at(-1).props.view, "database-manager");
assert.equal(overlays.at(-1).props.context.id, "fixture");
assert.equal(view.inputs.font.value(), "Unsaved Font"); assert.equal(mutations.length, 0, "opening global connection management does not apply settings or edit sources");
buttons.get("settings-cancel").action({}, cx); assert.equal(closed.at(-1), "settings"); assert.equal(mutations.length, 0);
view.release();
console.log("ADE settings Database category: common manager target, retained drafts, cancel boundary and no external writes passed");

// Run: node --experimental-vm-modules design/idea/check_database_ui.mjs
// Load every local module unchanged. Only native host modules and localhost HTTP are fixtures.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const store = { layout: "idea" }, calls = [], commands = [], overlays = [], scrolls = [], handles = [], inputs = [];
let respond = async method => {
  if (method === "db_sources") return { sources: [] };
  throw new Error(`Unexpected request: ${method}`);
};
let platform = "macos";
const element = type => {
  const data = { type, childNodes: [], handlers: {}, values: {} };
  const proxy = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === "when") { if (args[0]) args[1](proxy); }
      else if (key === "child" || key === "content") target.childNodes.push(args[0]);
      else if (key === "children") target.childNodes.push(...args[0]);
      else if (key === "id") target.idValue = args[0];
      else if (key.startsWith("on_")) {
        if (type === "virtual_list" && ["on_mouse_down", "on_key_down"].includes(key)) throw new Error("Native virtual lists require pointer/key handlers on a plain wrapper");
        target.handlers[key] = args.at(-1);
      }
      else target.values[key] = args[0];
      return proxy;
    };
  } });
  return proxy;
};
const pending = new Set(), timers = [];
const cx = {
  notify() {}, stop_propagation() {}, sleep: async () => {},
  focus_handle() { const state = { released: false, focuses: 0, focus() { ++this.focuses; }, is_focused: () => true, release() { this.released = true; } }; handles.push(state); return state; },
  timer: { every(_ms, action) { timers.push(action); } },
  spawn(action) { const promise = action(cx); pending.add(promise); promise.finally(() => pending.delete(promise)); },
};
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const inputType = { new() {
  const state = { text: "", events: {}, masked: false, released: false,
    value() { return this.text; }, set_value(value) { this.text = value; }, set_masked(value) { this.masked = value; },
    on(name, callback) { this.events[name] = callback; }, focus() {}, release() { this.released = true; } };
  inputs.push(state); return state;
} };
const host = {
  "gpui-kit": { div: () => element("div"), svg: () => element("svg"), PathBuilder: {} },
  "gpui-base": { h_flex: () => element("h_flex"), v_flex: () => element("v_flex"),
    Button: { new: id => element("button").id(id) },
    Select: { new: id => element("select").id(id) },
    Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) },
    InputState: inputType, Input: { new: state => element("input").input_state(state) },
    VirtualListScrollHandle: { new() { const state = { released: false, scroll_to_item(index) { this.index = index; }, release() { this.released = true; } }; scrolls.push(state); return state; } },
    Scrollbar: { vertical: () => element("scrollbar") }, HoverCard: {}, TextView: {},
    v_virtual_list(id, count, height, getKey, render) { const el = element("virtual_list"); el.id(id); el.count = count; el.getKey = getKey; el.renderRows = render; return el; },
  },
  herdr: {
    shared: name => store[name], setShared: (name, value) => { store[name] = value; }, settings: () => ({}), theme: () => ({}),
    notify() {}, playSound() {}, run: command => commands.push(command), openOverlay: spec => { overlays.push(spec); return "overlay-fixture"; }, closeOverlay() {},
    nextCommand: () => new Promise(() => {}), home: () => "/fixture", appHome: () => "/fixture/app", window: () => platform ? { platform } : null,
    readTextFile: async path => path.endsWith("manifest.json") ? JSON.stringify({ version: "fixture-v1", targets: [{ os: "darwin", arch: "arm64" }] })
      : JSON.stringify({ token: "fixture-token", port: 47822, engine: "herdr-codebench-go", pid: 123 }),
    exec: async command => ({ code: 0, stdout: command === "uname" ? "arm64" : "fixture-v1" }),
    hc: async () => ({ code: 0, stdout: JSON.stringify({ terminals: [] }) }),
  },
};
const context = vm.createContext({ console, fetch: async (url, options) => {
  const method = url.split("/").at(-1), body = JSON.parse(options.body);
  if (method === "health") return { status: 200, json: async () => ({ ok: true, result: { engine: "herdr-codebench-go", pid: 123, version: "fixture-v1" } }) };
  calls.push({ method, body });
  try { const result = await respond(method, body.database); return { status: 200, json: async () => ({ ok: true, result }) }; }
  catch (error) { return { status: 200, json: async () => ({ ok: false, error: error.message }) }; }
} });
const cache = new Map();
async function load(url) {
  if (cache.has(url)) return cache.get(url);
  if (host[url]) {
    const module = new vm.SyntheticModule(Object.keys(host[url]), function() { for (const [name, value] of Object.entries(host[url])) this.setExport(name, value); }, { context });
    cache.set(url, module); return module;
  }
  const source = await readFile(new URL(url), "utf8"), module = new vm.SourceTextModule(source, { context, identifier: url }); cache.set(url, module);
  await module.link(id => load(id.startsWith(".") ? new URL(id, url).href : id)); return module;
}
const module = await load(new URL("../../mods/codenav/database.js", import.meta.url).href); await module.evaluate();
const { Database, DatabaseManager, openDatabaseManager } = module.namespace;
const plain = value => JSON.parse(JSON.stringify(value));
const userInput = (manager, field, value) => { manager.inputs[field].set_value(value); manager.inputs[field].events.change({}, cx); };
const walk = (el, fn) => { if (!el || typeof el !== "object") return; fn(el); for (const child of el.childNodes ?? []) walk(child, fn); };
const find = (root, id) => { let found; walk(root, el => { if (el.idValue === id) found = el; }); return found; };
const selectMenu = (view, name) => {
  const control = find(view.render(cx), `db-${name}-select`);
  assert.equal(control.type, "select");
  assert.equal(control.values.track_focus, view.selectors[name].focus);
  assert.equal(control.values.content_focus_handle, view.selectors[name].menu.focus);
  const focused = view.selectors[name].menu.focus.focuses;
  control.handlers.on_open_change(true, cx);
  assert.equal(view.selectors[name].open, true);
  assert.equal(view.selectors[name].menu.focus.focuses, focused + 1, "opening gives the menu its owned focus handle");
  return find(view.render(cx), `db-${name}-options`);
};
const chooseOption = (view, name, id) => {
  const menu = selectMenu(view, name), list = find(menu, `db-${name}-options-list`);
  assert.ok(Array.from({ length: list.count }, (_, index) => list.getKey(index)).includes(id));
  const focused = view.selectors[name].focus.focuses;
  list.handlers.on_item_click(id, cx);
  assert.equal(view.selectors[name].open, false, "activation closes only the selector popup");
  assert.equal(view.selectors[name].focus.focuses, focused + 1, "closing returns focus to the selector trigger handle");
};

openDatabaseManager({ newSource: true });
assert.deepEqual(plain(overlays.at(-1)), { mod: "codenav", props: { view: "database-manager", newSource: true }, kind: "dialog", modal: true, frame: "none", width: 840, height: 680 });
const manager = new DatabaseManager(); manager.init({ newSource: true }, cx); await settle();
assert.equal(find(manager.render(cx), "db-close").childNodes[0], "Close", "Close does not imply rollback of previously saved profiles");
assert.equal(find(manager.render(cx), "db-save").childNodes[0], "Save Profile", "the primary action clearly saves only the active profile");
assert.equal(manager.inputs.password.masked, true);
assert.equal(manager.driver, "postgres"); assert.equal(manager.tls, "verify-full");
const networkIds = []; walk(manager.render(cx), el => { if (el.idValue) networkIds.push(el.idValue); });
assert.ok(networkIds.includes("db-tls-select")); assert.ok(networkIds.includes("db-driver-select"));
const networkInputs = []; walk(manager.render(cx), el => { if (el.type === "input") networkInputs.push(el.values.input_state); });
assert.ok(networkInputs.includes(manager.inputs.host) && networkInputs.includes(manager.inputs.password));
assert.ok(!networkInputs.includes(manager.inputs.path), "network forms omit the SQLite path field");
assert.ok(!networkIds.includes("db-driver-postgres"), "IDEA uses a single driver selector instead of the legacy button row");
const driversMenu = selectMenu(manager, "driver"), driversList = find(driversMenu, "db-driver-options-list");
assert.deepEqual(Array.from({ length: driversList.count }, (_, index) => driversList.getKey(index)), ["mysql", "mariadb", "postgres", "sqlserver", "sqlite"]);
const driverHandles = handles.length;
assert.equal(driversList.renderRows({ start: 0, end: driversList.count }).length, 5);
assert.equal(handles.length, driverHandles, "deferred driver options never allocate retained native handles");
assert.equal(manager.selectors.driver.menu.at, 2, "opening starts at the current driver");
driversMenu.handlers.on_key_down({ key: "escape" }, cx); assert.equal(manager.selectors.driver.open, false);
for (const tls of ["", "disable", "require", "verify-full"]) {
  chooseOption(manager, "tls", tls); assert.equal(manager.tls, tls); assert.equal(manager.draft().tls, tls);
}
const tlsMenu = selectMenu(manager, "tls");
tlsMenu.handlers.on_key_down({ key: "home" }, cx); tlsMenu.handlers.on_key_down({ key: "down" }, cx); tlsMenu.handlers.on_key_down({ key: "enter" }, cx);
assert.equal(manager.tls, "disable", "selector keyboard navigation applies the selected TLS value");
chooseOption(manager, "tls", "verify-full");
userInput(manager, "name", "Fixture profile"); userInput(manager, "host", "db.invalid"); userInput(manager, "password", "synthetic-password");
respond = async (method, database) => {
  assert.equal(method, "db_save");
  assert.equal(database.source.password, "synthetic-password");
  return { ...database.source, id: "source-one", has_password: true, password_storage: "keychain" };
};
manager.perform("db_save", cx); await settle();
assert.equal(calls.at(-1).method, "db_save", "saving metadata never requires a test");
assert.equal(manager.selected.id, "source-one"); assert.equal(manager.selected.password, undefined, "even an unexpected engine credential is stripped");
assert.equal(manager.inputs.password.value(), ""); assert.equal(manager.draft().password, undefined, "unchanged empty password preserves engine session secret");
assert.equal(manager.selected.password_storage, "keychain");
assert.match(manager.passwordDescription(), /Keychain/);
userInput(manager, "password", "replacement"); userInput(manager, "password", "");
assert.equal(Object.hasOwn(manager.draft(true), "password"), false, "typing then erasing still preserves the saved credential");
manager.clearPassword(cx);
assert.equal(manager.draft(true).password, "", "explicit clear is staged for Save");
assert.equal(Object.hasOwn(manager.draft(false), "password"), false, "Test does not apply staged deletion");
assert.match(manager.passwordDescription(), /removed/);
respond = async (method, database) => {
  assert.equal(method, "db_save"); assert.equal(database.source.password, "");
  return { ...database.source, id: "source-one", has_password: false, password_storage: "none" };
};
manager.perform("db_save", cx); await settle();
assert.equal(manager.passwordCleared, false); assert.equal(manager.selected.has_password, false);
assert.match(manager.passwordDescription(), /Keychain/);
platform = "linux"; assert.match(manager.passwordDescription(), /session only/);
platform = null; assert.doesNotThrow(() => manager.render(cx), "headless native checks have no window");
platform = "macos";
assert.equal(Object.values(store).some(value => JSON.stringify(value).includes("synthetic-password")), false);
assert.match(manager.status, /saved/);
userInput(manager, "path", "/tmp/fixture.sqlite");
for (const [driver, port] of [["mysql", 3306], ["mariadb", 3306], ["postgres", 5432], ["sqlserver", 1433], ["sqlite", 0]]) {
  chooseOption(manager, "driver", driver); assert.equal(manager.driver, driver);
  if (port) assert.equal(manager.inputs.port.value(), String(port));
  respond = async (method, database) => {
    assert.equal(method, "db_test"); assert.equal(database.source.driver, driver);
    if (driver === "sqlite") {
      assert.equal(database.source.path, "/tmp/fixture.sqlite");
      for (const field of ["host", "port", "user", "password", "database", "tls"]) assert.equal(Object.hasOwn(database.source, field), false, `SQLite omits network field ${field}`);
    } else {
      assert.equal(database.source.host, "db.invalid"); assert.equal(database.source.port, port);
      assert.equal(database.source.tls, "verify-full"); assert.equal(Object.hasOwn(database.source, "path"), false);
    }
    return { connected: true };
  };
  manager.perform("db_test", cx); await settle(); assert.match(manager.status, /successful/);
}
userInput(manager, "path", "/tmp/fixture.sqlite");
assert.deepEqual(plain(manager.draft()), { id: "source-one", name: "Fixture profile", driver: "sqlite", path: "/tmp/fixture.sqlite" });
let renderedIds = [];
walk(manager.render(cx), el => { if (el.idValue) renderedIds.push(el.idValue); });
assert.ok(renderedIds.includes("db-source-fields"));
assert.ok(!renderedIds.includes("db-tls-select"), "SQLite hides the TLS selector");
const sqliteInputs = []; walk(manager.render(cx), el => { if (el.type === "input") sqliteInputs.push(el.values.input_state); });
assert.ok(sqliteInputs.includes(manager.inputs.path)); assert.ok(!sqliteInputs.includes(manager.inputs.host) && !sqliteInputs.includes(manager.inputs.password));
userInput(manager, "path", ""); const beforeMissingPath = calls.length; manager.perform("db_test", cx);
assert.match(manager.error, /SQLite.*path/i); assert.equal(calls.length, beforeMissingPath);
userInput(manager, "path", "/tmp/fixture.sqlite");
const delayedTest = deferred(); respond = async method => { assert.equal(method, "db_test"); return delayedTest.promise; };
manager.perform("db_test", cx); await settle();
let busyView = manager.render(cx);
assert.equal(find(busyView, "db-driver").values.disabled, true);
find(busyView, "db-driver-select").handlers.on_open_change(true, cx);
assert.equal(manager.selectors.driver.open, false, "busy connection testing cannot open another driver selector");
userInput(manager, "path", "/tmp/changed.sqlite"); delayedTest.resolve({ connected: true }); await settle();
assert.equal(manager.status, null, "editing a tested draft discards its old success");
respond = async method => { assert.equal(method, "db_delete"); return { deleted: true }; };
manager.perform("db_delete", cx); assert.equal(manager.deleteArmed, true);
chooseOption(manager, "driver", "mysql"); assert.equal(manager.deleteArmed, false, "changing the driver invalidates an armed Delete confirmation");
manager.perform("db_delete", cx); assert.equal(manager.deleteArmed, true);
chooseOption(manager, "tls", "require"); assert.equal(manager.deleteArmed, false, "changing TLS invalidates an armed Delete confirmation");
// codebench keeps its supported button controls and the same confirmation rule.
store.layout = "codebench";
let legacyView = manager.render(cx);
for (const driver of ["mysql", "mariadb", "postgres", "sqlserver", "sqlite"]) assert.ok(find(legacyView, `db-driver-${driver}`));
for (const tls of ["default", "disable", "require", "verify-full"]) assert.ok(find(legacyView, `db-tls-${tls}`));
manager.perform("db_delete", cx); find(legacyView, "db-tls-verify-full").handlers.on_click({}, cx);
assert.equal(manager.deleteArmed, false);
store.layout = "idea";
const beforeDelete = calls.length; manager.perform("db_delete", cx); assert.equal(calls.length, beforeDelete); assert.equal(manager.deleteArmed, true);
manager.perform("db_delete", cx); await settle(); assert.equal(manager.sources.length, 0); assert.equal(manager.selected, null);
manager.release(); assert.equal(manager.inputs.password.released, true);

// Profile switching retains native drafts, while Save still owns one profile.
const profileA = { id: "profile-a", name: "Profile A", driver: "postgres", host: "db.invalid", port: 5432, user: "fixture", database: "a", tls: "require", has_password: true, password_storage: "keychain" };
const profileB = { id: "profile-b", name: "Profile B", driver: "mysql", host: "db.invalid", port: 3306, user: "fixture", database: "b", tls: "disable" };
const loadingSources = deferred(); respond = async method => { assert.equal(method, "db_sources"); return loadingSources.promise; };
const lifecycle = new DatabaseManager(); lifecycle.init({ source_id: profileA.id, overlay: "lifecycle" }, cx); await settle();
userInput(lifecycle, "name", "Typed while loading");
loadingSources.resolve({ sources: [{ ...profileA, password: "should-be-stripped" }, profileB] }); await settle();
assert.equal(lifecycle.inputs.name.value(), "Typed while loading", "late source loading never overwrites a newer input draft");
assert.equal(lifecycle.selected, null); assert.equal(lifecycle.sources[0].password, undefined);
lifecycle.edit(profileA, cx);
lifecycle.inputs.host.events.focus({}, cx); assert.equal(lifecycle.focusedField, "host");
lifecycle.inputs.host.events.blur({}, cx); assert.equal(lifecycle.focusedField, null);
lifecycle.clearPassword(cx);
respond = async (method, database) => { assert.equal(method, "db_test"); assert.equal(Object.hasOwn(database.source, "password"), false, "Test never applies a staged Keychain deletion"); return { connected: true }; };
lifecycle.perform("db_test", cx); await settle(); assert.equal(lifecycle.passwordCleared, true);
userInput(lifecycle, "password", "unsaved-new-secret"); lifecycle.duplicate(cx);
assert.equal(lifecycle.selected, null); assert.match(lifecycle.inputs.name.value(), /Profile A.*Copy/);
assert.equal(lifecycle.inputs.password.value(), ""); assert.equal(Object.hasOwn(lifecycle.draft(), "password"), false, "Duplicate copies metadata, never another profile's password");
lifecycle.edit(profileA, cx); userInput(lifecycle, "name", "Unsaved A");
const beforeSwitch = calls.length;
find(lifecycle.render(cx), "db-manager-sources-list").handlers.on_item_click(profileB.id, cx);
assert.equal(lifecycle.selected.id, profileB.id); assert.equal(lifecycle.inputs.name.value(), "Profile B");
assert.equal(calls.length, beforeSwitch, "current profile selection replaces local fields without implicitly saving");
lifecycle.edit(profileA, cx);
assert.equal(lifecycle.inputs.name.value(), "Unsaved A", "switching back restores the profile's unsaved native input draft");
assert.equal(lifecycle.inputs.password.value(), "unsaved-new-secret", "password drafts remain only in the profile's native input state");
lifecycle.clearPassword(cx);
lifecycle.edit(profileB, cx); lifecycle.edit(profileA, cx);
assert.equal(lifecycle.passwordCleared, true, "explicit saved-password removal stays scoped to its profile across switching");
assert.equal(lifecycle.draft(true).password, "");
lifecycle.edit(profileB, cx);
assert.equal(lifecycle.passwordCleared, false, "another profile never inherits a password-removal draft");
userInput(lifecycle, "port", "0"); const beforeInvalid = calls.length; lifecycle.perform("db_test", cx);
assert.match(lifecycle.error, /port/i); assert.equal(calls.length, beforeInvalid);
userInput(lifecycle, "port", "3306"); userInput(lifecycle, "host", ""); lifecycle.perform("db_save", cx);
assert.match(lifecycle.error, /host/i); assert.equal(calls.length, beforeInvalid);
userInput(lifecycle, "host", "db.invalid"); userInput(lifecycle, "name", "Saving B");
const saving = deferred(); respond = async (method, database) => { assert.equal(method, "db_save"); assert.equal(database.source.name, "Saving B"); return saving.promise; };
lifecycle.perform("db_save", cx); await settle();
find(lifecycle.render(cx), "db-manager-sources-list").handlers.on_item_click(profileA.id, cx);
assert.equal(lifecycle.selected.id, profileB.id, "busy source rows cannot switch profiles");
userInput(lifecycle, "name", "Newer B");
saving.resolve({ ...profileB, name: "Saving B", password: "unexpected-engine-secret" }); await settle();
assert.equal(lifecycle.inputs.name.value(), "Newer B", "a Save reply never overwrites input typed after submission");
assert.equal(lifecycle.selected.name, "Saving B"); assert.equal(lifecycle.selected.password, undefined);
respond = async method => { assert.equal(method, "db_save"); return {}; };
lifecycle.perform("db_save", cx); await settle(); assert.match(lifecycle.error, /invalid data source/i);
const lateSave = deferred(); respond = async method => { assert.equal(method, "db_save"); return lateSave.promise; };
lifecycle.perform("db_save", cx); await settle(); lifecycle.release();
lateSave.resolve({ ...profileB, name: "Late closed reply" }); await settle();
assert.equal(lifecycle.selected.name, "Saving B", "a closed manager ignores late replies");
assert.equal(lifecycle.inputs.password.text, "", "closing clears the native password state before release");
for (const secret of ["unsaved-new-secret", "unexpected-engine-secret", "should-be-stripped"]) assert.ok(!JSON.stringify(store).includes(secret), "native profile inputs/replies never publish credentials to shared state");

const source = { id: "a", name: "Global fixture", driver: "sqlite", path: "/tmp/fixture.sqlite" };
respond = async method => { assert.equal(method, "db_sources"); return { sources: [source] }; };
const tree = new Database(); tree.init({}, cx); await settle();
assert.equal(calls.at(-1).method, "db_sources"); assert.deepEqual(plain(calls.at(-1).body), { database: {} });
assert.equal(tree.sources.length, 1);
respond = async (method, database) => {
  assert.equal(method, "db_catalog"); assert.equal(database.source_id, "a");
  if (!database.database) return { nodes: [{ kind: "database", name: "main" }] };
  if (!database.schema) return { nodes: [{ kind: "schema", name: "public" }] };
  if (!database.table) return { nodes: [{ kind: "table", name: "people" }, { kind: "view", name: "active_people" }] };
  return { nodes: [{ kind: "column", name: "id", data_type: "INTEGER", primary_key: true }] };
};
tree.toggle(tree.rows()[0], cx); await settle(); assert.equal(tree.rows().length, 2);
tree.toggle(tree.rows()[1], cx); await settle(); tree.toggle(tree.rows()[2], cx); await settle();
assert.deepEqual(plain(tree.rows().filter(row => row.kind === "group").map(row => [row.name, row.count])), [["Tables", 1], ["Views", 1]]);
assert.equal(tree.rows().some(row => row.kind === "view"), false, "views start collapsed without requesting another catalog");
tree.toggle(tree.rows().find(row => row.kind === "group" && row.name === "Views"), cx);
tree.toggle(tree.rows().find(row => row.kind === "table"), cx); await settle();
assert.deepEqual(plain(tree.rows().map(row => row.kind)), ["source", "database", "schema", "group", "table", "column", "group", "view"]);
const tableRow = tree.rows().find(row => row.kind === "table"), viewRow = tree.rows().find(row => row.kind === "view"), columnRow = tree.rows().find(row => row.kind === "column");
assert.deepEqual(plain(calls.at(-1).body.database), { source_id: "a", database: "main", schema: "public", table: "people" });
let nativeList, treeFrame; walk(tree.render(cx), el => { if (el.type === "virtual_list") nativeList = el; if (el.idValue === "database-tree-frame") treeFrame = el; });
tree.select(tableRow, {}, cx);
find(tree.render(cx), "database-console").handlers.on_click({}, cx);
assert.deepEqual(JSON.parse(commands.at(-1).split("codenav.database-open:")[1]), { source_id: "a", kind: "console", database: "main", schema: "public" }, "visible SQL Console uses the selected object's owning context");
const handlesBeforeRows = handles.length;
assert.equal(nativeList.renderRows({ start: 0, end: nativeList.count }).length, 8);
assert.equal(handles.length, handlesBeforeRows, "deferred rows never allocate retained native handles");
assert.notEqual(treeFrame.type, "virtual_list");
assert.equal(nativeList.handlers.on_mouse_down, undefined); assert.equal(nativeList.handlers.on_key_down, undefined);
assert.equal(typeof treeFrame.handlers.on_key_down, "function");
treeFrame.handlers.on_mouse_down({ click_count: 1, modifiers: { platform: true } });
const beforeModifierClick = commands.length;
nativeList.handlers.on_item_click(tableRow.key, cx);
assert.equal(tree.selection.size, 0, "virtual rows receive pointer modifiers through the plain wrapper press handler");
assert.equal(commands.length, beforeModifierClick, "modifier selection never opens data");
treeFrame.handlers.on_mouse_down({ click_count: 1, modifiers: {}, local_position: { x: tableRow.depth * 14 + 10, y: 0 } });
nativeList.handlers.on_item_click(tableRow.key, cx);
assert.equal(tree.expanded.has(tableRow.key), false, "disclosure hit collapses columns independently of opening data");
assert.equal(commands.length, beforeModifierClick);
treeFrame.handlers.on_mouse_down({ click_count: 1, modifiers: {}, local_position: { x: tableRow.depth * 14 + 50, y: 0 } });
nativeList.handlers.on_item_click(tableRow.key, cx);
assert.equal(commands.length, beforeModifierClick + 1, "a plain table-label click opens the data tab");
assert.equal(tree.expanded.has(tableRow.key), false, "opening data does not also expand columns");
tree.toggle(tableRow, cx);
treeFrame.handlers.on_mouse_down({ click_count: 2, modifiers: {} });
nativeList.handlers.on_item_click(tableRow.key, cx);
assert.equal(JSON.parse(commands.at(-1).split("codenav.database-open:")[1]).kind, "table", "table double-click dispatches data opening");
tree.select(tree.rows()[1], {}, cx); tree.select(tableRow, { modifiers: { platform: true } }, cx); assert.equal(tree.selection.size, 2);
tree.select(viewRow, { modifiers: { shift: true } }, cx); assert.equal(tree.selection.size, 4);
tree.key({ key: "home", modifiers: {} }, cx); assert.equal(tree.current, tree.rows()[0].key);
tree.key({ key: "end", modifiers: { shift: true } }, cx); assert.equal(tree.selection.size, 8); assert.equal(tree.menu.scroll.index, 7);
tree.activate(tableRow, cx);
assert.deepEqual(JSON.parse(commands.at(-1).split("codenav.database-open:")[1]), { source_id: "a", kind: "table", database: "main", schema: "public", table: "people" });
tree.select(tableRow, {}, cx);
tree.key({ key: "down", modifiers: { platform: true } }, cx);
assert.equal(JSON.parse(commands.at(-1).split("codenav.database-open:")[1]).table, "people", "Cmd+Down opens the selected table like double-click");
tree.selection = new Set([tree.rows()[1].key, tableRow.key, columnRow.key]);
tree.contextMenu(tableRow, { position: { x: 10, y: 20 } }, cx);
const snapshot = overlays.at(-1).props;
tree.selection.clear();
const menu = new Database(); menu.init(snapshot, cx); menu.menuRows().find(row => row.id === "ddl").action();
const ddl = JSON.parse(commands.at(-1).split("codenav.database-open:")[1]);
assert.equal(ddl.objects.length, 3, "mixed hierarchy DDL uses its opening selection snapshot"); assert.equal(ddl.objects[0].kind, "database");
assert.equal(ddl.objects[2].kind, "table", "column selection requests its owning table definition");
menu.render(cx); menu.release();

// Refresh invalidates in-flight catalog replies even when the profile id is reused.
tree.children.clear(); tree.expanded.clear(); const stale = deferred();
respond = async method => method === "db_catalog" ? stale.promise : { sources: [{ ...source, name: "Changed profile" }] };
tree.toggle(tree.rows()[0], cx); await settle(); tree.refresh(cx); await settle(); stale.resolve({ nodes: [{ kind: "table", name: "stale" }] }); await settle();
assert.equal(tree.rows().some(row => row.name === "stale"), false);
const errors = deferred(); respond = async () => errors.promise;
tree.refresh(cx); await settle(); tree.release(); errors.resolve({ sources: [] }); await settle();
assert.equal(tree.sources[0].name, "Changed profile", "closed views ignore late replies");
assert.ok(handles.every(handle => handle.released)); assert.ok(scrolls.every(scroll => scroll.released));
assert.ok(inputs.every(input => input.released));
assert.ok(inputs.filter(input => input.masked).every(input => input.text === ""), "closing clears all native password bundles, including replaced drafts");
console.log("PASS database Select/Popup five-driver/TLS keyboard state, SQLite/network API and visibility, password deletion/masking, profile/input/save/close lifetimes, legacy controls, lazy catalog/DDL/navigation and handle cleanup");

// Run: node --experimental-vm-modules design/idea/check_database_editor.mjs
// All repository modules execute unchanged; only native host APIs and HTTP are fixtures.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const store = { layout: "idea" }, calls = [], commands = [], overlays = [], writes = [], notices = [], commandReaders = [];
const files = new Map(), states = [], taskErrors = [], timers = [], bindings = [];
let activeSpace = "one", clipboard = "", responder, terminalResponder;
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const element = type => {
  const data = { type, nodes: [], handlers: {}, styles: {} };
  const el = new Proxy(data, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      if (name === "when") { if (args[0]) args[1](el); }
      else if (name === "child") target.nodes.push(args[0]);
      else if (name === "children") target.nodes.push(...args[0]);
      else if (name === "id") target.idValue = args[0];
      else if (name.startsWith("on_")) { target.handlers[name] = args.at(-1); if (typeof args[0] === "string") target.handlers[`${name}:${args[0]}`] = args.at(-1); }
      else target.styles[name] = args;
      return el;
    };
  } }); return el;
};
const nativeState = { new(options = {}) {
  const state = { text: options.value || "", events: {}, released: false,
    value() { if (this.released) throw new Error("Read released native state"); return this.text; },
    set_value(value) { if (this.released) throw new Error("Write released native state"); this.text = value; },
    on(event, action) { this.events[event] = action; }, focus() {}, set_masked() {}, set_auto_grow() {}, set_rows() {}, set_soft_wrap() {},
    commit(text) { this.text = text; this.events.change({}, cx); }, release() { this.released = true; } };
  states.push(state); return state;
} };
const cx = { notify() {}, stop_propagation() {}, propagate() {}, sleep: async () => {}, bind_keys(list) { bindings.push(...list); },
  write_to_clipboard(value) { clipboard = value; },
  focus_handle: () => ({ focus() {}, is_focused: () => true, release() {} }),
  timer: { after(_ms, action) { timers.push(action); }, every() {} },
  spawn(action) { Promise.resolve().then(() => action(cx)).catch(error => taskErrors.push(error)); },
};
const flushTimers = async () => { while (timers.length) timers.shift()(cx); await settle(); };
const walk = (el, fn) => { if (!el || typeof el !== "object") return; fn(el); for (const child of el.nodes ?? []) walk(child, fn); };
const nativeNode = (root, id) => { let found; walk(root, el => { if (el.idValue === id) found = el; }); assert.ok(found, `Missing native node ${id}`); return found; };
const keySurface = root => { let found; walk(root, el => { if (!found && el.handlers?.on_key_down) found = el; }); assert.ok(found); return found; };

let tree = { id: "root", type: "row", children: [
  { id: "editor-area", type: "column", size: { weight: 3 }, hidden: true, children: [
    { id: "editor-tabs", type: "block", hidden: false, size: { px: 32 } },
    { id: "editor-stack", type: "stack", active: "editor-code", children: [
      { id: "editor-code", type: "block", content: { mod: "codenav", props: { view: "code" } } },
      { id: "editor-text", type: "block", content: { mod: "activity", props: { view: "editor" } } },
    ] },
  ] },
  { id: "terminal-fixture", type: "block", size: { weight: 2 }, content: { terminal: "fixture-terminal" } },
] };
const layoutNode = (id, node = tree) => node.id === id ? node : (node.children ?? []).map(child => layoutNode(id, child)).find(Boolean);
const run = (name, args) => {
  commands.push([name, args]);
  if (name === "layout.set") throw new Error("Native host layout arguments exceed 16 levels");
  else if (name === "layout.show") layoutNode(args.id).hidden = false;
  else if (name === "layout.select") layoutNode(args.stack).active = args.child;
};
const hostValues = {
  div: () => element("div"), svg: () => element("svg"), image: () => element("image"), PathBuilder: {}, View: class {},
  h_flex: () => element("h_flex"), v_flex: () => element("v_flex"), InputState: nativeState, EditorState: nativeState, TextareaState: nativeState,
  Button: { new: id => element("button").id(id) },
  Select: { new: id => element("select").id(id) }, Popup: { new: (id, trigger) => element("popup").id(id).child(trigger) },
  Input: { new: () => element("input") }, Editor: { new: () => element("editor") }, Textarea: { new: () => element("textarea") },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) }, Scrollbar: { vertical: () => element("scrollbar") },
  v_virtual_list: () => element("virtual_list"),
  shared: name => store[name], setShared: (name, value) => { store[name] = value; }, settings: () => ({}), theme: () => ({}), keys: () => [],
  focused: () => ({ space: activeSpace, tab: activeSpace + "-tab", pane: null }), spaces: () => ["one", "two"].map(id => ({ id, active: id === activeSpace, tabs: [{ id: id + "-tab" }] })),
  panes: () => [], layout: () => tree, run, notify: value => notices.push(value), playSound() {},
  nextCommand: () => new Promise(resolve => commandReaders.push(resolve)), openOverlay: spec => { overlays.push(spec); return "fixture-overlay"; }, closeOverlay() {},
  home: () => "/fixture", appHome: () => "/fixture/app", window: () => ({ platform: "macos" }),
  readTextFile: async path => {
    if (files.has(path)) return await files.get(path);
    if (path.endsWith("manifest.json")) return JSON.stringify({ version: "fixture-v1", targets: [{ os: "darwin", arch: "arm64" }] });
    if (path.endsWith("engine.json")) return JSON.stringify({ token: "fixture-token", port: 47822, engine: "herdr-codebench-go", pid: 123 });
    return null;
  },
  writeTextFile: async (path, text, expected) => {
    assert.ok(expected === null || typeof expected === "string", "native writes require an explicit snapshot");
    if ((files.get(path) ?? null) !== expected) throw new Error("File changed since it was read");
    writes.push({ path, text, expected }); files.set(path, text);
  },
  exec: async (command, args) => {
    if (command === "herdr-app") {
      assert.deepEqual(plain(args.slice(0, 2)), ["do", "layout.set"]);
      const payload = JSON.parse(args[2]); tree = plain(payload.layout); commands.push(["layout.set", payload]);
    }
    return { code: 0, stdout: command === "uname" ? "arm64" : "fixture-v1" };
  }, hc: async args => terminalResponder ? terminalResponder(args) : ({ code: 0, stdout: '{"terminals":[]}' }),
};
const context = vm.createContext({ console, fetch: async (url, options) => {
  const method = url.split("/").at(-1), body = JSON.parse(options.body);
  if (method === "health") return { status: 200, json: async () => ({ ok: true, result: { engine: "herdr-codebench-go", pid: 123, version: "fixture-v1" } }) };
  if (method === "tokens") return { status: 200, json: async () => ({ ok: true, result: [] }) };
  calls.push({ method, body });
  try { const result = await responder(method, body.database); return { status: 200, json: async () => ({ ok: true, result }) }; }
  catch (error) { return { status: 200, json: async () => ({ ok: false, error: error.message }) }; }
} });

// Pre-create the entire local import graph so V8 links repository cycles itself.
const modules = new Map(), externals = new Map();
async function collect(url) {
  if (modules.has(url)) return;
  const source = await readFile(new URL(url), "utf8");
  modules.set(url, new vm.SourceTextModule(source, { context, identifier: url }));
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g)) {
    const [_, names, id] = match;
    if (id.startsWith(".")) await collect(new URL(id, url).href);
    else {
      if (!externals.has(id)) externals.set(id, new Set());
      const list = names.match(/\{([^}]+)\}/)?.[1] || "";
      for (const name of list.split(",").map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) externals.get(id).add(name);
    }
  }
}
const entry = new URL("../../mods/codenav/database-editor.js", import.meta.url).href;
await collect(entry);
for (const [id, names] of externals) modules.set(id, new vm.SyntheticModule([...names], function() { for (const name of names) this.setExport(name, hostValues[name] ?? (() => {})); }, { context }));
await modules.get(entry).link((id, ref) => modules.get(id.startsWith(".") ? new URL(id, ref.identifier).href : id));
await modules.get(entry).evaluate();
const { DatabaseEditor, DatabaseQueryMenu, DatabaseTransfer, RunResults, openDatabaseDocument } = modules.get(entry).namespace;
const failures = [];
async function check(name, action) { try { await action(); console.log(`PASS ${name}`); } catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.message}`); } }
const result = { columns: [{ name: "id" }, { name: "name" }, { name: "enabled" }], rows: [[1, "Ada", true], [2, null, false]], primary_keys: ["id"], limit: 200, offset: 0 };
const defaultResponder = async method => {
  if (method === "db_sources") return { sources: [{ id: "fixture", name: "Fixture", driver: "sqlite" }] };
  if (method === "db_rows") return plain(result);
  throw new Error(`Unexpected ${method}`);
};
responder = defaultResponder;
store["codenav.databaseState"] = {
  stale: { layout: "idea", documents: { "db://old": { dirty: true, busy: true } } },
  otherLayout: { layout: "codebench", documents: {} },
};
const editor = new DatabaseEditor(); editor.init({}, cx); await settle();
const show = async (kind, table) => { await openDatabaseDocument({ source_id: "fixture", kind, database: "main", schema: "public", table }); editor.sync(cx); await flushTimers(); return editor.doc; };
const typeSQL = (text, owner = editor) => {
  owner.viewer.setDocument(owner.doc, cx);
  owner.viewer.inputCommand("select-all", cx);
  if (text) owner.viewer.input.state.commit(text);
  else owner.viewer.inputCommand("delete-backward", cx);
};

await check("one command consumer owns database actions", async () => { assert.equal(commandReaders.length, 1); });
await check("database metadata init removes restored owners only from its own layout", async () => {
  assert.equal(store["codenav.databaseState"].stale, undefined);
  assert.ok(store["codenav.databaseState"].otherLayout);
});
await check("database document identity and workspace storage", async () => {
  const originalChildren = plain(layoutNode("editor-stack").children), originalTerminal = plain(layoutNode("terminal-fixture")), originalSize = plain(layoutNode("editor-area").size);
  const doc = await show("table", "people"); assert.equal(doc.spec.table, "people"); assert.equal(doc.result.rows[0][1], "Ada");
  assert.ok(commands.some(([name, args]) => name === "layout.show" && args.id === "editor-area"));
  assert.deepEqual(plain(layoutNode("editor-stack").children.slice(0, 2)), originalChildren, "adding the database view preserves existing editor children and order");
  assert.deepEqual(plain(layoutNode("terminal-fixture")), originalTerminal); assert.deepEqual(plain(layoutNode("editor-area").size), originalSize);
  assert.equal(layoutNode("editor-stack").active, "editor-database");
  assert.deepEqual(plain(layoutNode("editor-database")), { id: "editor-database", type: "block", content: { mod: "codenav", props: { view: "database-editor" } } });
  const layoutChanges = commands.filter(([name]) => name === "layout.set").length;
  await openDatabaseDocument({ source_id: "fixture", kind: "table", database: "main", schema: "public", table: "people" });
  assert.equal(commands.filter(([name]) => name === "layout.set").length, layoutChanges, "opening another database document does not repeat the layout migration");
  assert.equal(layoutNode("editor-stack").children.filter(child => child.id === "editor-database").length, 1);
  activeSpace = "two"; await openDatabaseDocument({ source_id: "other", kind: "console" });
  assert.equal(store["activity.editor"]["@area:one"].database.source_id, "fixture"); assert.equal(store["activity.editor"]["@area:two"].database.source_id, "other"); activeSpace = "one";
});
await check("source viewer routing never loads a database document as a file", async () => {
  const CodeView = modules.get(new URL("./code.js", entry).href).namespace.default, sourceView = new CodeView();
  sourceView.shown = { kind: "file", path: "/fixture/prior.sql" }; sourceView.lines = ["previous text"]; sourceView.loading = true; sourceView.seq = 3; sourceView.watched = "/fixture/prior.sql";
  const timerCount = timers.length; sourceView.sync(cx);
  assert.equal(sourceView.shown, null); assert.equal(sourceView.lines.length, 0); assert.equal(sourceView.loading, false); assert.equal(sourceView.watched, null);
  assert.equal(sourceView.seq, 4); assert.equal(timers.length, timerCount, "a database spec cannot enqueue a source-file load");
});
await check("query picker retains exact selected SQL and nested choices", async () => {
  const doc = await show("console"); doc.text = "SELECT * FROM (SELECT id FROM people) p;\nSELECT 2;"; editor.viewer.setDocument(doc, cx); await settle();
  editor.viewer.selection = { a: { line: 0, col: 15 }, b: { line: 0, col: 36 } }; editor.chooseQuery(cx);
  assert.equal(overlays.at(-1).props.candidates[0].text, "SELECT id FROM people");
  editor.viewer.selection = null; editor.viewer.sel = { line: 0, col: 25 }; editor.chooseQuery(cx);
  assert.ok(overlays.at(-1).props.candidates.some(candidate => candidate.label === "Nested SELECT"));
  assert.ok(overlays.at(-1).props.candidates.some(candidate => candidate.label === "Entire script"));
  const menu = new DatabaseQueryMenu(); menu.init({ ...overlays.at(-1).props, overlay: "fixture" }, cx);
  const beforeChoice = commands.length, rendered = menu.render(cx);
  assert.equal(menu.preview.value(), "SELECT id FROM people", "initial preview retains exact current SQL");
  keySurface(rendered).handlers.on_key_down({ key: "down", keystroke: "down" }, cx);
  assert.equal(commands.length, beforeChoice, "choosing a range does not execute it");
  keySurface(menu.render(cx)).handlers.on_key_down({ key: "up", keystroke: "up" }, cx);
  assert.equal(menu.preview.value(), "SELECT id FROM people", "keyboard selection updates the exact SQL preview");
  nativeNode(menu.render(cx), "db-query-execute").handlers.on_click({}, cx);
  assert.equal(JSON.parse(commands.at(-1)[0].slice("codenav.database-execute:".length)).sql, "SELECT id FROM people");
  nativeNode(menu.render(cx), "db-query-execute").handlers.on_click?.({}, cx);
  assert.equal(commands.length, beforeChoice + 1, "repeated confirmation cannot submit twice"); menu.release();
});
await check("native missing-file reads and compare-and-swap console saves", async () => {
  const doc = editor.doc;
  assert.equal(doc.diskText, null); assert.ok(typeof doc.text === "string");
  doc.text = "SELECT 10;"; doc.textDirty = true; editor.saveDraft(cx); await settle();
  assert.deepEqual(writes.at(-1), { path: doc.draftPath, text: "SELECT 10;", expected: null });
  doc.text = "SELECT 20;"; editor.saveDraft(cx); await settle(); assert.equal(writes.at(-1).expected, "SELECT 10;");
  files.set(doc.draftPath, "external change"); const count = writes.length;
  doc.text = "SELECT 30;"; doc.textDirty = true; editor.saveDraft(cx); await settle();
  assert.equal(writes.length, count); assert.equal(files.get(doc.draftPath), "external change"); assert.equal(doc.textDirty, true);
  assert.match(store["codenav.notifications"][0].body, /File changed/);
});
await check("query execution sends only approved statements, polls and cancels", async () => {
  const doc = editor.doc; let polls = 0;
  responder = async (method, data) => {
    if (method === "db_query") { assert.deepEqual(plain(data.statements), ["SELECT ';'", "SELECT 2"]); return { job_id: "job-one" }; }
    if (method === "db_job") return ++polls === 1 ? { id: "job-one", state: "running", current: 1, total: 2, results: [] } : { id: "job-one", state: "completed", current: 2, total: 2, results: [plain(result)] };
    if (method === "db_cancel") { assert.equal(data.job_id, "job-one"); return { id: "job-one", state: "cancelled", results: [] }; }
    return defaultResponder(method, data);
  };
  editor.execute("SELECT ';'; SELECT 2;", cx); assert.equal(doc.job.state, "queued"); await settle(); assert.equal(doc.job.state, "completed"); assert.equal(doc.result.rows.length, 2);
  editor.cancel(cx); await settle(); assert.equal(doc.job.state, "cancelled");
});
await check("resolved DELIMITER routine executes as one statement", async () => {
  const doc = editor.doc, driver = doc.source.driver;
  const routine = "CREATE PROCEDURE example()\nBEGIN\n SELECT 1;\n SELECT 2;\nEND";
  doc.source.driver = "mysql"; doc.text = `DELIMITER $$\n${routine}$$\nDELIMITER ;`;
  responder = async (method, data) => {
    if (method === "db_query") { assert.deepEqual(plain(data.statements), [routine]); return { job_id: "routine" }; }
    if (method === "db_job") return { id: "routine", state: "completed", results: [] };
    return defaultResponder(method, data);
  };
  editor.execute(routine, cx); await settle(); assert.equal(doc.job.state, "completed");
  const before = calls.length; doc.text = "SELECT 1;";
  editor.execute(routine, cx); await settle(); assert.equal(calls.length, before, "unresolved routine bodies cannot run as fragments");
  assert.match(store["codenav.notifications"][0].body, /DELIMITER/); doc.source.driver = driver;
});
await check("typed edits retain original values, explicit NULL and apply conflicts", async () => {
  responder = defaultResponder; const doc = await show("table", "people");
  editor.editCell(0, 1, cx); editor.setCell(null, cx); assert.equal(doc.changes.get(0).values.name, null);
  editor.editCell(0, 1, cx); assert.equal(editor.cell.value(), "", "reopening a staged NULL must not restore original Ada"); editor.setCell(null, cx);
  editor.selectRow(1, { modifiers: {} }, cx); editor.deleteRows(cx);
  responder = async (method, data) => {
    if (method === "db_apply") { assert.equal(data.changes[0].values.name, null); assert.equal(data.changes[0].original.id, 1); assert.equal(data.changes[0].original.enabled, true); assert.equal(data.changes[1].op, "delete"); throw new Error("row changed by another writer"); }
    return defaultResponder(method, data);
  };
  editor.apply(cx); await settle(); assert.equal(doc.changes.size, 2); assert.match(doc.error, /another writer/);
  responder = async (method, data) => method === "db_apply" ? { affected_rows: data.changes.length } : defaultResponder(method, data);
  editor.apply(cx); await settle(); assert.equal(doc.changes.size, 0); assert.equal(doc.applying, false);
});
await check("slow Apply commits the open cell and blocks every mutation until completion", async () => {
  responder = defaultResponder; const doc = editor.doc;
  editor.editCell(0, 1, cx); editor.cell.set_value("Reviewed");
  const pending = deferred(); let submitted;
  responder = async (method, data) => {
    if (method === "db_apply") { submitted = data.changes; return pending.promise; }
    return defaultResponder(method, data);
  };
  editor.apply(cx); await settle();
  assert.equal(editor.editingCell, null); assert.equal(doc.applying, true);
  assert.equal(submitted[0].values.name, "Reviewed");
  assert.equal(store["codenav.databaseState"][editor.stateOwner].documents[doc.path].busy, true);
  doc.selected = new Set([1]); editor.deleteRows(cx); editor.revert(cx); editor.editCell(1, 1, cx);
  assert.equal(doc.changes.size, 1); assert.equal(editor.editingCell, null);
  editor.editingCell = { row: 0, column: 1 }; editor.setCell("Late", cx); editor.editingCell = null;
  assert.equal(doc.changes.get(0).values.name, "Reviewed");
  const requestCount = calls.length;
  editor.transfer({ mode: "import", file: "/fixture/import.json", format: "json" }, cx); await settle();
  assert.equal(calls.length, requestCount);
  pending.resolve({ affected_rows: 1 }); await settle();
  assert.equal(doc.changes.size, 0); assert.equal(doc.applying, false); assert.match(doc.status, /1/);
  // A failed write retains the exact staged value for retry.
  editor.editCell(0, 1, cx); editor.setCell("Retry", cx);
  responder = async (method, data) => { if (method === "db_apply") throw new Error("conflict"); return defaultResponder(method, data); };
  editor.apply(cx); await settle(); assert.equal(doc.changes.get(0).values.name, "Retry");
  assert.equal(doc.applying, false); editor.revert(cx); responder = defaultResponder;
});
await check("owned SQL picker includes entire script and exact line ranges while editing", async () => {
  const table = editor.doc, doc = await show("console");
  typeSQL("SELECT 1;\nSELECT 2;"); editor.viewer.reveal(2, 0); editor.chooseQuery(cx);
  const candidates = overlays.at(-1).props.candidates;
  assert.equal(candidates.at(-1).label, "Entire script");
  assert.equal(candidates[0].firstLine, 2); assert.equal(candidates[0].lastLine, 2);
  assert.match(overlays.at(-1).props.source, /Fixture/);
  doc.editing = false; await show("table", table.spec.table);
});
await check("copy and selected export share one extractor; format changes have no transfer side effect", async () => {
  const doc = editor.doc; doc.selected = new Set([1]); doc.format = "csv";
  const grid = keySurface(editor.gridView(cx)); grid.handlers.on_key_down({ key: "c", modifiers: { platform: true } }, cx);
  const copied = clipboard; assert.equal(copied, "id,name,enabled\r\n2,\\N,false");
  editor.transfer({ mode: "export", format: "csv", scope: "selected", destination: "clipboard" }, cx); await settle(); assert.equal(clipboard, copied);
  editor.transfer({ mode: "export", format: "csv", scope: "selected", destination: "file", file: "/fixture/output.csv" }, cx); await settle();
  assert.deepEqual(writes.at(-1), { path: "/fixture/output.csv", text: copied, expected: null });
  const beforeCalls = calls.length, beforeWrites = writes.length; editor.transfer({ mode: "format", format: "json" }, cx); await settle();
  assert.equal(doc.format, "json"); assert.equal(calls.length, beforeCalls); assert.equal(writes.length, beforeWrites); assert.equal(clipboard, copied);
  grid.handlers.on_key_down({ key: "a", modifiers: { control: true } }, cx); assert.equal(doc.selected.size, 2);
  doc.selected = new Set([1]);
});
await check("loaded-row export and preview remain distinct from the selected rows", async () => {
  const doc = editor.doc; doc.selected = new Set([1]);
  editor.transfer({ mode: "export", format: "json", scope: "loaded", destination: "clipboard" }, cx); await settle();
  assert.equal(JSON.parse(clipboard).length, 2); assert.equal(doc.selected.size, 1);
  const dialog = new DatabaseTransfer();
  dialog.init({ mode: "export", format: "json", selectedCount: 1, dataset: editor.dataset(doc), loaded: editor.dataset(doc, false) }, cx);
  dialog.updatePreview(cx); assert.equal(JSON.parse(dialog.preview.value()).length, 1);
  dialog.scope = "loaded"; dialog.updatePreview(cx); assert.equal(JSON.parse(dialog.preview.value()).length, 2);
  dialog.release();
});
await check("focused cells navigate, stage on Enter, cancel on Escape and preserve read-only results", async () => {
  const doc = editor.doc; doc.selected.clear(); doc.focusedCell = null;
  const key = name => keySurface(editor.gridView(cx)).handlers.on_key_down({ key: name, modifiers: {} }, cx);
  key("right"); assert.deepEqual(plain(doc.focusedCell), { row: 0, column: 1 });
  key("end"); assert.equal(doc.focusedCell.column, 2); key("down"); key("down"); assert.equal(doc.focusedCell.row, 1);
  key("home"); assert.equal(doc.focusedCell.column, 0); key("left"); assert.equal(doc.focusedCell.column, 0);
  key("up"); key("right"); key("f2"); editor.cell.set_value("Cancelled"); key("escape"); assert.equal(doc.changes.size, 0); assert.equal(editor.editingCell, null);
  key("enter"); editor.cell.set_value("Staged"); editor.cell.events.submit({}, cx);
  assert.equal(doc.changes.get(0).values.name, "Staged"); assert.deepEqual(plain(doc.focusedCell), { row: 1, column: 1 });
  doc.changes.clear(); const kind = doc.spec.kind; doc.spec.kind = "console"; key("f2"); assert.equal(editor.editingCell, null); doc.spec.kind = kind;
  const keys = doc.result.primary_keys; doc.result.primary_keys = []; key("enter"); assert.equal(editor.editingCell, null); assert.equal(doc.changes.size, 0); doc.result.primary_keys = keys;
});
await check("grid presentation preserves multiline values and distinguishes ordinary table pages", async () => {
  const doc = editor.doc, original = doc.result.rows[0][1]; doc.result.rows[0][1] = "first\r\nsecond\nthird";
  editor.grid.setTop(0);
  const grid = editor.gridView(cx), values = []; let numberCell;
  walk(grid, el => { values.push(...el.nodes.filter(node => typeof node === "string")); if (el.idValue === "db-cell-1-0") numberCell = el; });
  assert.ok(values.includes("first↵second↵third")); assert.ok(values.includes("id")); assert.ok(!values.some(value => value.includes("⚿"))); assert.ok(numberCell.nodes[0].styles.text_right);
  editor.editCell(0, 1, cx); assert.equal(editor.cell.value(), "first\r\nsecond\nthird"); editor.editingCell = null;
  doc.selected = new Set([0]); doc.format = "csv"; editor.copy(cx); assert.match(clipboard, /first\r\nsecond\nthird/);
  doc.result.truncated = true; doc.offset = 200;
  const labels = []; walk(editor.render(cx), el => labels.push(...el.nodes.filter(node => typeof node === "string")));
  assert.ok(labels.some(text => text.startsWith("201–202 "))); assert.ok(!labels.some(text => /Result limited|결과가 제한/.test(text)));
  doc.result.rows[0][1] = original; doc.result.truncated = false; doc.offset = 0;
});
await check("row context menu preserves selection and uses scoped shared menu actions", async () => {
  const doc = editor.doc; doc.selected = new Set([0, 1]);
  editor.gridContext(1, 1, { modifiers: {} }, cx); assert.equal(doc.selected.size, 2); assert.deepEqual(plain(doc.focusedCell), { row: 1, column: 1 });
  const menu = new DatabaseQueryMenu(); menu.init({ ...overlays.at(-1).props, overlay: "fixture" }, cx);
  menu.menu.at = 1; menu.render(cx).handlers.on_key_down({ key: "enter", keystroke: "enter" }, cx);
  const payload = JSON.parse(commands.at(-1)[0].slice("codenav.database-grid:".length)); assert.equal(payload.path, doc.path); assert.equal(payload.action, "copy"); menu.release();
  const before = overlays.length;
  commandReaders.shift()(`database-grid:${JSON.stringify({ path: "obsolete", action: "export" })}`); await settle(); assert.equal(overlays.length, before);
  commandReaders.shift()(`database-grid:${JSON.stringify({ path: doc.path, action: "format" })}`); await settle(); assert.equal(overlays.at(-1).props.mode, "format");
});
await check("queued transfer command decodes exact prefix and rejects an obsolete document path", async () => {
  const doc = editor.doc;
  commandReaders.shift()(`database-transfer:${JSON.stringify({ path: doc.path, mode: "format", format: "tsv" })}`); await settle();
  assert.equal(doc.format, "tsv");
  commandReaders.shift()(`database-transfer:${JSON.stringify({ path: "db://closed-document", mode: "format", format: "xml" })}`); await settle();
  assert.equal(doc.format, "tsv");
});
await check("page controls cannot change offset while a page request is pending", async () => {
  const doc = editor.doc, page = deferred(); doc.result.rows = Array.from({ length: 200 }, (_, i) => [i, "loaded", true]);
  responder = async method => method === "db_rows" ? page.promise : defaultResponder(method);
  editor.load(doc, cx); await settle(); assert.equal(doc.loading, true);
  let next; walk(editor.render(cx), el => { if (el.idValue === "db-next") next = el; });
  assert.ok(next); assert.equal(next.handlers.on_click, undefined, "native disabled paging has no click action"); assert.equal(doc.offset, 0);
  page.resolve(plain(result)); await settle(); assert.equal(doc.loading, false);
});
await check("entire table export fetches every page with original source context", async () => {
  const doc = editor.doc, offsets = []; doc.selected = new Set([1]);
  responder = async (method, data) => {
    assert.equal(method, "db_rows"); assert.equal(data.source_id, "fixture"); assert.equal(data.database, "main"); assert.equal(data.table, "people"); offsets.push(data.offset);
    return { ...plain(result), rows: data.offset === 0 ? Array.from({ length: 1000 }, (_, i) => [i, "row", true]) : [[1000, "last", false]] };
  };
  editor.transfer({ mode: "export", format: "json", scope: "table", destination: "clipboard" }, cx); await settle(); assert.deepEqual(offsets, [0, 1000]); assert.equal(JSON.parse(clipboard).length, 1001);
  assert.equal(doc.selected.size, 1, "export does not alter grid selection");
});
await check("JSON import preserves numeric, boolean and NULL transaction values", async () => {
  const doc = editor.doc; files.set("/fixture/import.json", '[{"id":3,"name":null,"enabled":false}]');
  responder = async (method, data) => { if (method === "db_apply") { assert.deepEqual(plain(data.changes), [{ op: "insert", values: { id: 3, name: null, enabled: false } }]); return { affected_rows: 1 }; } return defaultResponder(method, data); };
  editor.transfer({ mode: "import", format: "json", file: "/fixture/import.json" }, cx); await settle(); assert.equal(doc.error, null); assert.equal(doc.transferring, false);
});
await check("import rejects a file changed after its preview", async () => {
  files.set("/fixture/reviewed.json", '[{"id":4,"name":"changed"}]');
  const before = calls.length;
  editor.transfer({ mode: "import", format: "json", file: "/fixture/reviewed.json", reviewedText: '[{"id":4,"name":"reviewed"}]' }, cx);
  await settle(); assert.equal(calls.length, before, "changed content never reaches db_apply");
  assert.match(editor.doc.error, /Preview it again|미리보기/); assert.equal(editor.doc.transferring, false);
});
await check("active cell navigation stages the old document and publishes text-free protection", async () => {
  responder = defaultResponder; const old = await show("table", "people");
  editor.editCell(0, 1, cx); editor.cell.set_value("Kept on switch"); await flushTimers();
  assert.equal(store["codenav.databaseState"][editor.stateOwner].documents[old.path].dirty, true);
  const tabs = modules.get(new URL("./tabs.js", entry).href).namespace;
  assert.equal(tabs.closeAll(), false, "the real tabs entry point protects the active cell");
  const current = await show("console"); await flushTimers();
  assert.equal(old.changes.get(0).values.name, "Kept on switch"); assert.equal(editor.editingCell, null);
  const metadata = store["codenav.databaseState"][editor.stateOwner];
  assert.equal(metadata.documents[old.path].dirty, true);
  assert.doesNotMatch(JSON.stringify(metadata), /Kept on switch|SELECT|Ada/);
  await show("table", "people"); editor.revert(cx); await flushTimers();
  assert.equal(store["codenav.databaseState"][editor.stateOwner].documents[old.path].dirty, false);
  await show("console"); assert.equal(editor.doc, current);
});
await check("SQL discard restores the saved draft and save conflicts keep its dirty metadata", async () => {
  const doc = editor.doc; const saved = doc.savedText;
  typeSQL("SELECT 'unsaved';"); await flushTimers();
  assert.equal(store["codenav.databaseState"][editor.stateOwner].documents[doc.path].dirty, true);
  editor.discardDraft(cx); await flushTimers(); assert.equal(doc.text, saved); assert.equal(editor.viewer.buffer.text, saved);
  assert.equal(store["codenav.databaseState"][editor.stateOwner].documents[doc.path].dirty, false);
  typeSQL("SELECT 'retry';");
  const disk = doc.diskText; files.set(doc.draftPath, "external change");
  editor.saveDraft(cx);
  assert.equal(store["codenav.databaseState"][editor.stateOwner].documents[doc.path].busy, true);
  await settle(); await flushTimers();
  assert.equal(doc.textDirty, true); assert.equal(doc.text, "SELECT 'retry';");
  assert.equal(store["codenav.databaseState"][editor.stateOwner].documents[doc.path].dirty, true);
  if (disk === null) files.delete(doc.draftPath); else files.set(doc.draftPath, disk);
  doc.saving = true; editor.discardDraft(cx); assert.equal(doc.textDirty, true);
  doc.saving = false; editor.discardDraft(cx); doc.editing = false; await flushTimers();
});
await check("late document loads never update the newly active document", async () => {
  const oldPage = deferred(); responder = async method => method === "db_rows" ? oldPage.promise : defaultResponder(method);
  const oldDoc = await show("table", "slow_people"); const currentDoc = await show("console"); currentDoc.text = "SELECT 42;";
  oldPage.resolve(plain(result)); await settle(); assert.equal(editor.doc, currentDoc); assert.equal(editor.doc.text, "SELECT 42;"); assert.equal(oldDoc.result.rows.length, 2);
});
await check("unfinished SQL stays renderable after leaving native edit mode", async () => {
  const doc = editor.doc; doc.text = "SELECT 'unfinished"; doc.editing = false; editor.viewer.setDocument(doc, cx); await settle(); assert.doesNotThrow(() => editor.render(cx));
});
await check("closed editor ignores a pending load before touching released native state", async () => {
  const pendingRead = deferred(); responder = async method => method === "db_sources" ? pendingRead.promise : defaultResponder(method);
  const doc = await show("table", "closing_people"); await flushTimers();
  assert.ok(store["codenav.databaseState"][editor.stateOwner]);
  editor.release(); assert.equal(store["codenav.databaseState"][editor.stateOwner], undefined); pendingRead.resolve({ sources: [{ id: "fixture", driver: "sqlite" }] }); await settle();
  assert.doesNotMatch(doc.error || "", /released native state/);
});
await check("closed transfer dialog discards pending preview results", async () => {
  const previewRead = deferred(); files.set("/fixture/slow.csv", previewRead.promise);
  const transfer = new DatabaseTransfer(); transfer.init({ mode: "import", path: "fixture", format: "csv" }, cx); transfer.file.set_value("/fixture/slow.csv");
  transfer.previewImport(cx); await settle(); transfer.release(); previewRead.resolve("id,name\n1,Ada"); await settle();
  assert.doesNotMatch(transfer.error || "", /released native state/); assert.equal(transfer.reviewed, null);
});
await check("out-of-order import previews retain the latest reviewed file and format", async () => {
  const first = deferred(), second = deferred(); files.set("/fixture/first.csv", first.promise); files.set("/fixture/second.csv", second.promise);
  const transfer = new DatabaseTransfer(); transfer.init({ mode: "import", path: "fixture", format: "csv" }, cx);
  transfer.file.set_value("/fixture/first.csv"); transfer.previewImport(cx); await settle();
  transfer.file.set_value("/fixture/second.csv"); transfer.previewImport(cx); await settle();
  second.resolve("id,name\n2,Latest"); await settle(); first.resolve("id,name\n1,Obsolete\n3,Extra"); await settle();
  assert.equal(transfer.reviewed.file, "/fixture/second.csv"); assert.equal(transfer.reviewed.rows, 1); assert.match(transfer.preview.value(), /Latest/); assert.doesNotMatch(transfer.preview.value(), /Obsolete/);
  const third = deferred(); files.set("/fixture/third.csv", third.promise); transfer.file.set_value("/fixture/third.csv"); transfer.previewImport(cx); await settle();
  transfer.choose("json", cx); third.resolve("id,name\n3,WrongFormat"); await settle(); assert.equal(transfer.reviewed, null); assert.equal(transfer.error, null); transfer.release();
});

// Exercise the actual bottom results subclass, canonical native controls and
// inherited grid/transfer code through the same repository import graph.
const historyAPI = modules.get(new URL("./execution-results.js", entry).href).namespace;
const nodeById = (root, id) => { let found; walk(root, node => { if (node.idValue === id) found = node; }); assert.ok(found, `Missing native node ${id}`); return found; };
const click = (root, id) => { const node = nodeById(root, id); assert.equal(typeof node.handlers.on_click, "function", `No click handler for ${id}`); node.handlers.on_click({}, cx); };
const resultsView = new RunResults(), sourceOwner = new DatabaseEditor();
let executionId, sourceDoc, secondExecutionId;
const selectedHistory = () => historyAPI.executionStore().entries.find(item => item.id === historyAPI.executionStore().selected);
const sendResultCommand = async command => { assert.ok(commandReaders.length); commandReaders.pop()(command); await settle(); };

await check("bottom SQL results survive source-tab switches and keep source selection isolated", async () => {
  activeSpace = "one"; store["codenav.executionResults"] = {}; responder = defaultResponder;
  sourceOwner.init({}, cx); await settle();
  await openDatabaseDocument({ source_id: "fixture", kind: "console", database: "main", schema: "public" }); sourceOwner.sync(cx); await flushTimers();
  sourceDoc = sourceOwner.doc; sourceDoc.text = "SELECT 10;\nSELECT 20;";
  const pendingJob = deferred();
  responder = async (method, data) => {
    if (method === "db_query") { assert.deepEqual(plain(data.statements), ["SELECT 10", "SELECT 20"]); return { job_id: "history-job" }; }
    if (method === "db_job") { assert.equal(data.job_id, "history-job"); return pendingJob.promise; }
    return defaultResponder(method, data);
  };
  sourceOwner.execute(sourceDoc.text, cx); await settle(); executionId = selectedHistory().id;
  const stateCount = states.length; resultsView.init({}, cx); await settle();
  resultsView.recoverExecutions(cx); resultsView.recoverExecutions(cx); await settle();
  assert.equal(calls.filter(call => call.method === "db_job" && call.body.database.job_id === "history-job").length, 1, "a live source poll owner prevents every recovery duplicate");
  assert.equal(states.length, stateCount + 1, "the results view owns only its readonly transcript, not another SQL editor/viewer");
  let rendered = resultsView.render(cx);
  const pendingClose = nodeById(rendered, `execution-close-${executionId}`);
  assert.deepEqual(pendingClose.styles.disabled, [true]); assert.equal(pendingClose.handlers.on_click, undefined);
  resultsView.close(executionId, cx); assert.ok(historyAPI.executionStore().entries.some(item => item.id === executionId));
  sourceDoc.text = "SELECT 'a newer unexecuted draft';";
  await openDatabaseDocument({ source_id: "fixture", kind: "table", database: "different", schema: "public", table: "other" }); sourceOwner.sync(cx); await flushTimers();
  const activeTable = sourceOwner.doc; assert.notEqual(activeTable, sourceDoc);
  pendingJob.resolve({ id: "history-job", state: "completed", current: 2, total: 2, elapsed_ms: 4, results: [plain(result), { columns: [{ name: "answer" }], rows: [[42]], statement: "SELECT 20" }] });
  await settle(); assert.equal(sourceOwner.doc, activeTable); assert.equal(sourceDoc.job.state, "completed");
  assert.equal(selectedHistory().command, "SELECT 10;\nSELECT 20;", "history retains the approved SQL instead of the newer source draft");
  assert.equal(selectedHistory().spec.database, "main");
  sourceDoc.selected.add(0); sourceDoc.format = "tsv";
  rendered = resultsView.render(cx); await flushTimers();
  assert.equal(resultsView.doc.path, executionId); assert.equal(resultsView.doc.spec.database, "main");
  assert.notEqual(resultsView.doc.selected, sourceDoc.selected); assert.equal(resultsView.doc.selected.size, 0);
  assert.equal(resultsView.showSQL, undefined, "executed SQL starts collapsed");
  click(rendered, "execution-sql"); rendered = resultsView.render(cx); await flushTimers();
  assert.equal(resultsView.showSQL, true); assert.equal(resultsView.transcript.value(), "SELECT 10;\nSELECT 20;");
  nodeById(rendered, `db-row-${executionId}-2`).handlers["on_mouse_down:left"]({ modifiers: {} }, cx);
  assert.deepEqual([...resultsView.doc.selected], [1]); assert.deepEqual([...sourceDoc.selected], [0]);
  keySurface(resultsView.gridView(cx)).handlers.on_key_down({ key: "c", modifiers: { platform: true } }, cx); assert.equal(clipboard, "id,name,enabled\r\n2,\\N,false");
  assert.equal(sourceDoc.format, "tsv"); assert.equal(sourceOwner.doc, activeTable);
});

await check("bottom result extractor overlays and multi-result tabs act on their own snapshots", async () => {
  let rendered = resultsView.render(cx);
  resultsView.showExtractors();
  const pickerProps = overlays.at(-1).props;
  assert.equal(pickerProps.path, executionId); assert.equal(pickerProps.mode, "format");
  const picker = new DatabaseTransfer(); picker.init({ ...pickerProps, overlay: "history-format" }, cx);
  const formats = modules.get(new URL("./database-model.js", entry).href).namespace.EXTRACTORS;
  picker.menu.at = formats.findIndex(format => format.id === "json");
  picker.render(cx).handlers.on_key_down({ key: "enter", keystroke: "enter" }, cx);
  const formatCommand = commands.at(-1)[0]; assert.equal(JSON.parse(formatCommand.slice("codenav.database-transfer:".length)).path, executionId);
  await sendResultCommand(formatCommand.slice("codenav.".length)); picker.release();
  assert.equal(resultsView.doc.format, "json"); assert.equal(sourceDoc.format, "tsv");
  rendered = resultsView.render(cx); keySurface(resultsView.gridView(cx)).handlers.on_key_down({ key: "c", modifiers: { platform: true } }, cx);
  assert.deepEqual(JSON.parse(clipboard), [{ id: 2, name: null, enabled: false }]);
  click(rendered, "execution-export");
  const exportProps = overlays.at(-1).props;
  assert.equal(exportProps.path, executionId); assert.equal(exportProps.table, false); assert.equal(exportProps.selectedCount, 1);
  assert.deepEqual(plain(exportProps.dataset.rows), [[2, null, false]]); assert.equal(exportProps.loaded.rows.length, 2);
  assert.equal(exportProps.dataset.database, "main", "the current source table's different connection cannot overwrite an export snapshot");
  // Grid context overlays use the same owned result path as toolbar actions.
  nodeById(rendered, "db-cell-2-1").handlers["on_mouse_down:right"]({ modifiers: {}, position: { x: 10, y: 10 } }, cx);
  assert.equal(overlays.at(-1).props.path, executionId); assert.equal(overlays.at(-1).props.editable, false); assert.equal(overlays.at(-1).props.table, false);
  click(rendered, "execution-statement-1"); rendered = resultsView.render(cx);
  assert.equal(resultsView.doc.resultIndex, 1); assert.deepEqual(plain(resultsView.doc.result.rows), [[42]]); assert.equal(resultsView.doc.selected.size, 0);
  assert.equal(sourceDoc.resultIndex, 0); assert.deepEqual(plain(sourceDoc.result.rows), plain(result.rows)); assert.deepEqual([...sourceDoc.selected], [0]);
  secondExecutionId = historyAPI.beginExecution({ kind: "sql", name: "Another SQL", command: "SELECT 99", spec: { ...sourceDoc.spec }, source: { ...sourceDoc.source }, job: { id: "second-history", state: "completed", results: [{ columns: [{ name: "other" }], rows: [[99]] }] } });
  historyAPI.updateExecution(secondExecutionId, { state: "completed" });
  resultsView.render(cx); assert.equal(resultsView.doc.path, secondExecutionId); assert.equal(resultsView.doc.resultIndex, 0);
  resultsView.select(executionId, cx); rendered = resultsView.render(cx);
  assert.equal(resultsView.doc.resultIndex, 1); assert.deepEqual(plain(resultsView.doc.result.rows), [[42]], "each execution retains its selected statement result");
  click(rendered, "execution-statement-0"); resultsView.render(cx);
  assert.equal(resultsView.doc.resultIndex, 0); assert.equal(resultsView.doc.result.rows[1][1], null);
});

await check("bottom result transfer close guards and SQL cancellation target the owning execution", async () => {
  let rendered = resultsView.render(cx);
  nodeById(rendered, `db-row-${executionId}-2`).handlers["on_mouse_down:left"]({ modifiers: {} }, cx);
  const exportingDoc = resultsView.doc, blockedRead = deferred(), file = "/fixture/history-result.json";
  files.set(file, blockedRead.promise);
  await sendResultCommand("database-transfer:" + JSON.stringify({ path: executionId, mode: "export", format: "json", scope: "selected", destination: "file", file }));
  assert.equal(exportingDoc.transferring, true);
  rendered = resultsView.render(cx); assert.deepEqual(nodeById(rendered, `execution-close-${executionId}`).styles.disabled, [true]);
  resultsView.close(executionId, cx); assert.ok(historyAPI.executionStore().entries.some(item => item.id === executionId));
  resultsView.select(secondExecutionId, cx); resultsView.render(cx);
  assert.notEqual(resultsView.doc, exportingDoc); assert.equal(resultsView.doc.result.rows[0][0], 99);
  files.delete(file); blockedRead.resolve(null); await settle();
  assert.equal(exportingDoc.transferring, false); assert.deepEqual(JSON.parse(writes.at(-1).text), [{ id: 2, name: null, enabled: false }]);
  assert.equal(resultsView.doc.result.rows[0][0], 99); assert.deepEqual([...sourceDoc.selected], [0]);
  const pendingId = historyAPI.beginExecution({ kind: "sql", name: "Cancel this SQL", command: "SELECT slow", spec: { ...sourceDoc.spec }, source: { ...sourceDoc.source }, job: { id: "cancel-history", state: "running", current: 1, total: 1, results: [] } });
  historyAPI.updateExecution(pendingId, { state: "running" });
  responder = async (method, data) => { assert.equal(method, "db_cancel"); assert.equal(data.job_id, "cancel-history"); return { id: "cancel-history", state: "cancelled", results: [] }; };
  resultsView.render(cx); resultsView.stop(cx); await settle();
  assert.equal(selectedHistory().state, "cancelled"); assert.equal(sourceDoc.job.state, "completed");
  resultsView.close(pendingId, cx); assert.ok(!historyAPI.executionStore().entries.some(item => item.id === pendingId));
  resultsView.close(executionId, cx); assert.ok(!historyAPI.executionStore().entries.some(item => item.id === executionId));
  assert.equal(historyAPI.executionStore().selected, secondExecutionId);
  resultsView.render(cx); resultsView.release(); sourceOwner.release(); await flushTimers();
  assert.equal(resultsView.transcript.released, true);
});

await check("a fresh mod VM recovers persisted executions through reads without re-executing commands", async () => {
  store["codenav.executionResults"] = {}; activeSpace = "one";
  const make = (kind, name, extra = {}) => historyAPI.beginExecution({ kind, name, command: "original approved command", spec: { source_id: "fixture", database: "main", kind: "console" }, source: { driver: "sqlite" }, ...extra });
  const sqlId = make("sql", "Recover SQL", { job: { id: "persisted-running", state: "running", results: [] } });
  historyAPI.claimExecution(sqlId); // This runtime's ownership must not survive reload.
  const missingId = make("sql", "Lost submission", { job: { state: "queued", results: [] } });
  const unknownId = make("sql", "Missing job", { job: { id: "missing-job", state: "running", results: [] } });
  const footerId = make("shell", "Footer", { terminal: "restore-footer", marker: "HR_recovered" });
  const exitId = make("shell", "Native exit", { terminal: "restore-exit", marker: "HR_absent" });
  const liveId = make("shell", "Unknown live process", { terminal: "restore-live", configuration: "restore-config", marker: "HR_absent" });
  for (const id of [footerId, exitId, liveId]) historyAPI.updateExecution(id, { state: "running", output: "previously captured execution output" });
  const foreignId = historyAPI.beginExecution({ kind: "sql", name: "Other workspace", job: { id: "must-not-read", state: "running" } }, "@area:two");
  store["codenav.runSessions"] = { "project@one": { "restore-config": { terminal: "restore-live" } } };
  const callsBefore = calls.length, terminalCalls = []; let recoveredPolls = 0;
  responder = async (method, data) => {
    assert.equal(method, "db_job", "recovery must never resubmit SQL or cancel it automatically");
    if (data.job_id === "missing-job") throw new Error("database job not found");
    assert.equal(data.job_id, "persisted-running");
    return { id: data.job_id, state: ++recoveredPolls === 1 ? "running" : "completed", results: [plain(result)] };
  };
  terminalResponder = async args => {
    terminalCalls.push(args); assert.ok(["read", "get"].includes(args[0]), "recovery must never send, interrupt or start a terminal");
    if (args[0] === "read") return { code: 0, stdout: args[1] === "restore-footer" ? "unrelated old terminal output\nHR_recovered:0\n" : "unrelated terminal history" };
    return { code: 0, stdout: JSON.stringify(args[1] === "restore-exit" ? { state: "finished", exit_code: 7, reason: "exited" } : { state: "live", argv: ["/bin/zsh"] }) };
  };
  // Recompile the complete real import graph in a new V8 context, retaining
  // only the host store/I/O fixtures, just as an HMR/restart retains shared.
  const rebootContext = vm.createContext({ console, fetch: context.fetch }), rebootModules = new Map();
  for (const url of modules.keys()) if (url.startsWith("file:")) rebootModules.set(url, new vm.SourceTextModule(await readFile(new URL(url), "utf8"), { context: rebootContext, identifier: url }));
  for (const [id, names] of externals) rebootModules.set(id, new vm.SyntheticModule([...names], function() { for (const name of names) this.setExport(name, hostValues[name] ?? (() => {})); }, { context: rebootContext }));
  await rebootModules.get(entry).link((id, ref) => rebootModules.get(id.startsWith(".") ? new URL(id, ref.identifier).href : id));
  await rebootModules.get(entry).evaluate();
  const rebootHistory = rebootModules.get(new URL("./execution-results.js", entry).href).namespace;
  const rebootView = new (rebootModules.get(entry).namespace.RunResults)(); rebootView.init({}, cx); await settle();
  const records = () => rebootHistory.executionStore().entries;
  assert.equal(records().find(item => item.id === sqlId).state, "completed");
  assert.deepEqual(plain(records().find(item => item.id === sqlId).job.results[0].rows), plain(result.rows));
  assert.equal(records().find(item => item.id === missingId).state, "error"); assert.match(records().find(item => item.id === missingId).error, /job ID|작업 ID/);
  assert.equal(records().find(item => item.id === unknownId).state, "error");
  assert.equal(records().find(item => item.id === footerId).state, "completed"); assert.equal(records().find(item => item.id === footerId).exitCode, 0);
  assert.equal(records().find(item => item.id === exitId).state, "error"); assert.equal(records().find(item => item.id === exitId).exitCode, 7);
  assert.equal(records().find(item => item.id === liveId).state, "untracked");
  assert.equal(store["codenav.runSessions"]["project@one"]["restore-config"].untracked, true);
  for (const id of [footerId, exitId, liveId]) { const record = records().find(item => item.id === id); assert.equal(record.output, "previously captured execution output"); assert.equal(record.continuityLost, true); }
  assert.equal(rebootHistory.executionStore("@area:two").entries.find(item => item.id === foreignId).state, "queued");
  assert.equal(calls.slice(callsBefore).some(call => call.method === "db_query"), false);
  assert.equal(calls.slice(callsBefore).filter(call => call.method === "db_job").length, 3);
  rebootHistory.selectExecution(liveId); const beforeStop = terminalCalls.length; rebootView.stop(cx); await settle(); assert.equal(terminalCalls.length, beforeStop, "untracked results cannot stop an unrelated live process");
  assert.equal(rebootHistory.closeExecution(liveId), true); assert.equal(rebootHistory.closeExecution(missingId), true);
  assert.equal(rebootHistory.claimExecution(sqlId), true, "recovery releases its runtime ownership after completion"); rebootHistory.releaseExecution(sqlId);
  rebootView.release(); historyAPI.releaseExecution(sqlId); terminalResponder = null;
});

await check("released recovery views hand an unfinished SQL poll to the next owner safely", async () => {
  store["codenav.executionResults"] = {};
  const id = historyAPI.beginExecution({ kind: "sql", name: "Orphan SQL", command: "SELECT 1", spec: { source_id: "fixture", kind: "console" }, job: { id: "handoff-job", state: "running", results: [] } });
  const pending = deferred(); let reads = 0;
  responder = async (method, data) => { assert.equal(method, "db_job"); assert.equal(data.job_id, "handoff-job"); return ++reads === 1 ? pending.promise : { id: "handoff-job", state: "completed", results: [plain(result)] }; };
  const first = new RunResults(); first.init({}, cx); await settle(); assert.equal(reads, 1);
  first.release(); pending.resolve({ id: "handoff-job", state: "running", results: [] }); await settle();
  const second = new RunResults(); second.init({}, cx); await settle();
  assert.equal(reads, 2); assert.equal(selectedHistory().id, id); assert.equal(selectedHistory().state, "completed");
  assert.equal(first.transcript.released, true); second.render(cx); second.release(); await flushTimers();
});

await check("a source released during SQL submission hands its saved job ID to recovery without resubmitting", async () => {
  store["codenav.executionResults"] = {}; responder = defaultResponder;
  const owner = new DatabaseEditor(); owner.init({}, cx); await settle();
  await openDatabaseDocument({ source_id: "fixture", kind: "console", database: "release-handoff" }); owner.sync(cx); await flushTimers();
  owner.doc.text = "SELECT 123;";
  const submission = deferred(); let submissions = 0, reads = 0;
  responder = async (method, data) => {
    if (method === "db_query") { submissions++; return submission.promise; }
    assert.equal(method, "db_job"); assert.equal(data.job_id, "released-source-job"); reads++; return { id: data.job_id, state: "completed", results: [plain(result)] };
  };
  owner.execute(owner.doc.text, cx); await settle();
  const view = new RunResults(); view.init({}, cx); await settle(); assert.equal(selectedHistory().state, "queued"); assert.equal(reads, 0);
  owner.release(); submission.resolve({ job_id: "released-source-job" }); await settle();
  assert.equal(selectedHistory().job.id, "released-source-job");
  view.recoverExecutions(cx); await settle();
  assert.equal(submissions, 1); assert.equal(reads, 1); assert.equal(selectedHistory().state, "completed");
  view.render(cx); view.release(); await flushTimers();
});
await check("idea SQL uses the production owned editor for input, execution selection, save CAS and discard history", async () => {
  store.layout = "idea"; responder = defaultResponder;
  const EditableCode = modules.get(new URL("./editable-code.js", entry).href).namespace.default;
  const owner = new DatabaseEditor(); owner.init({}, cx); await settle();
  await openDatabaseDocument({ source_id: "fixture", kind: "console", database: "owned-sql-fixture" }); owner.sync(cx); await flushTimers();
  const doc = owner.doc, viewer = owner.viewer;
  assert.ok(viewer instanceof EditableCode, "actual SQLBuffer extends the unchanged production EditableCode");
  assert.equal(owner.editor, null, "idea does not create a parallel native Editor state");
  assert.equal(doc.editing, false); assert.equal(owner.viewer.buffer.readOnly, false);
  const script = "SELECT '한글😀';\nSELECT 2;";
  typeSQL(script, owner); const buffer = viewer.buffer;
  assert.equal(doc.text, script); assert.equal(doc.textDirty, true); assert.equal(buffer.text, script);
  assert.equal(store["codenav.databaseState"][owner.stateOwner].documents[doc.path].dirty, true);
  owner.render(cx); assert.equal(viewer.buffer, buffer, "ordinary render retains selection/history and one document model");
  const start = script.indexOf("SELECT 2"); buffer.select(start, script.length); viewer.selectionFromBuffer();
  owner.chooseQuery(cx); assert.equal(overlays.at(-1).props.candidates[0].label, "Selection");
  assert.equal(overlays.at(-1).props.candidates[0].text, "SELECT 2;");
  viewer.reveal(1, 9); owner.chooseQuery(cx);
  assert.equal(overlays.at(-1).props.candidates[0].firstLine, 1);
  assert.equal(overlays.at(-1).props.candidates.at(-1).label, "Entire script");
  assert.ok(bindings.some(binding => binding.keystroke === "cmd-enter" && binding.action === "codebench-sql::run" && binding.context === "HerdrSqlEditor"));
  const beforeRun = calls.filter(call => call.method === "db_query").length;
  const sqlRoot = viewer.render(cx); const overlayCount = overlays.length;
  sqlRoot.handlers["on_action:codebench-sql::run"]({}, cx);
  assert.equal(overlays.length, overlayCount + 1, "scoped command opens an approval picker instead of silently executing");
  assert.equal(calls.filter(call => call.method === "db_query").length, beforeRun);
  viewer.keyDown({ key: "enter", modifiers: { platform: true } }, cx);
  assert.equal(overlays.length, overlayCount + 2);
  viewer.input.state.text = "조합";
  let pendingPropagated = false;
  sqlRoot.handlers["on_action:codebench-sql::run"]({}, { ...cx, propagate() { pendingPropagated = true; } });
  assert.equal(pendingPropagated, true, "native SQL action leaves marked text with the OS input method");
  assert.equal(overlays.length, overlayCount + 2);
  viewer.keyDown({ key: "enter", modifiers: { platform: true } }, cx);
  assert.equal(overlays.length, overlayCount + 2, "marked native text is not mistaken for SQL run approval");
  viewer.input.state.text = "";
  owner.saveDraft(cx); await settle();
  assert.deepEqual(writes.at(-1), { path: doc.draftPath, text: script, expected: null });
  assert.equal(doc.textDirty, false); assert.equal(doc.savedText, script);
  viewer.inputCommand("undo", cx); assert.equal(doc.text, buffer.text); assert.equal(doc.textDirty, true);
  viewer.inputCommand("redo", cx); assert.equal(doc.text, script); assert.equal(doc.textDirty, false);
  viewer.inputCommand("move-doc-end", cx); viewer.input.state.commit("\nSELECT 3;");
  const saveSnapshot = doc.text; owner.saveDraft(cx); viewer.input.state.commit("\nSELECT 4;"); await settle();
  assert.equal(files.get(doc.draftPath), saveSnapshot); assert.equal(doc.textDirty, true, "input during saving remains dirty");
  const beforeConflict = writes.length; files.set(doc.draftPath, "external SQL draft"); owner.saveDraft(cx); await settle();
  assert.equal(writes.length, beforeConflict); assert.equal(files.get(doc.draftPath), "external SQL draft"); assert.equal(doc.textDirty, true);
  files.set(doc.draftPath, doc.diskText); owner.discardDraft(cx); await flushTimers();
  assert.equal(doc.text, saveSnapshot); assert.equal(owner.viewer.buffer.text, saveSnapshot); assert.equal(doc.textDirty, false);
  assert.notEqual(owner.viewer.buffer, buffer, "explicit discard replaces the model once");
  assert.equal(owner.viewer.buffer.undo(), false, "discarded SQL cannot reappear from the abandoned model's undo history");
  owner.release();
});
await check("idea DDL shares readonly owned rendering and codebench preserves its legacy native SQL editor", async () => {
  responder = async (method, data) => method === "db_ddl" ? { sql: "CREATE TABLE fixture (id INT);", warnings: [] } : defaultResponder(method, data);
  store.layout = "idea"; const ddlOwner = new DatabaseEditor(); ddlOwner.init({}, cx); await settle();
  await openDatabaseDocument({ source_id: "fixture", kind: "ddl", database: "ddl-fixture", table: "fixture" }); ddlOwner.sync(cx); await flushTimers();
  assert.equal(ddlOwner.doc.text, "CREATE TABLE fixture (id INT);"); assert.equal(ddlOwner.viewer.buffer.readOnly, true);
  assert.equal(ddlOwner.viewer.commit("bad edit", cx), false); assert.equal(ddlOwner.doc.textDirty, false);
  ddlOwner.viewer.inputCommand("select-all", cx); ddlOwner.viewer.inputCommand("copy", cx); assert.equal(clipboard, ddlOwner.doc.text);
  ddlOwner.release();
  store.layout = "codebench"; responder = defaultResponder;
  const legacy = new DatabaseEditor(); legacy.init({}, cx); await settle();
  await openDatabaseDocument({ source_id: "fixture", kind: "console", database: "legacy-sql-fixture" }); legacy.sync(cx); await flushTimers();
  assert.ok(legacy.editor); assert.equal(legacy.viewer.input, undefined);
  legacy.toggleEditing(cx); assert.equal(legacy.doc.editing, true);
  legacy.editor.set_value("SELECT 10;\nSELECT 20;"); legacy.editor.events.change({}, cx);
  assert.equal(legacy.doc.textDirty, true); legacy.chooseQuery(cx);
  assert.equal(overlays.at(-1).props.candidates[1].firstLine, 2, "legacy native mode lists each statement without guessing its hidden caret");
  legacy.toggleEditing(cx); assert.equal(legacy.doc.editing, false); assert.equal(legacy.viewer.text, legacy.doc.text);
  legacy.release(); store.layout = "idea";
});
await check("owned shell output occupies a native result terminal while SQL and legacy logs retain their own surfaces", async () => {
  const previousTree = tree, previousSpec = plain(store["activity.editor"]);
  tree = { id: "root", type: "row", children: [
    { id: "user-terminal", type: "block", size: { weight: 3 }, content: { terminal: "untouched-user-terminal" } },
    { id: "right2-views", type: "stack", active: "bottom-run-results", children: [
      { id: "bottom-run-results", type: "block", size: { weight: 2 }, min: 150, hidden: false, content: { mod: "codenav", props: { view: "run-results" } } },
    ] },
  ] };
  const userTerminal = JSON.stringify(tree.children[0]);
  const owned = historyAPI.beginExecution({ kind: "shell", name: "Fixture", command: "fixture only", processOwned: true, terminal: "owned-fixture", folder: "/fixture" }, undefined, { claim: true });
  historyAPI.updateExecution(owned, { state: "running" });
  const view = new RunResults(); view.init({}, cx); await settle();
  let rendered = view.render(cx); await flushTimers();
  assert.equal(layoutNode("bottom-run-results").type, "column");
  assert.deepEqual(plain(layoutNode("bottom-run-results").size), { weight: 2 });
  assert.equal(layoutNode("bottom-run-results").min, 150, "outer tool constraints and its moved slot survive migration");
  assert.deepEqual(plain(layoutNode("execution-terminal").content), { terminal: "owned-fixture" });
  assert.equal(Boolean(layoutNode("execution-terminal").hidden), false);
  assert.ok(layoutNode("execution-controls").size.px > 0);
  let editors = 0; walk(rendered, node => { if (node.type === "editor") editors++; });
  assert.equal(editors, 0, "running shell output is not duplicated into a readonly Editor");
  assert.equal(JSON.stringify(tree.children[0]), userTerminal);
  assert.deepEqual(plain(store["activity.editor"]), previousSpec, "attaching results never selects or replaces the source document");
  const hostRoundTrip = value => JSON.parse(JSON.stringify(value, (key, item) =>
    key === "hidden" && item === false || key === "max" && item === null ? undefined : item));
  const stableRedraws = async label => {
    tree = hostRoundTrip(tree);
    const before = commands.filter(([name]) => name === "layout.set").length;
    for (let i = 0; i < 3; i++) { view.render(cx); await flushTimers(); }
    assert.equal(commands.filter(([name]) => name === "layout.set").length, before, `${label} redraws do not repeat layout.set after native default omission`);
  };
  await stableRedraws("live terminal");
  const sql = historyAPI.beginExecution({ kind: "sql", name: "SQL", command: "SELECT 1", spec: { source_id: "fixture" } }, undefined, { claim: true });
  historyAPI.updateExecution(sql, { state: "completed", job: { state: "completed", results: [plain(result)] } });
  view.render(cx); await flushTimers();
  assert.equal(layoutNode("execution-terminal").hidden, true);
  assert.deepEqual(plain(layoutNode("execution-controls").size), { weight: 1 });
  await stableRedraws("SQL results");
  const legacy = historyAPI.beginExecution({ kind: "shell", name: "Legacy", command: "old command", output: "previous captured output" }, undefined, { claim: true });
  historyAPI.updateExecution(legacy, { state: "completed", output: "previous captured output" });
  rendered = view.render(cx); await flushTimers(); editors = 0; walk(rendered, node => { if (node.type === "editor") editors++; });
  assert.equal(editors, 1, "legacy history keeps its preserved transcript");
  assert.match(view.transcript.value(), /previous captured output/);
  await stableRedraws("finished transcript");
  for (const id of [owned, sql, legacy]) historyAPI.releaseExecution(id);
  view.release(); tree = previousTree;
});
if (taskErrors.length) failures.push({ name: "uncaught background tasks", error: taskErrors[0] });
if (failures.length) { for (const { name, error } of failures) console.error(`${name}: ${error.stack}`); process.exitCode = 1; }
else console.log("PASS database editor state transitions, approved SQL transport, typed row mutations, transfers, scopes and stale async lifecycle");

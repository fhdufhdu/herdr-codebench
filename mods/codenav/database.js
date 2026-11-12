// Global source metadata belongs to the engine; credentials stay in native input state.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, v_virtual_list, Scrollbar, Select, Popup } from "gpui-base";
import { run, openOverlay, closeOverlay, nextCommand, shared, setShared, window } from "herdr";
import { IDEA, ideaUI, isIdea, uiSize, uiColors, uiButton, uiCaption, uiInputBox, uiListRow, uiTreeRow, uiSettingsShell, MenuController, uiMenu, uiManagedList } from "./idea-design.js";
import { T } from "./i18n.js";
import { lsp } from "./lsp.js";
import { uiIcon } from "./ui-icons.js";

const REVISION = "codenav.database.revision";
const SOURCE_ORDER = "codenav.database.sourceOrder";
const orderedSources = sources => {
  if (!isIdea()) return sources;
  const order = shared(SOURCE_ORDER), ranks = new Map((Array.isArray(order) ? order : []).map((id, index) => [id, index]));
  return sources.slice().sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
};
const NODE_ICONS = { source: "database", database: "database", schema: "folder", table: "table", view: "table", column: "hash" };
const DRIVERS = [
  { id: "mysql", label: "MySQL", port: 3306 }, { id: "mariadb", label: "MariaDB", port: 3306 },
  { id: "postgres", label: "PostgreSQL", port: 5432 }, { id: "sqlserver", label: "SQL Server", port: 1433 },
  { id: "sqlite", label: "SQLite", port: 0 },
];
const FIELDS = ["name", "host", "port", "user", "password", "database", "path"];
const TLS_OPTIONS = [{ id: "", label: "Default" }, { id: "disable", label: "Disable" }, { id: "require", label: "Require" }, { id: "verify-full", label: "Verify Full" }];
const FIELD_LABELS = { name: "Name", host: "Host", port: "Port", user: "User", password: "Password", database: "Database", path: "Enter the SQLite database file path." };
const message = error => String(error?.message ?? error ?? "");
const request = (method, database, cx) => lsp(method, { database }, ms => cx.sleep(ms));
const publicSource = source => Object.fromEntries(["id", "name", "driver", "host", "port", "user", "database", "path", "tls", "has_password", "password_storage"]
  .filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));
const sourcesFrom = result => {
  if (!Array.isArray(result?.sources)) throw new Error(T("The engine returned an invalid data source list."));
  return result.sources.filter(source => source && typeof source.id === "string").map(publicSource);
};
const changed = () => setShared(REVISION, `${Date.now()}-${Math.random()}`);
const nodeKey = node => JSON.stringify([node.source_id, node.kind, node.database ?? "", node.schema ?? "", node.table ?? "", node.name]);
const expandable = node => node.kind !== "column";
const catalogObject = node => {
  if (node.kind === "group") return null;
  if (node.kind === "source") return node.database ? { kind: "database", name: node.database, database: node.database } : null;
  return { kind: node.kind === "column" ? "table" : node.kind, name: node.kind === "column" ? node.table : node.name,
    database: node.database, schema: node.schema, table: node.table };
};
const openDatabase = payload => run(`codenav.database-open:${JSON.stringify(payload)}`);
export const openDatabaseManager = (options = {}) => openOverlay({ mod: "codenav", props: { view: "database-manager", ...options },
  kind: "dialog", modal: true, frame: "none", width: isIdea() ? 840 : 900, height: 680 });

export class Database {
  init(p, cx) {
    this.alive = true; this.epoch = 0; this.sources = []; this.children = new Map(); this.expanded = new Set();
    this.pending = new Set(); this.errors = new Map(); this.selection = new Set(); this.anchor = null; this.current = null;
    this.menu = new MenuController(cx, 0); this.overlay = p?.overlay; this.snapshot = p?.nodes;
    this.seenRevision = shared(REVISION); this.pointer = null;
    if (p?.variant === "menu") { this.menu.focus.focus(); return; }
    this.refresh(cx);
    cx.timer.every(1000, taskCx => {
      if (this.alive && this.seenRevision !== shared(REVISION)) { this.seenRevision = shared(REVISION); this.refresh(taskCx); }
    });
    cx.spawn(async taskCx => {
      while (this.alive) {
        const command = await nextCommand();
        if (!this.alive) return;
        if (command === "database-manage") openDatabaseManager();
        else if (command === "database-add") openDatabaseManager({ newSource: true });
        else if (command === "database-refresh") this.refresh(taskCx);
        else if (command === "focus") this.menu.focus.focus();
      }
    });
  }
  release() {
    if (!this.alive) return;
    this.alive = false; ++this.epoch; this.menu.release(); this.menu.focus.release();
  }
  dismiss() { this.release(); if (this.overlay) closeOverlay(this.overlay); }
  roots() { return this.sources.map(source => ({ ...source, source_id: source.id, kind: "source", depth: 0 })); }
  rows() {
    const rows = [];
    const visit = node => {
      const key = node.key ?? nodeKey(node); rows.push({ ...node, key });
      if (!this.expanded.has(key)) return;
      const children = this.children.get(key) ?? [];
      if (!isIdea() || !children.some(child => ["table", "view"].includes(child.kind))) {
        for (const child of children) visit({ ...child, depth: node.depth + 1 });
        return;
      }
      for (const child of children.filter(child => !["table", "view"].includes(child.kind))) visit({ ...child, depth: node.depth + 1 });
      for (const kind of ["table", "view"]) {
        const objects = children.filter(child => child.kind === kind);
        if (!objects.length) continue;
        const groupKey = JSON.stringify([node.source_id, "group", key, kind]);
        const group = { ...node, kind: "group", name: T(kind === "table" ? "Tables" : "Views"), key: groupKey, depth: node.depth + 1, count: objects.length };
        rows.push(group);
        if (this.expanded.has(groupKey)) for (const child of objects) visit({ ...child, depth: group.depth + 1 });
      }
    };
    this.roots().forEach(visit); return rows;
  }
  refresh(cx) {
    const epoch = ++this.epoch; this.loading = true; this.error = null;
    this.children.clear(); this.pending.clear(); this.errors.clear(); cx.notify();
    cx.spawn(async taskCx => {
      let sources, error;
      try { sources = sourcesFrom(await request("db_sources", {}, taskCx)); } catch (failure) { error = message(failure); }
      if (!this.alive || epoch !== this.epoch) return;
      this.loading = false; this.error = error;
      if (sources) {
        this.sources = orderedSources(sources);
        const ids = new Set(sources.map(source => source.id));
        this.selection = new Set([...this.selection].filter(key => ids.has(JSON.parse(key)[0])));
        for (const root of this.roots()) if (this.expanded.has(nodeKey(root))) this.load(root, taskCx);
      }
      taskCx.notify();
    });
  }
  load(node, cx) {
    const key = nodeKey(node), epoch = this.epoch;
    if (!expandable(node) || this.pending.has(key) || this.children.has(key)) return;
    this.pending.add(key); this.errors.delete(key); cx.notify();
    cx.spawn(async taskCx => {
      let nodes, error;
      try {
        const result = await request("db_catalog", { source_id: node.source_id,
          ...(node.kind !== "source" && node.database ? { database: node.database } : {}),
          ...(node.schema ? { schema: node.schema } : {}), ...(node.table ? { table: node.table } : {}) }, taskCx);
        if (!Array.isArray(result?.nodes)) throw new Error(T("The engine returned an invalid database catalog."));
        nodes = result.nodes.filter(child => ["database", "schema", "table", "view", "column"].includes(child.kind)).map(child => ({
          ...child, source_id: node.source_id, depth: node.depth + 1,
          database: child.database ?? (child.kind === "database" ? child.name : node.database),
          schema: child.schema ?? (child.kind === "schema" ? child.name : node.schema),
          table: child.table ?? (["table", "view"].includes(child.kind) ? child.name : node.table),
        }));
      } catch (failure) { error = message(failure); }
      if (!this.alive || epoch !== this.epoch || !this.sources.some(source => source.id === node.source_id)) return;
      this.pending.delete(key);
      if (error) this.errors.set(key, error);
      else {
        this.children.set(key, nodes);
        if (isIdea() && !this.groupSeen?.has(key)) {
          (this.groupSeen ??= new Set()).add(key);
          if (nodes.some(child => child.kind === "table")) this.expanded.add(JSON.stringify([node.source_id, "group", key, "table"]));
        }
        for (const child of nodes) if (this.expanded.has(nodeKey(child))) this.load(child, taskCx);
      }
      taskCx.notify();
    });
  }
  toggle(node, cx) {
    const key = node.key ?? nodeKey(node);
    if (!expandable(node)) return;
    if (this.expanded.has(key)) this.expanded.delete(key);
    else { this.expanded.add(key); if (node.kind !== "group") this.load(node, cx); }
    cx.notify();
  }
  select(node, event, cx) {
    if (!node) return;
    const rows = this.rows(), index = rows.findIndex(row => row.key === node.key), modifiers = event?.modifiers ?? {};
    if (modifiers.shift && this.anchor) {
      const start = rows.findIndex(row => row.key === this.anchor);
      const range = rows.slice(Math.min(start < 0 ? index : start, index), Math.max(start < 0 ? index : start, index) + 1);
      this.selection = new Set([...(modifiers.control || modifiers.platform ? this.selection : []), ...range.map(row => row.key)]);
    } else if (modifiers.control || modifiers.platform) {
      this.selection.has(node.key) ? this.selection.delete(node.key) : this.selection.add(node.key); this.anchor = node.key;
    } else { this.selection = new Set([node.key]); this.anchor = node.key; }
    this.current = node.key; this.menu.at = index; this.menu.focus.focus(); cx.notify();
  }
  activate(node, cx) {
    if (["table", "view"].includes(node.kind)) openDatabase({ source_id: node.source_id, kind: "table", database: node.database, schema: node.schema, table: node.table ?? node.name });
    else this.toggle(node, cx);
  }
  contextMenu(node, event, cx) {
    if (!this.selection.has(node.key)) this.select(node, {}, cx);
    const nodes = this.rows().filter(row => this.selection.has(row.key)).map(row => ({ source_id: row.source_id, kind: row.kind,
      name: row.name, database: row.database, schema: row.schema, table: row.table }));
    // Only a metadata snapshot crosses the overlay boundary; later selection changes cannot retarget an action.
    openOverlay({ mod: "codenav", props: { view: "database", variant: "menu", nodes }, kind: "popup", frame: "none", at: event?.position ?? "pointer", width: 280, height: 168 });
    cx.stop_propagation();
  }
  key(event, cx) {
    const rows = this.rows(), current = rows.find(row => row.key === this.current) ?? rows[this.menu.at];
    const key = event.key;
    if ((event.modifiers?.control || event.modifiers?.platform) && key === "a") {
      this.selection = new Set(rows.map(row => row.key)); cx.stop_propagation(); cx.notify(); return;
    }
    if (event.modifiers?.platform && key === "down" && ["table", "view"].includes(current?.kind)) {
      this.activate(current, cx); cx.stop_propagation(); return;
    }
    if (key === "right" && current) { if (!this.expanded.has(current.key)) this.toggle(current, cx); else {
      const child = rows[rows.indexOf(current) + 1]; if (child?.depth > current.depth) { this.select(child, event, cx); this.menu.ensureVisible(); }
    } cx.stop_propagation(); return; }
    if (key === "left" && current) {
      if (this.expanded.has(current.key)) this.toggle(current, cx);
      else { const index = rows.indexOf(current), parent = rows.slice(0, index).reverse().find(row => row.depth < current.depth); if (parent) { this.select(parent, event, cx); this.menu.ensureVisible(); } }
      cx.stop_propagation(); return;
    }
    if (key === "enter" && current) { this.activate(current, cx); cx.stop_propagation(); return; }
    const navigation = { ...event, keystroke: key };
    if (["up", "down", "home", "end", "pageup", "pagedown"].includes(key) && this.menu.key(navigation, cx, rows)) this.select(rows[this.menu.at], event, cx);
  }
  menuRows() {
    const nodes = this.snapshot ?? [], first = nodes[0], single = nodes.length === 1;
    const groups = new Map();
    for (const node of nodes) {
      const object = catalogObject(node); if (!object) continue;
      if (!groups.has(node.source_id)) groups.set(node.source_id, []);
      groups.get(node.source_id).push(object);
    }
    return [
      { id: "data", label: T("Open Data"), disabled: !single || !["table", "view"].includes(first?.kind), action: () => openDatabase({ source_id: first.source_id, kind: "table", database: first.database, schema: first.schema, table: first.table ?? first.name }) },
      { id: "console", label: T("New Query Console"), disabled: !first, action: () => openDatabase({ source_id: first.source_id, kind: "console", database: first.database, schema: first.schema }) },
      { id: "ddl", label: T("Generate DDL"), disabled: !groups.size, action: () => { for (const [source_id, objects] of groups) openDatabase({ source_id, kind: "ddl", objects }); } },
      { separator: true },
      { id: "edit", label: T("Edit Data Source…"), disabled: !first, action: () => openDatabaseManager({ source_id: first.source_id }) },
      { id: "manage", label: T("Data Sources…"), action: () => openDatabaseManager() },
    ];
  }
  render(cx) {
    if (this.snapshot) return uiMenu("database-context", this.menuRows(), this.menu, cx, { width: 280, maxHeight: 168, onClose: () => this.dismiss() });
    const rows = this.rows(), c = uiColors(), active = rows.find(row => row.key === this.current);
    const error = this.error || (active && this.errors.get(active.key));
    const context = active ?? rows[0];
    return ideaUI(v_flex()).size_full().min_h(0).bg(c.surface).text_color(c.foreground)
      .when(isIdea(), el => el.child(h_flex().flex_none().p(6).child(uiButton("database-console", T("SQL Console"), () => openDatabase({ source_id: context.source_id, kind: "console", database: context.database, schema: context.schema }), { small: true, disabled: !context }))))
      .when(this.loading, el => el.child(uiCaption(T("Loading data sources…"))))
      .when(Boolean(error), el => el.child(v_flex().flex_none().px(8).py(6).gap(4)
        .child(div().text_color(c.error).max_h(90).overflow_y_scrollbar().whitespace_normal().child(error))
        .child(uiButton("database-retry", T("Retry"), (_event, taskCx) => active && this.errors.has(active.key) ? this.load(active, taskCx) : this.refresh(taskCx), { small: true }))))
      .when(!rows.length && !this.loading && !this.error, el => el.child(v_flex().p(12).gap(8)
        .child(uiCaption(T("No data sources. Connections are shared across all spaces.")))
        .child(uiButton("database-create", T("New Data Source…"), () => openDatabaseManager({ newSource: true })))))
      .child(v_flex().id("database-tree-frame").flex_1().min_h(0).relative().track_focus(this.menu.focus)
        .on_key_down((event, taskCx) => this.key(event, taskCx))
        .on_mouse_down("left", event => { this.pointer = event; })
        .child(v_virtual_list("database-tree", rows.length, Math.max(IDEA.rowHeight, uiSize() + 8), index => rows[index].key,
          range => rows.slice(range.start, range.end).map(row => uiTreeRow(`database-node-${row.key}`, row.name, {
            depth: row.depth, selected: this.selection.has(row.key), expanded: expandable(row) ? this.expanded.has(row.key) : undefined,
            graphic: uiIcon(row.primary_key ? "key" : row.kind === "group" ? "folder" : NODE_ICONS[row.kind]),
            shortcut: row.kind === "group" ? `${row.count} ${T("loaded")}` : this.pending.has(row.key) ? T("Loading…") : this.errors.has(row.key) ? T("Error") : row.data_type ? `${row.data_type}${row.primary_key ? " · PK" : ""}` : row.kind === "source" ? row.driver : "",
          }).tooltip(this.errors.get(row.key) ?? row.name).cursor_pointer()
            .when(!this.selection.has(row.key), el => el.hover(style => style.bg(c.hover))))).size_full().track_scroll(this.menu.scroll)
          .on_item_click((key, taskCx) => {
            const node = rows.find(row => row.key === key); if (!node) return;
            const event = this.pointer; this.pointer = null; this.select(node, event, taskCx);
            const disclosure = isIdea() && event?.local_position && event.local_position.x >= node.depth * 14 + 8 && event.local_position.x < node.depth * 14 + 20;
            if (disclosure && expandable(node)) this.toggle(node, taskCx);
            else if (isIdea() && ["table", "view"].includes(node.kind)) { if (!event?.modifiers?.control && !event?.modifiers?.platform && !event?.modifiers?.shift) this.activate(node, taskCx); }
            else if (event?.click_count >= 2) { if (["table", "view"].includes(node.kind)) this.activate(node, taskCx); }
            else if (!event?.modifiers?.control && !event?.modifiers?.platform && !event?.modifiers?.shift && expandable(node)) this.toggle(node, taskCx);
          })
          .on_item_secondary_click((key, event, taskCx) => { const node = rows.find(row => row.key === key); if (node) this.contextMenu(node, event, taskCx); }))
        .child(Scrollbar.vertical("database-tree").absolute().inset_0()))
      .when(Boolean(active && this.expanded.has(active.key) && this.children.get(active.key)?.length === 0), el => el.child(uiCaption(T("No objects"))))
      .when(isIdea(), el => el.child(div().flex_none().p(8).text_size(uiSize(11)).text_color(c.secondary).whitespace_normal().child(T("Click a table to open it. Use its arrow to browse columns. Connections are shared across all spaces."))));
  }
}

export class DatabaseManager {
  init(p, cx) {
    this.overlay = p?.overlay; this.alive = true; this.generation = 0; this.sources = []; this.selected = null;
    this.driver = "postgres"; this.tls = "verify-full"; this.status = null; this.error = null; this.busy = null; this.passwordCleared = false; this.focusedField = null;
    this.menu = new MenuController(cx, 0); this.inputs = {}; this.drafts = new Map(); this.ownedInputs = new Set(); this.ownedPasswords = new Set();
    this.selectors = Object.fromEntries(["driver", "tls"].map(name => [name, { open: false, menu: new MenuController(cx), focus: cx.focus_handle() }]));
    this.search = InputState.new({ placeholder: T("Search data sources") }); this.search.on("change", (_event, taskCx) => taskCx.notify());
    this.orderDirty = false;
    this.inputs = this.createInputs();
    this.edit(null, cx); this.fetchSources(p?.source_id, p?.newSource, cx);
  }
  createInputs() {
    const inputs = {};
    for (const field of FIELDS) {
      const input = InputState.new({ placeholder: T(FIELD_LABELS[field]) }); inputs[field] = input; this.ownedInputs.add(input);
      input.on("change", (_event, taskCx) => { if (field === "password") this.passwordCleared = false; this.status = null; this.error = null; this.deleteArmed = false; ++this.formVersion; taskCx.notify(); });
      input.on("focus", (_event, taskCx) => { this.focusedField = field; taskCx.notify(); });
      input.on("blur", (_event, taskCx) => { if (this.focusedField === field) this.focusedField = null; taskCx.notify(); });
    }
    inputs.password.set_masked(true);
    this.ownedPasswords.add(inputs.password);
    return inputs;
  }
  retainDraft() {
    if (!isIdea() || !this.formReady) return;
    this.drafts.set(this.selected?.id ?? "new-source", { inputs: this.inputs, driver: this.driver, tls: this.tls,
      passwordCleared: this.passwordCleared, formVersion: this.formVersion });
  }
  discardDraft(id) {
    const draft = this.drafts.get(id);
    if (!draft) return;
    draft.inputs.password.set_value("");
    this.ownedPasswords.delete(draft.inputs.password);
    for (const input of Object.values(draft.inputs)) { input.release(); this.ownedInputs.delete(input); }
    this.drafts.delete(id);
  }
  release() {
    if (!this.alive) return;
    this.alive = false; ++this.generation;
    for (const input of this.ownedPasswords) input.set_value("");
    for (const input of this.ownedInputs) input.release();
    this.ownedInputs.clear(); this.ownedPasswords.clear(); this.drafts.clear();
    this.search.release();
    this.menu.release(); this.menu.focus.release();
    for (const selector of Object.values(this.selectors)) { selector.menu.release(); selector.menu.focus.release(); selector.focus.release(); }
  }
  dismiss() { this.release(); if (this.overlay) closeOverlay(this.overlay); }
  fetchSources(wanted, newSource, cx) {
    const generation = ++this.generation, formVersion = this.formVersion; this.loading = true; cx.notify();
    cx.spawn(async taskCx => {
      let sources, error;
      try { sources = sourcesFrom(await request("db_sources", {}, taskCx)); } catch (failure) { error = message(failure); }
      if (!this.alive || generation !== this.generation) return;
      this.loading = false;
      if (sources) {
        this.sources = orderedSources(sources);
        const selected = sources.find(source => source.id === wanted) ?? (!newSource ? sources[0] : null);
        if (selected && formVersion === this.formVersion) { this.edit(selected, taskCx); this.discardDraft("new-source"); }
      }
      this.error = error; taskCx.notify();
    });
  }
  edit(source, cx, reset = false) {
    if (this.busy) return;
    this.retainDraft();
    const id = source?.id ?? "new-source", cached = isIdea() && !reset ? this.drafts.get(id) : null;
    if (cached) {
      this.selected = source?.id ? publicSource(source) : null;
      Object.assign(this, cached); this.status = null; this.error = null; this.deleteArmed = false;
      for (const selector of Object.values(this.selectors)) selector.open = false;
      this.menu.at = Math.max(0, this.sources.findIndex(item => item.id === source?.id)); cx.notify(); return;
    }
    if (reset && isIdea()) this.discardDraft(id);
    if (isIdea() && this.formReady) this.inputs = this.createInputs();
    this.selected = source?.id ? publicSource(source) : null; this.driver = source?.driver ?? "postgres"; this.tls = source?.tls ?? (source ? "" : "verify-full");
    for (const selector of Object.values(this.selectors)) selector.open = false;
    for (const field of FIELDS) this.inputs[field].set_value(field === "password" ? "" : String(source?.[field] ?? (field === "port" ? DRIVERS.find(driver => driver.id === this.driver)?.port || "" : "")));
    this.passwordCleared = false; this.status = null; this.error = null; this.deleteArmed = false; this.formVersion = 0;
    this.formReady = true;
    this.retainDraft();
    this.menu.at = Math.max(0, this.sources.findIndex(item => item.id === source?.id)); cx.notify();
  }
  chooseDriver(driver, cx) {
    if (this.busy || this.driver === driver.id) return;
    this.driver = driver.id; this.inputs.port.set_value(driver.port ? String(driver.port) : "");
    ++this.formVersion; this.status = null; this.error = null; this.deleteArmed = false; cx.notify();
  }
  duplicate(cx) {
    if (this.busy || !this.selected?.id) return;
    // Duplicate metadata only; a new id never inherits another Keychain entry.
    const copy = this.draft(); delete copy.id; delete copy.password;
    copy.name = `${copy.name} ${T("Copy")}`;
    this.edit(copy, cx, true); this.inputs.name.focus();
  }
  moveSource(direction, cx) {
    if (this.busy || this.loading || this.search.value().trim()) return;
    const from = this.sources.findIndex(source => source.id === this.selected?.id), to = from + direction;
    if (from < 0 || to < 0 || to >= this.sources.length) return;
    const [source] = this.sources.splice(from, 1); this.sources.splice(to, 0, source);
    this.orderDirty = true; this.menu.at = to; this.menu.ensureVisible(); this.menu.focus.focus(); cx.notify();
  }
  saveOrder() {
    if (!this.orderDirty) return;
    const live = new Set(this.sources.map(source => source.id)), previous = shared(SOURCE_ORDER);
    // Keep unknown ids owned by another source refresh; no connection metadata is shared.
    setShared(SOURCE_ORDER, [...this.sources.map(source => source.id), ...(Array.isArray(previous) ? previous.filter(id => !live.has(id)) : [])]);
    this.orderDirty = false; changed();
  }
  clearPassword(cx) {
    if (this.busy || !this.selected?.has_password) return;
    this.inputs.password.set_value(""); this.passwordCleared = true;
    this.status = null; this.error = null; this.deleteArmed = false; ++this.formVersion; cx.notify();
  }
  passwordDescription() {
    if (this.passwordCleared) return T("The saved password will be removed when you click Save.");
    if (this.selected?.password_storage === "keychain") return T("A password is stored in macOS Keychain. Leave the password field blank to keep it.");
    if (window()?.platform === "macos") return T(this.selected?.has_password
      ? "A password is available in this engine session. Save to store it in macOS Keychain. Leave the password field blank to keep it."
      : "Passwords are stored in macOS Keychain when you save.");
    return T(this.selected?.has_password
      ? "A password is available in this engine session. Leave the password field blank to keep it. Passwords must be entered again after an engine restart."
      : "Passwords stay in this engine session only and must be entered again after an engine restart.");
  }
  draft(clearPassword = false) {
    const values = Object.fromEntries(FIELDS.map(field => [field, this.inputs[field].value()]));
    const source = { ...(this.selected?.id ? { id: this.selected.id } : {}), name: values.name.trim(), driver: this.driver };
    if (this.driver === "sqlite") source.path = values.path.trim();
    else {
      Object.assign(source, { host: values.host.trim(), port: Number(values.port), user: values.user, database: values.database.trim(), tls: this.tls });
      if (clearPassword && this.passwordCleared) source.password = "";
      else if (values.password) source.password = values.password;
    }
    return source;
  }
  validate(source) {
    if (!source.name) return T("Enter a data source name.");
    if (source.driver === "sqlite") return source.path ? null : T("Enter a SQLite database path.");
    if (!source.host) return T("Enter a host.");
    if (!Number.isInteger(source.port) || source.port < 1 || source.port > 65535) return T("Enter a port from 1 to 65535.");
    return null;
  }
  perform(method, cx) {
    if (this.busy || !this.alive) return;
    const source = this.draft(method === "db_save");
    const error = method === "db_delete" ? null : this.validate(source);
    if (error) { this.error = error; cx.notify(); return; }
    if (method === "db_delete" && !this.selected?.id) return;
    if (method === "db_delete" && !this.deleteArmed) { this.deleteArmed = true; cx.notify(); return; }
    const generation = this.generation, formVersion = this.formVersion;
    this.busy = method; this.error = null; this.status = null; this.deleteArmed = false; cx.notify();
    cx.spawn(async taskCx => {
      let result, failure;
      try { result = await request(method, method === "db_delete" ? { source_id: source.id } : { source }, taskCx); }
      catch (error) { failure = message(error); }
      if (!failure && method !== "db_test") changed();
      if (!this.alive || generation !== this.generation) return;
      this.busy = null;
      if (failure) this.error = failure;
      else if (method === "db_test") {
        if (formVersion === this.formVersion) this.status = result?.connected ? T("Connection successful.") : T("Connection was not established.");
      } else if (method === "db_save") {
        const saved = publicSource(result);
        if (!saved.id) this.error = T("The engine returned an invalid data source.");
        else {
          const index = this.sources.findIndex(item => item.id === saved.id);
          if (index < 0) this.sources.push(saved); else this.sources[index] = saved;
          this.saveOrder();
          if (formVersion === this.formVersion) {
            this.inputs.password.set_value("");
            this.edit(saved, taskCx, true);
            if (!source.id) this.discardDraft("new-source");
          }
          else this.selected = saved;
          this.status = T("Data source saved. Connection testing is optional.");
        }
      } else {
        this.sources = this.sources.filter(item => item.id !== source.id);
        this.inputs.password.set_value(""); this.edit(this.sources[0] ?? null, taskCx); this.discardDraft(source.id);
        this.status = T("Data source deleted.");
      }
      taskCx.notify();
    });
  }
  sidebar(cx) {
    if (isIdea()) return this.managedSidebar(cx);
    const rows = this.sources.map(source => ({ id: source.id, label: source.name, action: (_event, cx) => this.edit(source, cx), disabled: Boolean(this.busy) }));
    return v_flex().h_full().min_h(0).gap(6).py(8)
      .child(h_flex().px(8).gap(6).child(uiButton("db-new", T("New"), (_event, cx) => this.edit(null, cx), { small: true, disabled: Boolean(this.busy || this.loading) })))
      .when(this.loading, el => el.child(uiCaption(T("Loading…"))))
      .child(v_flex().flex_1().min_h(0).relative().track_focus(this.menu.focus)
        .on_key_down((event, cx) => this.menu.key(event, cx, rows, { closeOnActivate: false, onClose: () => this.dismiss() }))
        .child(v_virtual_list("db-manager-sources", rows.length, Math.max(IDEA.rowHeight, uiSize() + 8), index => rows[index].id,
          range => rows.slice(range.start, range.end).map(row => uiListRow(`db-profile-${row.id}`, row.label, { selected: row.id === this.selected?.id, disabled: row.disabled, interactive: true })))
          .size_full().track_scroll(this.menu.scroll).on_item_click((id, cx) => { const source = this.sources.find(item => item.id === id); if (source) this.edit(source, cx); }))
        .child(Scrollbar.vertical("db-manager-sources").absolute().inset_0()));
  }
  managedSidebar(cx) {
    const query = this.search.value().trim().toLocaleLowerCase(), blocked = Boolean(this.busy || this.loading);
    const at = this.sources.findIndex(source => source.id === this.selected?.id);
    const rows = this.sources.map(source => ({ id: source.id, label: (source.id === this.selected?.id ? this.inputs : this.drafts.get(source.id)?.inputs)?.name.value() || source.name,
      detail: source.id === this.selected?.id ? this.driver : this.drafts.get(source.id)?.driver ?? source.driver, icon: () => uiIcon("database", 16), disabled: blocked }));
    if (!this.selected || this.drafts.has("new-source")) rows.push({ id: "new-source", label: (this.selected ? this.drafts.get("new-source")?.inputs : this.inputs)?.name.value() || T("New Data Source"), detail: T("Unsaved"), icon: () => uiIcon("database", 16), disabled: blocked });
    return uiManagedList("db-manager-sources", rows.filter(row => `${row.label} ${row.detail}`.toLocaleLowerCase().includes(query)), this.menu, cx, {
      selectedId: this.selected?.id ?? "new-source", onSelect: (id, _event, eventCx) => {
        const source = this.sources.find(item => item.id === id); if (source || id === "new-source") this.edit(source ?? null, eventCx);
      }, onClose: () => this.dismiss(),
      search: uiInputBox(Input.new(this.search)),
      caption: this.loading ? T("Loading…") : query ? T("Clear search to change order.") : `${T("Global connections")} · ${this.sources.length}`,
      actions: [
        { id: "new", label: T("New"), icon: () => uiIcon("plus", 16), disabled: blocked, action: (_event, eventCx) => this.edit(null, eventCx) },
        { id: "delete", label: T("Delete"), icon: () => uiIcon("trash-2", 16), disabled: blocked || !this.selected?.id, action: (_event, eventCx) => this.perform("db_delete", eventCx) },
        { id: "duplicate", label: T("Duplicate"), icon: () => uiIcon("copy", 16), disabled: blocked || !this.selected?.id, action: (_event, eventCx) => this.duplicate(eventCx) },
        { id: "edit", label: T("Edit"), icon: () => uiIcon("pencil", 16), disabled: blocked, action: () => this.inputs.name.focus() },
        ...[-1, 1].map(direction => ({ id: direction < 0 ? "move-up" : "move-down", label: T(direction < 0 ? "Move Up" : "Move Down"),
          icon: () => uiIcon(direction < 0 ? "arrow-up" : "arrow-down", 16), shortcut: direction < 0 ? "Alt+↑" : "Alt+↓",
          disabled: blocked || Boolean(query) || at < 0 || at + direction < 0 || at + direction >= this.sources.length,
          action: (_event, eventCx) => this.moveSource(direction, eventCx) })),
      ],
    });
  }
  field(field, label, placeholder = "") {
    return h_flex().flex_none().gap(10).items_center()
      .child(div().w(isIdea() ? 84 : 105).flex_none().text_color(uiColors().secondary).child(T(label)))
      .child(uiInputBox(Input.new(this.inputs[field]).w_full(), { focused: this.focusedField === field }).flex_1().min_w(0))
      .when(Boolean(placeholder), el => el.tooltip(placeholder));
  }
  selector(name, label, options, cx) {
    const state = this.selectors[name], blocked = Boolean(this.busy || this.loading);
    const changeOpen = (open, eventCx) => {
      if (open && blocked) return;
      state.open = open;
      if (open) { state.menu.at = options.findIndex(option => option.id === this[name]); state.menu.ensureVisible(); state.menu.focus.focus(); }
      else state.focus.focus();
      eventCx.notify();
    };
    const rows = options.map(option => ({ id: option.id, label: T(option.label), disabled: blocked,
      icon: () => uiIcon(option.id === this[name] ? "check" : name === "driver" ? "database" : "shield", 14),
      action: (_event, eventCx) => {
        if (this.busy || this.loading) return;
        if (name === "driver") this.chooseDriver(option, eventCx);
        else { this.tls = option.id; ++this.formVersion; this.status = null; this.error = null; this.deleteArmed = false; eventCx.notify(); }
      } }));
    const selected = options.find(option => option.id === this[name]);
    const trigger = uiButton(`db-${name}`, T(selected?.label || label), (_event, eventCx) => changeOpen(!state.open, eventCx), { disabled: blocked, small: true })
      .w_full().justify_between().child(uiIcon("chevron-down", 12));
    return h_flex().flex_none().gap(10).items_center()
      .child(div().w(84).flex_none().text_color(uiColors().secondary).child(T(label)))
      .child(Select.new(`db-${name}-select`).accessibility_label(T(label)).open(state.open).track_focus(state.focus).content_focus_handle(state.menu.focus).on_open_change(changeOpen)
        .flex_1().min_w(0).child(Popup.new(`db-${name}-popup`, trigger).anchor("bottom_left")
          .when(state.open, el => el.content(uiMenu(`db-${name}-options`, rows, state.menu, cx, { width: 260, maxHeight: 220, onClose: (_event, eventCx) => changeOpen(false, eventCx) })))));
  }
  render(cx) {
    const c = uiColors(), network = this.driver !== "sqlite";
    const content = v_flex().id("db-manager-detail").h_full().min_h(0).gap(isIdea() ? 16 : 12).when(isIdea(), el => el.px(8).py(8))
      .child(div().font_semibold().child(isIdea() ? this.inputs.name.value() || T("New Data Source") : T(this.selected ? "Edit Data Source" : "New Data Source")))
      .when(!isIdea(), el => el.child(uiCaption(T("Connections are shared across all spaces.")))
        .child(h_flex().flex_none().gap(4).children(DRIVERS.map(driver => uiButton(`db-driver-${driver.id}`, driver.label, (_event, cx) => this.chooseDriver(driver, cx), { primary: driver.id === this.driver, small: true, disabled: Boolean(this.busy) })))))
      .child(v_flex().id("db-source-fields").flex_1().min_h(0).overflow_y_scrollbar().gap(10).pr(6)
        .child(this.field("name", "Name"))
        .when(isIdea(), el => el.child(this.selector("driver", "Database Type", DRIVERS, cx)))
        .when(network, el => el.child(this.field("host", "Host")).child(this.field("port", "Port")).child(this.field("user", "User"))
          .child(this.field("password", "Password"))
          .when(Boolean(this.selected?.has_password), row => row.child(uiButton("db-clear-password", T("Clear Saved Password"), (_event, cx) => this.clearPassword(cx), { small: true, disabled: Boolean(this.busy || this.passwordCleared) })))
          .child(this.field("database", "Database"))
          .child(isIdea() ? this.selector("tls", "TLS", TLS_OPTIONS, cx) : h_flex().gap(6).items_center().child(div().w(105).flex_none().text_color(c.secondary).child(T("TLS")))
            .children(TLS_OPTIONS.map(({ id: value, label }) => uiButton(`db-tls-${value || "default"}`, T(label), (_event, cx) => { if (!this.busy) { this.tls = value; ++this.formVersion; this.status = null; this.error = null; this.deleteArmed = false; cx.notify(); } }, { small: true, primary: this.tls === value, disabled: Boolean(this.busy) }))))
          .child(div().text_size(uiSize(11)).text_color(c.secondary).whitespace_normal().child(this.passwordDescription())))
        .when(!network, el => el.child(this.field("path", "Database path", T("Enter the SQLite database file path.")))))
      .when(Boolean(this.busy), el => el.child(uiCaption(T(this.busy === "db_test" ? "Testing connection…" : this.busy === "db_save" ? "Saving data source…" : "Deleting data source…"))))
      .when(Boolean(this.error), el => el.child(div().max_h(90).overflow_y_scrollbar().text_color(c.error).whitespace_normal().child(this.error)))
      .when(Boolean(this.status), el => el.child(div().text_color(c.secondary).whitespace_normal().child(this.status)))
      .when(isIdea(), el => el.child(uiCaption(T("Save applies to this profile. Close discards unsaved profile drafts."))))
      .when(Boolean(this.deleteArmed), el => el.child(div().text_color(c.error).whitespace_normal().child(T("Delete this saved data source? Click Delete again to confirm."))));
    return uiSettingsShell("database-manager", { title: T(isIdea() ? "Connection Manager" : "Data Sources and Drivers"), width: isIdea() ? 840 : 900, height: 680, sidebarWidth: isIdea() ? 250 : 210,
      sidebar: this.sidebar(cx), content, footer: [
        ...(!isIdea() ? [uiButton("db-delete", T("Delete"), (_event, cx) => this.perform("db_delete", cx), { disabled: !this.selected || Boolean(this.busy || this.loading) })] : []),
        uiButton("db-close", T("Close"), () => this.dismiss()),
        uiButton("db-test", T("Test Connection"), (_event, cx) => this.perform("db_test", cx), { disabled: Boolean(this.busy || this.loading) }),
        uiButton("db-save", T(isIdea() ? "Save Profile" : "Save"), (_event, cx) => this.perform("db_save", cx), { primary: true, disabled: Boolean(this.busy || this.loading) }),
      ] }).on_key_down((event, cx) => { if (event.key === "escape") { cx.stop_propagation(); this.dismiss(); } });
  }
}

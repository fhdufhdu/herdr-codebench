// Global database profiles and lazy catalog navigation. Credentials stay local
// to retained inputs and cross only the database service boundary on demand.
import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, InputState, Input } from "gpui-base";
import { shared, setShared, closeOverlay } from "herdr";
import { ADE, adeUI, adeSize, adeColors, adeRow, adeButton, adeInputBox, adeManagedList, adePanel, adeNote, MenuController } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { databaseService, DRIVERS, sourceDraft, validateSource, catalogKey, ddlSelection, openDatabaseDocument } from "./database-model.js";
import { currentProject } from "./workspace.js";

const ORDER = "ade.database.order";
const icon = name => uiIcon(name, 16);
const clean = source => { const value = { ...source }; delete value.password; return value; };
const sourceSpec = source => ({ id: source.id, name: source.name, driver: source.driver });
const ordered = sources => {
  const order = Array.isArray(shared(ORDER)) ? shared(ORDER) : [];
  return [...sources].sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : order.length) - (order.includes(b.id) ? order.indexOf(b.id) : order.length));
};
export function databaseDocumentSpec(source, node = null, selection = null) {
  if (selection !== null) return { kind: "ddl", source: sourceSpec(source), source_id: source.id, selection: ddlSelection(selection), title: `${source.name} · DDL` };
  return { kind: node ? "table" : "console", source: sourceSpec(source), source_id: source.id,
    database: node?.database ?? source.database ?? "", schema: node?.schema ?? "", table: node?.table || node?.name || "", table_type: node?.kind, entityKind: node?.kind, title: node?.name };
}

export class DatabaseTree {
  init(props, cx) {
    this.props = props; this.service = props.service ?? databaseService; this.menu = new MenuController(cx); this.focus = this.menu.focus;
    this.alive = true; this.generation = 0; this.sources = []; this.nodes = new Map(); this.expanded = new Set(); this.selected = null;
    this.objectSelection = new Map(); this.anchor = null; this.pointerModifiers = {};
    this.revision = shared("ade.database.changed");
    this.refreshJobs = [];
    // Render enqueues descriptors only. This retained task supplies its own
    // AsyncContext when a save in another view wakes the database tree.
    this.refreshWorker = cx.spawn(async taskCx => {
      for (;;) {
        if (!this.alive) break;
        if (this.refreshJobs.length) {
          const request = this.refreshJobs.pop(); this.refreshJobs.length = 0;
          if (request.revision === this.revision) this.refresh(taskCx);
        }
        if (!this.alive) break;
        await new Promise(resolve => { this.refreshWake = resolve; });
      }
    });
    this.refresh(cx);
  }
  release() {
    this.alive = false; this.generation++; this.refreshJobs.length = 0;
    const wake = this.refreshWake; this.refreshWake = null; wake?.(); this.refreshWorker?.cancel();
    this.menu.release(); this.focus.release();
  }
  scheduleRefresh(revision) {
    if (!this.alive || revision === this.revision) return;
    this.revision = revision; this.refreshJobs[0] = { revision };
    const wake = this.refreshWake; this.refreshWake = null; wake?.();
  }
  refresh(cx) {
    if (!this.alive) return;
    this.revision = shared("ade.database.changed"); this.refreshJobs.length = 0;
    const generation = ++this.generation; this.loading = true; this.error = ""; this.nodes.clear(); this.expanded.clear(); this.objectSelection.clear(); this.anchor = null; cx.notify();
    cx.spawn(async taskCx => {
      let sources = [], error = "";
      try { sources = (await this.service.sources(taskCx)).sources.map(clean); } catch (cause) { error = String(cause); }
      if (!this.alive || generation !== this.generation) return;
      this.sources = ordered(sources); this.loading = false; this.error = error; this.selected = this.sources[0] ? `source:${this.sources[0].id}` : null; taskCx.notify();
    });
  }
  load(source, node, cx) {
    const key = node ? catalogKey(source.id, node) : `source:${source.id}`, generation = this.generation;
    if (this.nodes.get(key)?.loading) return;
    this.nodes.set(key, { loading: true });
    cx.spawn(async taskCx => {
      let state;
      try {
        const result = await this.service.catalog(source.id, node, taskCx);
        state = { children: (result.nodes ?? []).map(child => ({ ...child, database: child.database || node?.database || (node?.kind === "database" ? node.name : ""), schema: child.schema || node?.schema || (node?.kind === "schema" ? node.name : "") })) };
      } catch (cause) { state = { error: String(cause) }; }
      if (!this.alive || generation !== this.generation) return;
      this.nodes.set(key, state); taskCx.notify();
    });
  }
  rows() {
    const rows = [];
    const children = (source, parent, depth, key) => {
      const state = this.nodes.get(key);
      if (!state?.children) { rows.push({ id: `${key}:state`, source, node: parent, depth, label: state?.error ? `읽기 실패 · 다시 시도: ${state.error}` : "불러오는 중…", retry: Boolean(state?.error), disabled: !state?.error }); return; }
      if (!state.children.length) { rows.push({ id: `${key}:empty`, depth, label: "개체가 없습니다", disabled: true }); return; }
      for (const kind of ["table", "view"]) {
        const items = state.children.filter(node => node.kind === kind);
        if (!items.length) continue;
        const group = `${key}:${kind}s`;
        rows.push({ id: group, source, node: parent, depth, label: kind === "table" ? "테이블" : "뷰", detail: String(items.length), group: true, expanded: this.expanded.has(group), icon: "folder" });
        if (this.expanded.has(group)) for (const node of items) rows.push({ id: catalogKey(source.id, node), source, node, depth: depth + 1, label: node.name, icon: kind === "table" ? "table" : "layers" });
      }
      for (const node of state.children.filter(node => !["table", "view"].includes(node.kind))) {
        const id = catalogKey(source.id, node), expandable = ["database", "schema"].includes(node.kind);
        rows.push({ id, source, node, depth, label: node.name, expanded: expandable ? this.expanded.has(id) : undefined, icon: expandable ? "layers" : "file-text", expandable });
        if (expandable && this.expanded.has(id)) children(source, node, depth + 1, id);
      }
    };
    for (const source of this.sources) {
      const id = `source:${source.id}`;
      rows.push({ id, source, depth: 0, label: source.name, detail: DRIVERS.find(driver => driver.id === source.driver)?.label ?? source.driver, icon: "database", expanded: this.expanded.has(id), expandable: true });
      if (this.expanded.has(id)) children(source, null, 1, id);
    }
    return rows;
  }
  activate(row, cx) {
    if (!row || row.disabled) return;
    this.selected = row.id;
    if (row.retry) this.load(row.source, row.node, cx);
    else if (row.group || row.expandable) {
      if (this.expanded.has(row.id)) this.expanded.delete(row.id);
      else { this.expanded.add(row.id); if (!row.group && !this.nodes.has(row.id)) this.load(row.source, row.node ?? null, cx); }
    } else if (["table", "view"].includes(row.node?.kind)) {
      const spec = databaseDocumentSpec(row.source, row.node);
      if (this.props.onOpen) this.props.onOpen(spec, cx); else openDatabaseDocument(spec, currentProject());
    }
    cx.notify();
  }
  objectRow(row) { return row && !row.disabled && !row.group && !row.retry && ["database", "schema", "table", "view"].includes(row.node?.kind); }
  choose(row, rows, modifiers, cx) {
    if (!row || row.disabled) return false;
    const additive = Boolean(modifiers?.platform || modifiers?.control), range = Boolean(modifiers?.shift);
    if (range && !rows.some(item => item.id === this.anchor)) this.anchor = rows.some(item => item.id === this.selected) ? this.selected : row.id;
    this.selected = row.id; this.menu.select(rows.findIndex(item => item.id === row.id), rows, cx);
    if (range) {
      if (!additive) this.objectSelection.clear();
      const at = rows.findIndex(item => item.id === row.id), from = rows.findIndex(item => item.id === this.anchor);
      for (const item of rows.slice(Math.min(at, from < 0 ? at : from), Math.max(at, from < 0 ? at : from) + 1)) if (this.objectRow(item)) this.objectSelection.set(item.id, item);
    } else {
      this.anchor = row.id;
      if (!additive) this.objectSelection.clear();
      if (this.objectRow(row)) {
        if (additive && this.objectSelection.has(row.id)) this.objectSelection.delete(row.id); else this.objectSelection.set(row.id, row);
      }
    }
    cx.notify(); return additive || range;
  }
  click(id, modifiers, cx) {
    const rows = this.rows(), row = rows.find(item => item.id === id); if (!row) return;
    this.focus.focus(); const selecting = this.choose(row, rows, modifiers, cx);
    if (!selecting) this.activate(row, cx);
  }
  openDDL(cx) {
    const groups = new Map();
    for (const row of this.objectSelection.values()) {
      if (!this.objectRow(row)) continue;
      if (!groups.has(row.source.id)) groups.set(row.source.id, { source: row.source, nodes: [] });
      groups.get(row.source.id).nodes.push(row.node);
    }
    for (const group of groups.values()) {
      const spec = databaseDocumentSpec(group.source, null, group.nodes);
      if (this.props.onOpen) this.props.onOpen(spec, cx); else openDatabaseDocument(spec, currentProject());
    }
    cx.notify();
  }
  key(event, cx) {
    const rows = this.rows(), entries = rows.map(row => ({ ...row, action: (_event, eventCx) => this.activate(row, eventCx) }));
    const chord = event.keystroke ?? event.key, key = event.key ?? chord.replace(/^(?:(?:cmd|ctrl|shift|alt)-)+/, ""), modifiers = event.modifiers ?? { shift: chord.includes("shift-"), control: chord.includes("ctrl-"), platform: chord.includes("cmd-") };
    const row = rows[this.menu.at], additive = modifiers.control || modifiers.platform;
    if (key === "a" && additive) {
      cx.stop_propagation(); this.objectSelection = new Map(rows.filter(item => this.objectRow(item)).map(item => [item.id, item])); cx.notify(); return;
    }
    if (key === "space" && (additive || modifiers.shift)) { cx.stop_propagation(); this.choose(row, rows, modifiers, cx); return; }
    if ((row?.group || row?.expandable) && ["left", "right"].includes(key) && !modifiers.shift && !additive) {
      cx.stop_propagation(); if ((key === "right") !== this.expanded.has(row.id)) this.activate(row, cx); return;
    }
    const navigation = ["up", "down", "home", "end", "pageup", "pagedown"].includes(key);
    this.menu.key(navigation ? { ...event, keystroke: key } : event, cx, entries, { closeOnActivate: false });
    const next = rows[this.menu.at];
    if (navigation && next) {
      if (additive && !modifiers.shift) this.selected = next.id; else this.choose(next, rows, modifiers, cx);
    } else this.selected = next?.id ?? this.selected;
  }
  render(cx) {
    this.scheduleRefresh(shared("ade.database.changed"));
    const rows = this.rows(), entries = rows.map(row => ({ ...row, action: (_event, eventCx) => this.activate(row, eventCx) }));
    this.menu.normalize(entries); const selected = rows.find(row => row.id === this.selected), source = selected?.source ?? this.sources[0], id = "ade-database-tree", height = Math.max(ADE.rowHeight, adeSize() + 12);
    return adeUI(v_flex()).size_full().min_h(0).min_w(0)
      .child(h_flex().flex_none().p(5).child(adeButton("database-console", "SQL 콘솔", (_event, eventCx) => {
        const spec = databaseDocumentSpec(source), node = selected?.node;
        if (node) { spec.database = node.database || (node.kind === "database" ? node.name : spec.database); spec.schema = node.schema || (node.kind === "schema" ? node.name : ""); }
        if (this.props.onConsole) this.props.onConsole(spec, eventCx); else openDatabaseDocument(spec, currentProject());
      }, { icon: icon("code"), disabled: !source }))
        .child(adeButton("database-ddl", this.objectSelection.size ? `DDL · ${this.objectSelection.size}` : "DDL", (_event, eventCx) => this.openDDL(eventCx), { icon: icon("file-text"), disabled: !this.objectSelection.size })))
      .when(this.loading, element => element.child(adeNote("연결을 불러오는 중…")))
      .when(Boolean(this.error), element => element.child(adeNote(this.error)).child(adeButton("database-retry", "다시 시도", (_event, eventCx) => this.refresh(eventCx))))
      .when(!this.loading && !this.error && !rows.length, element => element.child(adeNote("연결이 없습니다. 도구 헤더의 + 또는 연결 관리에서 추가하세요.")))
      .child(v_flex().flex_1().min_h(0).relative().track_focus(this.focus)
        .on_mouse_down("left", event => { this.pointerModifiers = event.modifiers; this.focus.focus(); })
        .on_key_down((event, eventCx) => this.key(event, eventCx))
        .child(v_virtual_list(id, rows.length, height, index => rows[index].id, range => rows.slice(range.start, range.end).map((row, offset) => adeRow(`db-${row.id}`, row.label, {
          indent: row.depth * 16, icon: row.icon ? icon(row.icon) : undefined, detail: row.detail, selected: this.objectSelection.has(row.id) || this.menu.at === range.start + offset, strong: row.depth === 0,
          leading: row.expanded === undefined ? div().w(16) : icon(row.expanded ? "chevron-down" : "chevron-right"),
        }).when(Boolean(row.disabled), element => element.text_color(adeColors().disabled))))
          .size_full().track_scroll(this.menu.scroll)
          .on_item_click((key, eventCx) => { eventCx.stop_propagation(); const modifiers = this.pointerModifiers; this.pointerModifiers = {}; this.click(key, modifiers, eventCx); }))
        .child(Scrollbar.vertical(id).absolute().inset_0()))
      .child(adeNote("테이블 클릭 · 문서 열기 / Cmd·Ctrl 클릭 · 추가 선택 / Shift · 범위 선택 / DDL · 선택한 개체의 생성문 열기"));
  }
}

const FIELDS = ["name", "host", "port", "user", "database", "path", "password"];
const TLS = [{ id: "disable", label: "사용 안 함" }, { id: "require", label: "필수" }, { id: "verify-full", label: "인증서 검증" }];
export class DatabaseManager {
  init(props, cx) {
    this.props = props; this.service = props.service ?? databaseService; this.alive = true; this.generation = 0; this.sources = []; this.original = new Map(); this.passwords = new Map(); this.removed = new Set();
    this.menu = new MenuController(cx); this.selectorMenu = new MenuController(cx); this.focus = this.menu.focus; this.selected = null; this.busy = false; this.loading = false; this.error = ""; this.message = ""; this.selector = null; this.nextId = 0;
    this.inputs = Object.fromEntries(FIELDS.map(field => {
      const input = InputState.new({ placeholder: field === "password" ? "비워 두면 저장된 암호 유지" : "" });
      if (field === "password") input.set_masked(true);
      input.on("change", (_event, eventCx) => {
        if (this.filling || this.busy) return; const source = this.sources.find(item => item.id === this.selected); if (!source) return;
        if (field === "password") { if (input.value()) this.passwords.set(source.id, input.value()); else this.passwords.delete(source.id); }
        else source[field] = input.value();
        this.message = "적용 전 변경입니다."; this.error = ""; eventCx.notify();
      }); return [field, input];
    }));
    this.refresh(cx);
  }
  release() { this.alive = false; this.generation++; this.filling = true; this.passwords.clear(); this.inputs.password.set_value(""); Object.values(this.inputs).forEach(input => input.release()); this.menu.release(); this.focus.release(); this.selectorMenu.release(); this.selectorMenu.focus.release(); }
  refresh(cx) {
    const generation = ++this.generation; this.loading = true; this.error = ""; cx.notify();
    cx.spawn(async taskCx => {
      try {
        const response = await this.service.sources(taskCx); if (!this.alive || generation !== this.generation) return;
        this.sources = ordered(response.sources.map(source => sourceDraft(clean(source)))); this.original = new Map(this.sources.map(source => [source.id, JSON.stringify(source)]));
        this.passwords.clear(); this.removed.clear(); this.loading = false; this.select(this.sources[0]?.id ?? null, taskCx); if (this.props.add) { this.props.add = false; this.add(taskCx); }
      } catch (cause) { if (this.alive && generation === this.generation) this.error = String(cause); }
      if (this.alive && generation === this.generation) { this.loading = false; taskCx.notify(); }
    });
  }
  select(id, cx) {
    this.selected = id; this.selector = null; const source = this.sources.find(item => item.id === id); this.filling = true;
    for (const field of FIELDS) this.inputs[field].set_value(field === "password" ? this.passwords.get(id) ?? "" : String(source?.[field] ?? ""));
    this.filling = false; this.menu.at = this.sources.findIndex(item => item.id === id); this.menu.ensureVisible(); cx.notify();
  }
  add(cx, copy = null) {
    if (this.busy || this.loading) return;
    const source = sourceDraft(copy ? { ...clean(copy), name: `${copy.name} 복사`, has_password: false, password_storage: "none" } : { name: "새 연결" });
    source.id = `draft:${++this.nextId}`; this.sources.push(source); this.select(source.id, cx);
  }
  remove(cx) {
    if (this.busy) return; const at = this.sources.findIndex(source => source.id === this.selected); if (at < 0) return;
    const [source] = this.sources.splice(at, 1); if (this.original.has(source.id)) this.removed.add(source.id); this.passwords.delete(source.id);
    this.select(this.sources[Math.min(at, this.sources.length - 1)]?.id ?? null, cx);
  }
  move(offset, cx) {
    if (this.busy) return; const at = this.sources.findIndex(source => source.id === this.selected), next = at + offset;
    if (at < 0 || next < 0 || next >= this.sources.length) return;
    [this.sources[at], this.sources[next]] = [this.sources[next], this.sources[at]]; this.menu.ensureVisible(next); cx.notify();
  }
  payload(source) {
    const value = { ...source, port: Number(source.port ?? 0) }; if (!this.original.has(source.id)) delete value.id;
    if (this.passwords.has(source.id)) value.password = this.passwords.get(source.id); return value;
  }
  choose(value, cx, pointer = false) {
    const source = this.sources.find(item => item.id === this.selected); if (!source || this.busy) return;
    if (this.selector === "driver") { const previous = DRIVERS.find(driver => driver.id === source.driver); if (!Number(source.port) || Number(source.port) === previous?.port) source.port = DRIVERS.find(driver => driver.id === value)?.port ?? 0; source.driver = value; }
    else source.tls = value;
    const selector = this.selector; this.select(source.id, cx); this.selector = pointer ? null : selector; if (!pointer) this.selectorMenu.focus.focus(); cx.notify();
  }
  test(cx) {
    const source = this.sources.find(item => item.id === this.selected); if (!source || this.busy) return;
    const payload = this.payload(source), errors = validateSource(payload); if (Object.keys(errors).length) { this.error = Object.values(errors).join(" "); cx.notify(); return; }
    this.busy = true; this.error = ""; this.message = "연결을 테스트하는 중…"; cx.notify();
    cx.spawn(async taskCx => {
      try { await this.service.test(payload, taskCx); if (this.alive) this.message = "연결 테스트에 성공했습니다. 프로필은 아직 적용하지 않았습니다."; }
      catch (cause) { if (this.alive) { this.error = String(cause); this.message = ""; } }
      finally { this.busy = false; if (this.alive) taskCx.notify(); }
    });
  }
  apply(cx) {
    if (this.busy || this.loading) return;
    const changed = this.sources.filter(source => this.original.get(source.id) !== JSON.stringify(source) || this.passwords.has(source.id));
    const errors = changed.flatMap(source => Object.values(validateSource(this.payload(source))));
    if (errors.length) { this.error = errors.join(" "); cx.notify(); return; }
    this.busy = true; this.error = ""; this.message = "연결을 적용하는 중…"; cx.notify();
    cx.spawn(async taskCx => {
      try {
        for (const source of changed) {
          const id = source.id, result = sourceDraft(clean(await this.service.save(this.payload(source), taskCx))), at = this.sources.findIndex(item => item.id === id);
          this.passwords.delete(id); this.original.delete(id); this.original.set(result.id, JSON.stringify(result)); if (at >= 0) this.sources[at] = result; if (this.selected === id) this.selected = result.id;
        }
        for (const id of [...this.removed]) { await this.service.remove(id, taskCx); this.removed.delete(id); this.original.delete(id); }
        const old = Array.isArray(shared(ORDER)) ? shared(ORDER) : [], ids = this.sources.map(source => source.id);
        setShared(ORDER, [...ids, ...old.filter(id => !ids.includes(id) && this.original.has(id))]);
        if (this.alive) { this.select(this.selected, taskCx); this.message = "연결을 적용했습니다."; }
      } catch (cause) { if (this.alive) { this.error = String(cause); this.message = "이미 저장된 항목은 유지하며 나머지 변경은 적용 전 상태입니다."; } }
      finally { setShared("ade.database.changed", Number(shared("ade.database.changed") || 0) + 1); this.busy = false; if (this.alive) taskCx.notify(); }
    });
  }
  render(cx) {
    const source = this.sources.find(item => item.id === this.selected), at = this.sources.indexOf(source), choices = this.selector === "driver" ? DRIVERS : TLS;
    const action = (id, label, name, callback, disabled = false) => ({ id, label, icon: () => icon(name), action: (_event, eventCx) => callback(eventCx), disabled: this.busy || this.loading || disabled });
    const field = (key, label) => v_flex().flex_none().gap(4).child(div().child(label)).child(adeInputBox(Input.new(this.inputs[key])));
    const selector = (kind, label) => adeButton(`db-${kind}`, label, (_event, eventCx) => { this.selector = this.selector === kind ? null : kind; if (this.selector) this.selectorMenu.focus.focus(); eventCx.notify(); }, { icon: icon("chevron-down"), disabled: this.busy });
    const body = v_flex().flex_1().min_h(0)
      .when(this.loading, element => element.child(adeNote("전역 연결을 불러오는 중…")))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .child(v_flex().w(260).h_full().min_h(0).flex_none().child(adeManagedList("database-profiles", this.sources.map(item => ({ id: item.id, label: item.name, detail: DRIVERS.find(driver => driver.id === item.driver)?.label, icon: () => icon("database") })), this.menu, cx, {
          selectedId: this.selected, onSelect: (id, _event, eventCx) => { if (!this.busy) this.select(id, eventCx); },
          rowActions: () => [
            { id: "copy", label: "연결 복사", icon: () => icon("copy"), disabled: this.busy || this.loading,
              action: (id, _event, eventCx) => { const source = this.sources.find(item => item.id === id); if (source) this.add(eventCx, source); } },
            { id: "remove", label: "연결 제거 · 적용 전 초안", icon: () => icon("trash-2"), disabled: this.busy || this.loading,
              action: (id, _event, eventCx) => { if (this.sources.some(item => item.id === id)) { this.select(id, eventCx); this.remove(eventCx); } } },
          ],
          actions: [action("add", "추가", "plus", eventCx => this.add(eventCx)), action("remove", "제거", "trash-2", eventCx => this.remove(eventCx), !source), action("copy", "복사", "copy", eventCx => this.add(eventCx, source), !source), action("move-up", "위로", "chevron-up", eventCx => this.move(-1, eventCx), at <= 0), action("move-down", "아래로", "chevron-down", eventCx => this.move(1, eventCx), at < 0 || at >= this.sources.length - 1)],
        })))
        .child(v_flex().id("database-profile-details").flex_1().h_full().min_h(0).min_w(0).overflow_y_scrollbar().p(16).gap(10)
          .when(!source, element => element.child(adeNote("왼쪽 툴바에서 연결을 추가하세요.")))
          .when(Boolean(source), element => element.child(field("name", "이름")).child(selector("driver", DRIVERS.find(driver => driver.id === source.driver)?.label ?? "DB 종류"))
            .when(this.selector !== null, parent => parent.child(v_flex().h(this.selector === "driver" ? 170 : 114).flex_none().min_h(0).child(adeManagedList("database-profile-selector", choices.map(choice => ({ id: choice.id, label: choice.label, disabled: this.busy })), this.selectorMenu, cx, {
              selectedId: source[this.selector], onSelect: (id, event, eventCx) => this.choose(id, eventCx, !event), onActivate: (id, _event, eventCx) => this.choose(id, eventCx, true), onClose: (_event, eventCx) => { this.selector = null; this.focus.focus(); eventCx.notify(); },
            }))))
            .when(source.driver === "sqlite", parent => parent.child(field("path", "파일 · 절대 경로")))
            .when(source.driver !== "sqlite", parent => parent.child(field("host", "호스트")).child(field("port", "포트")).child(field("user", "사용자")).child(field("database", "기본 데이터베이스"))
              .child(field("password", "비밀번호")).child(selector("tls", `TLS · ${TLS.find(option => option.id === source.tls)?.label ?? source.tls}`))
              .child(adeButton("clear-database-password", "저장된 비밀번호 지우기", (_event, eventCx) => { this.passwords.set(source.id, ""); this.filling = true; this.inputs.password.set_value(""); this.filling = false; this.message = "비밀번호 삭제 예정 · 적용 후 반영됩니다."; eventCx.notify(); }, { disabled: this.busy || !source.has_password })))
            .child(adeNote(source.has_password ? `비밀번호 보관 · ${source.password_storage === "keychain" ? "macOS 키체인" : source.password_storage === "session" ? "현재 세션" : source.password_storage || "엔진"}` : "저장된 비밀번호 없음"))
            .child(adeNote("연결 프로필은 모든 프로젝트에서 공유합니다. 저장된 암호는 표시하거나 shared state에 저장하지 않습니다.")))))
      .when(Boolean(this.error || this.message || this.removed.size), element => element.child(adeNote(this.error || this.message || `연결 ${this.removed.size}개 삭제 예정`)))
      .when(Boolean(this.error && !this.sources.length), element => element.child(adeButton("database-manager-retry", "다시 시도", (_event, eventCx) => this.refresh(eventCx), { disabled: this.busy })))
      .child(h_flex().flex_none().p(10).gap(6).justify_end()
        .child(adeButton("database-cancel", "취소", () => closeOverlay(this.props.overlay), { disabled: this.busy }))
        .child(adeButton("database-test", "연결 테스트", (_event, eventCx) => this.test(eventCx), { kind: "outline", disabled: this.busy || !source }))
        .child(adeButton("database-apply", this.busy ? "처리 중…" : "적용", (_event, eventCx) => this.apply(eventCx), { kind: "primary", disabled: this.busy || this.loading })));
    return adePanel("database-manager", "연결 관리 · 전역", body).size_full();
  }
}

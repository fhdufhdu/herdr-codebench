import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, h_resizable, resizable_panel } from "gpui-base";
import { shared, setShared, readTextFile, writeTextFile, closeOverlay, openOverlay, run, window as appWindow } from "herdr";
import { adeUI, adeColors, adeSize, adeButton, adeTab, adeNote, adeInputBox, MenuController, adeManagedList } from "./idea-design.js";
import { IDEA_TOKENS } from "./idea-tokens.js";
import { uiIcon } from "./ui-icons.js";
import { CodeInput } from "./code-input.js";
import { SQLAssist } from "./sql-assist.js";
import { SQLCatalog } from "./sql-catalog.js";
import { currentProject, projectKey } from "./workspace.js";
import { databaseService, databaseDocumentState, openDatabaseDocument, selectDatabaseDocument, closeDatabaseDocument,
  databaseExecutionState, selectDatabaseExecution, closeDatabaseExecution, publishDatabaseExecution, sqlExecutionSummary, sqlResultTitle, QueryJob, TableChanges, SQLScript, DRIVERS } from "./database-model.js";
import { orderColumns } from "./sql-completion.js";
import { tablePage, cycleOrder, resultTarget } from "./database-grid.js";
import { extractData, parseImport, prepareImport } from "./data-extract.js";

const columnName = column => typeof column === "string" ? column : column.name;
const targetOf = spec => ({ source_id: spec.source_id, database: spec.database, schema: spec.schema, table: spec.table });
const dataVersionKey = spec => JSON.stringify([spec.source_id, spec.database ?? "", spec.schema ?? "", spec.table ?? ""]);
const dataVersion = spec => Number(shared("ade.database-data-changed")?.[dataVersionKey(spec)] ?? 0);
function publishDataChange(spec) {
  const versions = shared("ade.database-data-changed") ?? {}, key = dataVersionKey(spec);
  setShared("ade.database-data-changed", { ...versions, [key]: Number(versions[key] ?? 0) + 1 });
}
const caption = text => div().text_size(adeSize(11)).text_color(adeColors().secondary).child(text);
const statusText = state => ({ queued: "대기", running: "실행 중", completed: "완료", failed: "실패", cancelled: "취소" }[state] ?? state);
const activeJob = state => ["queued", "running"].includes(state);
const message = error => String(error?.message ?? error);
const titleOf = record => record.title || (record.spec.kind === "console" ? "SQL 콘솔" : record.spec.kind === "ddl" ? "DDL" : record.spec.table);
export const displayCell = value => value === null ? "NULL" : value && typeof value === "object"
  ? value.type === "binary" ? `[binary ${value.base64.length} base64]` : JSON.stringify(value) : String(value);
export function cellValue(text, original) {
  if (typeof original === "number") { const number = Number(text); if (!text.trim() || !Number.isFinite(number) || Number.isInteger(number) && !Number.isSafeInteger(number)) throw new Error("정밀한 숫자를 입력하세요."); return number; }
  if (typeof original === "boolean") { if (!["true", "false"].includes(text)) throw new Error("true 또는 false를 입력하세요."); return text === "true"; }
  return text;
}
function sqlTokens(text) {
  const colors = IDEA_TOKENS["herdr.ux"].syntax, tokens = [], re = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|LIMIT|OFFSET|AS|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|WITH|UNION|ALL|AND|OR|NOT|NULL|IS|BEGIN|COMMIT|ROLLBACK|RETURNING)\b|\b\d+(?:\.\d+)?\b/gi;
  for (const match of text.matchAll(re)) tokens.push({ from: match.index, to: match.index + match[0].length, color: /^--|^\/\*/.test(match[0]) ? colors.comment : match[0][0] === "'" ? colors.string : /^\d/.test(match[0]) ? colors.number : colors.keyword });
  return tokens;
}

function editCell(doc, row, column, cx) {
  if (doc.editing) {
    if (doc.editing.row === row && doc.editing.column === column) return;
    if (!stageCell(doc, cx)) return;
  }
  if (!doc.changes.editable(row) || doc.spec.table_type === "view") { doc.error = "기본 키가 있는 테이블 행만 수정할 수 있습니다."; cx.notify(); return; }
  const value = doc.grid.dataset.rows[row][column];
  if (value && typeof value === "object") { doc.error = "바이너리 셀은 이 편집기에서 수정할 수 없습니다."; cx.notify(); return; }
  doc.editing = { row, column, original: value }; doc.cell.set_value(value === null ? "" : String(value)); doc.cell.focus(); cx.notify();
}
function stageCell(doc, cx, setNull = false) {
  if (!doc.editing) return true;
  try {
    const { row, column, original } = doc.editing;
    doc.changes.update(row, columnName(doc.page.columns[column]), setNull ? null : cellValue(doc.cell.value(), original));
    doc.editing = null; previewCellChanges(doc); doc.error = ""; doc.grid.menu.focus.focus(); cx.notify(); return true;
  } catch (error) { doc.error = message(error); cx.notify(); return false; }
}
function previewCellChanges(doc) {
  const { selected, selectedCell, anchor, windowStart } = doc.grid, at = doc.grid.menu.at;
  doc.grid.update({ ...(doc.display ?? doc.page), rows: doc.page.rows.map((row, index) => row.map((value, col) => {
    const changes = doc.changes.changes.get(index)?.values; const name = columnName(doc.page.columns[col]);
    return changes && Object.hasOwn(changes, name) ? changes[name] : value;
  })) }); doc.grid.selected = selected; doc.grid.selectedCell = selectedCell; doc.grid.anchor = anchor; doc.grid.windowStart = windowStart; doc.grid.menu.at = at;
}

// Native grid shared by table documents, execution results and transfer preview.
export class DataGrid {
  init(id, cx, options = {}) {
    this.id = id; this.options = options; this.menu = new MenuController(cx); this.widths = [];
    this.manualWidths = Object.create(null); this.viewportWidth = 0;
    this.selected = new Set(); this.anchor = 0; this.format = "csv"; this.viewportHeight = 320; this.windowStart = 0; this.windowRows = 10;
  }
  release() { this.menu.release(); this.menu.focus.release(); }
  update(dataset) {
    if (dataset === this.dataset) return;
    this.dataset = dataset; this.selectedCell = null; this.selected.clear(); this.menu.at = 0; this.windowStart = 0;
    this.widths = (dataset?.columns ?? []).map(column => this.manualWidths[columnName(column)] ?? 140);
  }
  fitColumns() {
    const names = (this.dataset?.columns ?? []).map(columnName);
    const base = names.map(name => this.manualWidths[name] ?? (/email|url|address/i.test(name) ? 280 : /^id$|_id$/i.test(name) ? 80 : /name|title/i.test(name) ? 180 : /date|time|_at$/i.test(name) ? 160 : 140));
    const spare = Math.max(0, this.viewportWidth - 44 - base.reduce((sum, value) => sum + value, 0));
    const weights = names.map(name => Object.hasOwn(this.manualWidths, name) || /^id$|_id$/i.test(name) ? 0 : /email|url|address/i.test(name) ? 2 : 1);
    if (!weights.some(Boolean)) for (let at = names.length - 1; at >= 0; at--) if (!Object.hasOwn(this.manualWidths, names[at])) { weights[at] = 1; break; }
    const total = weights.reduce((sum, value) => sum + value, 0);
    return base.map((value, index) => value + (total ? spare * weights[index] / total : 0));
  }
  select(index, event, cx) {
    this.selectedCell = null;
    if (event.modifiers?.shift) this.selected = new Set(Array.from({ length: Math.abs(index - this.anchor) + 1 }, (_v, n) => Math.min(index, this.anchor) + n));
    else if (appWindow()?.platform === "macos" ? event.modifiers?.platform : event.modifiers?.control) { this.selected.has(index) ? this.selected.delete(index) : this.selected.add(index); this.anchor = index; }
    else { this.selected = new Set([index]); this.anchor = index; }
    this.menu.at = index; this.revealRow(index); this.menu.focus.focus(); cx.notify();
  }
  revealRow(index) {
    if (index < this.windowStart) this.windowStart = index;
    else if (index >= this.windowStart + this.windowRows) this.windowStart = index - this.windowRows + 1;
    this.windowStart = Math.max(0, Math.min(this.windowStart, Math.max(0, this.dataset.rows.length - this.windowRows)));
  }
  scrollRows(delta, cx) {
    if (this.options.beforeScroll && !this.options.beforeScroll(cx)) return;
    this.windowStart = Math.max(0, Math.min(this.windowStart + delta, Math.max(0, this.dataset.rows.length - this.windowRows)));
    cx.notify();
  }
  indices() { return [...this.selected].sort((a, b) => a - b); }
  copyCell(cx) {
    if (!this.selectedCell) return;
    const { row, column } = this.selectedCell;
    cx.write_to_clipboard(displayCell(this.dataset.rows[row][column]));
    this.options.onMessage?.("셀 값을 복사했습니다.", cx);
  }
  copy(cx, format = this.format) {
    try {
      const dataset = format.startsWith("sql-") && this.options.baseColumns ? { ...this.dataset, columns: this.options.baseColumns } : this.dataset;
      const text = extractData(dataset, { format, ...(this.options.extract ?? {}), rowIndices: this.selected.size ? this.indices() : undefined });
      cx.write_to_clipboard(text); this.options.onMessage?.("복사했습니다.", cx);
    } catch (error) { this.options.onMessage?.(message(error), cx); }
  }
  key(event, cx) {
    const primary = appWindow()?.platform === "macos" ? "cmd" : "ctrl";
    if (event.keystroke === `${primary}-c`) { this.selectedCell ? this.copyCell(cx) : this.copy(cx); cx.stop_propagation(); return; }
    if (event.keystroke === `${primary}-a`) { this.selectedCell = null; this.selected = new Set(this.dataset.rows.map((_row, i) => i)); cx.stop_propagation(); cx.notify(); return; }
    const shift = event.keystroke?.startsWith("shift-"), stroke = shift ? event.keystroke.slice(6) : event.keystroke;
    if (!["up", "down", "home", "end", "pageup", "pagedown"].includes(stroke)) return;
    if (this.options.beforeScroll && !this.options.beforeScroll(cx)) return;
    const rows = this.dataset.rows.map((_row, index) => ({ id: String(index), label: String(index) }));
    if (this.menu.key({ ...event, keystroke: stroke }, cx, rows)) {
      this.selectedCell = null;
      const index = this.menu.at;
      if (shift) this.selected = new Set(Array.from({ length: Math.abs(index - this.anchor) + 1 }, (_v, n) => Math.min(index, this.anchor) + n));
      else { this.selected = new Set([index]); this.anchor = index; }
      this.revealRow(index);
      cx.notify();
    }
  }
  render(cx, { editor, changes } = {}) {
    const c = adeColors(), data = this.dataset ?? { columns: [], rows: [] }, count = data.rows.length;
    this.widths = this.fitColumns();
    const dataWidth = this.widths.reduce((a, b) => a + b, 0), width = dataWidth + 44;
    const columnKey = JSON.stringify(this.widths.map(value => Math.round(value * 10) / 10)); this.columnKey = columnKey;
    this.windowRows = Math.max(1, Math.floor((this.viewportHeight - 16) / 28));
    this.windowStart = Math.max(0, Math.min(this.windowStart, Math.max(0, count - this.windowRows)));
    const end = Math.min(count, this.windowStart + this.windowRows);
    const row = index => h_flex().id(`${this.id}-row-${index}`).h(28).w(width).flex_none().items_center()
      .bg(this.selected.has(index) ? c.selection : c.editor).border_b(1).border_color(c.separator)
      .on_mouse_down("left", (event, eventCx) => this.select(index, event, eventCx))
      .child(div().w(44).h(28).flex_none().px(8).flex().items_center().justify_end().text_size(adeSize(11)).text_color(c.disabled).border_r(1).border_color(c.separator).child(String((this.options.rowOffset ?? 0) + index + 1)))
      .children(data.columns.map((column, col) => {
        const value = data.rows[index][col], active = editor?.row === index && editor?.column === col;
        const staged = changes?.changes.get(index)?.values, edited = staged && Object.hasOwn(staged, columnName(column));
        return div().w(this.widths[col]).h(28).flex_none().px(10).border_r(1).border_color(c.separator).flex().items_center().relative().overflow_hidden()
          .bg(this.selectedCell?.row === index && this.selectedCell?.column === col ? c.hover : "#00000000")
          .tooltip("클릭 후 ⌘C로 셀 값 복사 · 행 번호 클릭 후 ⌘C로 행 복사")
          .on_mouse_down("left", (event, eventCx) => { eventCx.stop_propagation(); this.select(index, event, eventCx); if (!event.modifiers?.shift && !event.modifiers?.platform && !event.modifiers?.control) this.selectedCell = { row: index, column: col }; eventCx.notify(); })
          .when(!active, element => element.child(div().min_w(0).truncate().font_family(shared("ade.preferences")?.editorFont || "monospace").text_size(14).text_color(value === null ? c.disabled : c.foreground)
            .when(value === null, text => text.italic()).child(displayCell(value))))
          .when(active, element => element.child(editor.element()))
          .when(edited, element => element.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(c.warning)))
          .on_click((event, eventCx) => { if (event.click_count === 2) this.options.onEdit?.(index, col, eventCx); });
      }));
    const headerColumns = data.columns.map((column, index) => {
      const sortIndex = (this.options.order ?? []).findIndex(term => term.column === columnName(column));
      const sort = this.options.order?.[sortIndex];
      const label = h_flex().h(28).w_full().px(10).gap(6).items_center().font_medium().text_color(c.secondary).bg(c.surface).border_r(1).border_b(1).border_color(c.separator)
        .when(Boolean(this.options.onSort), element => element.cursor_pointer().tooltip("클릭으로 ASC → DESC → 기본 · Option+클릭으로 정렬 열 추가").on_click((event, eventCx) => this.options.onSort(columnName(column), event.modifiers?.alt, eventCx)))
        .child(columnName(column))
        .when(Boolean(sort), element => element.child(uiIcon(sort?.direction === "DESC" ? "arrow-down" : "arrow-up", 12)).when(this.options.order.length > 1, item => item.child(caption(String(sortIndex + 1)))))
        .when((data.primary_keys ?? []).includes(columnName(column)), element => element.child(div().text_size(adeSize(10)).text_color(c.disabled).child("PK")));
      return resizable_panel().size(this.widths[index]).size_range(70).child(label);
    });
    const header = h_flex().h(28).w(width).flex_none().bg(c.surface)
      .child(div().w(44).h(28).flex_none().px(8).flex().items_center().justify_end().text_size(adeSize(11)).text_color(c.disabled).border_r(1).border_b(1).border_color(c.separator).child("#"))
      .child(h_resizable(`${this.id}-columns-${columnKey}`).h(28).w(dataWidth).flex_none()
        .on_resize((sizes, eventCx) => {
          if (this.columnKey !== columnKey) return;
          sizes.forEach((size, index) => { if (Math.abs(size - this.widths[index]) > 0.5) this.manualWidths[columnName(data.columns[index])] = size; }); eventCx.notify();
        })
        .children(headerColumns));
    return adeUI(v_flex()).id(this.id).flex_1().min_w(0).min_h(0).relative().track_focus(this.menu.focus)
      .on_size_change((size, eventCx) => { if (size.width > 0 && Math.abs(size.width - this.viewportWidth) > 0.5) { this.viewportWidth = size.width; eventCx.notify(); } })
      .on_key_down((event, eventCx) => this.key(event, eventCx))
      .child(v_flex().flex_1().min_h(0).min_w(0).overflow_x_scrollbar().child(header)
        .child(v_flex().id(`${this.id}-viewport`).flex_1().min_h(0).min_w(0)
          .on_size_change((size, eventCx) => { if (size.height > 0 && Math.abs(size.height - this.viewportHeight) > 0.5) { this.viewportHeight = size.height; this.windowRows = Math.max(1, Math.floor((size.height - 16) / 28)); this.revealRow(this.menu.at); eventCx.notify(); } })
          .on_scroll_wheel((event, eventCx) => {
            const y = Number(event.delta?.y) || 0, x = Number(event.delta?.x) || 0;
            if (!y || Math.abs(x) > Math.abs(y)) return;
            this.scrollRows(-Math.sign(y) * Math.max(1, Math.round(Math.abs(y) / 28)), eventCx); eventCx.stop_propagation();
          })
          .child(v_flex().w(width).h((end - this.windowStart) * 28).flex_none().children(Array.from({ length: end - this.windowStart }, (_item, offset) => row(this.windowStart + offset))))))
      .when(count > this.windowRows || this.selected.size > 0 && this.options.selectionFooter !== false, element => element.child(h_flex().h(28).flex_none().px(8).gap(6).items_center().border_t(1).border_color(c.separator)
        .child(caption(count > this.windowRows ? `${this.windowStart + 1}–${end} / ${count}행 · 선택 ${this.selected.size}행` : `선택 ${this.selected.size}행`).flex_1())
        .when(count > this.windowRows, footer => footer.child(adeButton(`${this.id}-previous`, "이전 구간", (_event, eventCx) => { this.scrollRows(-this.windowRows, eventCx); this.menu.focus.focus(); }, { disabled: this.windowStart === 0 }))
          .child(adeButton(`${this.id}-next`, "다음 구간", (_event, eventCx) => { this.scrollRows(this.windowRows, eventCx); this.menu.focus.focus(); }, { disabled: end === count })))))
      .when(!count, element => element.child(adeNote("표시할 행이 없습니다.")));
  }
}

export class DatabaseEditor {
  init(props, cx) {
    this.context = props.context ?? currentProject(); this.owner = props.owner; this.embedded = Boolean(props.embedded); this.alive = true; this.documents = new Map(); this.candidates = null;
    this.menu = new MenuController(cx); this.focus = this.menu.focus; this.error = ""; this.refresh(cx);
  }
  release() { this.alive = false; this.watchTimer?.cancel(); this.watchTimer = null; this.menu.release(); this.menu.focus.release(); for (const doc of this.documents.values()) { doc.assist?.release(); doc.input?.release(); doc.cell?.release(); doc.whereInput?.release(); doc.orderInput?.release(); doc.grid?.release(); } }
  refresh(cx, context = this.context) {
    this.context = context;
    for (const record of databaseDocumentState(context).tabs) {
      const key = JSON.stringify([projectKey(context), record.id]);
      if (!this.documents.has(key)) {
        const doc = { ...record, key, context: { ...context }, loading: true, error: "", generation: 0 };
        this.documents.set(key, doc); this.load(doc, cx);
      }
    }
    this.watchUpdates(cx);
    cx.notify();
  }
  watchUpdates(cx) {
    this.watchTimer?.cancel(); this.watchTimer = null;
    const doc = this.active();
    if (!this.alive || !doc || doc.spec.kind !== "table") return;
    const version = dataVersion(doc.spec);
    if (!doc.loading && doc.dataVersion !== version) {
      if (doc.changes?.dirty || doc.editing) {
        if (doc.noticedVersion !== version) { doc.notice = "테이블 데이터가 변경됐습니다. 현재 변경을 적용하거나 취소한 뒤 새로 읽습니다."; doc.dataNotice = true; doc.noticedVersion = version; cx.notify(); }
      } else this.load(doc, cx);
    }
    this.watchTimer = cx.timer.after(500, nextCx => { this.watchTimer = null; this.watchUpdates(nextCx); });
  }
  owns(doc) { return this.alive && this.documents.get(doc.key) === doc; }
  active() { return this.documents.get(JSON.stringify([projectKey(this.context), databaseDocumentState(this.context).active])); }
  document(id) { return this.documents.get(JSON.stringify([projectKey(this.context), id])); }
  title(id) { const record = databaseDocumentState(this.context).tabs.find(item => item.id === id); return record ? titleOf(record) : "Database"; }
  dirty(id) { const doc = this.document(id); return Boolean(doc && (doc.changes?.dirty || doc.editing || doc.spec.kind === "console" && doc.input?.value() !== doc.initial)); }
  activate(id, cx) { this.candidates = null; this.active()?.assist?.clear(); selectDatabaseDocument(id, this.context); this.refresh(cx); this.document(id)?.input?.focus(); }
  closeDocument(id, cx) { const doc = this.document(id); if (doc) return this.close(doc, cx); closeDatabaseDocument(id, this.context); cx.notify(); return true; }
  load(doc, cx) {
    if (doc.changes?.dirty) { doc.error = "먼저 변경을 적용하거나 취소하세요."; cx.notify(); return; }
    const generation = ++doc.generation; doc.loading = true; doc.error = "";
    const version = dataVersion(doc.spec);
    if (doc.dataNotice) { doc.notice = ""; doc.dataNotice = false; }
    cx.spawn(async taskCx => {
      try {
        const sources = await databaseService.sources(taskCx); if (!this.owns(doc) || generation !== doc.generation) return;
        doc.source = sources.sources.find(source => source.id === doc.spec.source_id);
        if (!doc.source) throw new Error("연결 정보를 찾을 수 없습니다.");
        if (doc.spec.kind === "table") {
          const started = Date.now();
          const page = await tablePage(databaseService, targetOf(doc.spec), doc.source, { limit: 200, offset: doc.offset ?? 0, where: doc.where ?? "", order: doc.order ?? "" }, taskCx, () => this.owns(doc) && generation === doc.generation);
          if (!page || !this.owns(doc) || generation !== doc.generation) return;
          doc.dataVersion = version; doc.elapsedMs = Date.now() - started; doc.page = page; doc.changes = new TableChanges(page);
          if (!doc.grid) { doc.grid = new DataGrid(); doc.grid.init(`ade-table-${doc.key}`, taskCx, { selectionFooter: false, onEdit: (row, column, eventCx) => this.edit(doc, row, column, eventCx), beforeScroll: eventCx => this.stage(doc, eventCx), onMessage: (text, eventCx) => { doc.notice = text; eventCx.notify(); } }); }
          if (!doc.whereInput) {
            doc.whereInput = InputState.new({ placeholder: "조건식 입력" }); doc.orderInput = InputState.new({ placeholder: "열 이름 ASC / DESC" });
            for (const input of [doc.whereInput, doc.orderInput]) input.on("submit", (_event, eventCx) => this.filter(doc, eventCx));
          }
          doc.grid.options.onSort = (column, additive, eventCx) => {
            if (doc.changes.dirty || doc.editing) { doc.error = "먼저 변경을 적용하거나 취소하세요."; eventCx.notify(); return; }
            try { doc.orderInput.set_value(cycleOrder(doc.orderInput.value(), column, additive, doc.source.driver)); this.filter(doc, eventCx); }
            catch (error) { doc.error = message(error); eventCx.notify(); }
          };
          doc.grid.options.extract = { driver: doc.source.driver, target: doc.spec, keyColumns: page.primary_keys };
          doc.grid.options.rowOffset = page.offset ?? doc.offset ?? 0;
          doc.grid.options.order = orderColumns(doc.order ?? "", doc.source.driver) ?? [];
          doc.grid.update(page);
          if (!doc.cell) { doc.cell = InputState.new(); doc.cell.on("submit", (_event, eventCx) => this.stage(doc, eventCx)); }
        } else {
          const ddl = doc.spec.kind === "ddl" ? await databaseService.ddl(doc.spec.source_id, doc.spec.selection, taskCx) : null;
          if (!this.owns(doc) || generation !== doc.generation) return;
          doc.assist?.release(); doc.input?.release(); doc.initial = ddl?.sql ?? "-- SQL을 입력하고 ⌘Enter로 실행 범위를 선택하세요.\n";
          doc.input = new CodeInput().init(doc.initial, taskCx, { readOnly: doc.spec.kind === "ddl",
            onExecute: doc.spec.kind === "console" ? eventCx => this.chooseSQL(doc, eventCx) : undefined,
            onChange: (text, _revision, eventCx) => { doc.input.tokens = sqlTokens(text); doc.assist?.trigger(eventCx); eventCx.notify(); },
            onSelection: (selection, eventCx) => doc.assist?.selection(selection, eventCx),
            onComplete: (request, eventCx) => doc.assist?.request(request, eventCx),
            onCommand: (command, eventCx) => doc.assist?.command(command, eventCx),
            onToggleComment: (request, eventCx) => doc.input.toggleLineComment("--", eventCx, { expectedRevision: request.revision }),
          });
          if (doc.spec.kind === "console") {
            doc.catalog = new SQLCatalog(databaseService, doc.source, doc.spec);
            doc.assist = new SQLAssist(taskCx, { input: doc.input, owner: this.owner, catalog: doc.catalog, driver: doc.source.driver,
              current: () => this.owns(doc) && this.active() === doc && projectKey(currentProject()) === projectKey(doc.context)
                && (shared("ade.editor-mode")?.[projectKey(doc.context)] ?? "database") === "database" });
          }
          doc.input.tokens = sqlTokens(doc.initial); doc.warnings = ddl?.warnings ?? [];
          if (doc.spec.kind === "console" && this.active() === doc && projectKey(currentProject()) === projectKey(doc.context)
            && shared("ade.editor-mode")?.[projectKey(doc.context)] === "database") doc.input.focus();
        }
      } catch (error) { if (this.owns(doc) && generation === doc.generation) doc.error = message(error); }
      finally { if (this.owns(doc) && generation === doc.generation) { doc.loading = false; taskCx.notify(); } }
    });
  }
  filter(doc, cx) {
    if (doc.changes.dirty || doc.editing) { doc.error = "먼저 변경을 적용하거나 취소하세요."; cx.notify(); return; }
    const where = doc.whereInput.value().trim(), order = doc.orderInput.value().trim();
    try {
      const statements = new SQLScript(`SELECT * FROM t${where ? ` WHERE (${where}\n)` : ""}${order ? ` ORDER BY ${order}` : ""}`, doc.source.driver).statements();
      if (statements.length !== 1) throw new Error("WHERE와 ORDER BY에는 절 내용만 입력하세요.");
      doc.where = where; doc.order = order; doc.offset = 0; this.load(doc, cx);
    } catch (error) { doc.error = message(error); cx.notify(); }
  }
  edit(doc, row, column, cx) { editCell(doc, row, column, cx); }
  stage(doc, cx, setNull = false) { return stageCell(doc, cx, setNull); }
  previewChanges(doc) { previewCellChanges(doc); }
  apply(doc, cx, after) {
    if (!this.stage(doc, cx) || !doc.changes.dirty || doc.applying) return;
    doc.applying = true; doc.error = ""; cx.notify();
    cx.spawn(async taskCx => {
      try { await doc.changes.apply(databaseService, targetOf(doc.spec), taskCx); publishDataChange(doc.spec); if (this.owns(doc)) { doc.notice = "변경을 적용했습니다."; this.load(doc, taskCx); after?.(taskCx); } }
      catch (error) { if (this.owns(doc)) doc.error = `반영 실패: ${message(error)} · 변경을 유지했습니다.`; }
      finally { if (this.owns(doc)) { doc.applying = false; taskCx.notify(); } }
    });
  }
  close(doc, cx, discard = false) {
    if (doc.applying) return false;
    if (!discard && (doc.changes?.dirty || doc.editing || doc.spec.kind === "console" && doc.input?.value() !== doc.initial)) { this.closing = doc; selectDatabaseDocument(doc.id, doc.context); cx.notify(); return false; }
    if (this.candidates?.doc === doc) this.candidates = null;
    closeDatabaseDocument(doc.id, doc.context); this.documents.delete(doc.key); doc.assist?.release(); doc.input?.release(); doc.cell?.release(); doc.whereInput?.release(); doc.orderInput?.release(); doc.grid?.release(); this.closing = null; cx.notify();
    return true;
  }
  chooseSQL(doc, cx) {
    doc.assist?.clear();
    try {
      if (doc.input.hasPendingText) throw new Error("입력 조합을 마친 뒤 실행 범위를 선택하세요.");
      const text = doc.input.value(), rows = new SQLScript(text, doc.source.driver).candidates(doc.input.selection());
      if (!rows.length) throw new Error("실행할 SQL이 없습니다.");
      this.candidates = { doc, text, rows }; this.candidateId = rows[0].id; this.menu.at = 0; this.menu.ensureVisible(); this.menu.focus.focus(); cx.notify();
    } catch (error) { doc.error = message(error); cx.notify(); }
  }
  refreshCatalog(doc, cx) {
    doc.assist?.clear();
    doc.catalog = new SQLCatalog(databaseService, doc.source, doc.spec); doc.assist.catalog = doc.catalog;
    const catalog = doc.catalog;
    cx.spawn(async taskCx => {
      const tables = await catalog.load(taskCx);
      if (!this.owns(doc) || doc.catalog !== catalog) return;
      doc.notice = catalog.error || `자동완성 스키마 · ${catalog.database} / ${catalog.schema} · 테이블·뷰 ${tables.length}개`;
      taskCx.notify();
    }, { owner: this.owner });
  }
  execute(doc, candidate, cx) {
    const pending = this.candidates; this.candidates = null;
    if (!this.owns(doc) || this.active() !== doc || projectKey(currentProject()) !== projectKey(doc.context)) return;
    if (!pending || pending.doc !== doc || doc.input.value() !== pending.text) { doc.error = "SQL이 변경됐습니다. 실행 범위를 다시 선택하세요."; cx.notify(); return; }
    if (doc.job?.running || doc.job?.starting) { doc.error = "현재 SQL 실행이 끝날 때까지 기다리세요."; cx.notify(); return; }
    doc.job = new QueryJob(databaseService, { context: doc.context, sourceName: doc.source.name, documentId: doc.id });
    cx.spawn(async taskCx => {
      try {
        await doc.job.start(targetOf(doc.spec), candidate.statements, taskCx);
        if (this.owns(doc)) doc.notice = "실행 결과는 아래 실행 결과에서 확인하세요.";
        run("ade.executions-changed");
        while (this.owns(doc) && doc.job.running) { await taskCx.sleep(750); if (this.owns(doc)) await doc.job.refresh(taskCx); }
      }
      catch (error) { if (this.owns(doc)) doc.error = message(error); }
      if (this.owns(doc)) taskCx.notify();
    });
    doc.input.focus(); cx.notify();
  }
  transfer(doc, mode, intent = "export") {
    openOverlay({ mod: "ade", props: { view: "database-transfer", mode, intent, context: doc.context, spec: doc.spec, source: { id: doc.source.id, name: doc.source.name, driver: doc.source.driver }, dataset: doc.grid.dataset, selection: doc.grid.indices() }, kind: "dialog", frame: "none", width: 860, height: 640 });
  }
  render(cx) {
    const c = adeColors(), metadata = databaseDocumentState(this.context), doc = this.active();
    const root = adeUI(v_flex()).id("ade-database-editor").size_full().min_w(0).min_h(0).relative().bg(c.editor)
      .track_focus(this.focus)
      .on_key_down((event, eventCx) => { if (doc?.spec.kind === "console" && event.keystroke === `${appWindow()?.platform === "macos" ? "cmd" : "ctrl"}-enter`) { eventCx.stop_propagation(); this.chooseSQL(doc, eventCx); } });
    if (metadata.tabs.length && !this.embedded) root.child(h_flex().flex_none().overflow_x_scroll().children(metadata.tabs.map(record => adeTab(`ade-db-tab-${record.id}`, titleOf(record), { selected: record.id === metadata.active, icon: uiIcon(record.spec.kind === "console" ? "terminal" : "database", 14), closeIcon: uiIcon("x", 12),
      onSelect: (_event, eventCx) => { selectDatabaseDocument(record.id, this.context); eventCx.notify(); }, onClose: (_event, eventCx) => { const item = this.documents.get(JSON.stringify([projectKey(this.context), record.id])); if (item) this.close(item, eventCx); } }))));
    if (!doc) return root.child(adeNote("Database에서 테이블이나 SQL 콘솔을 여세요."));
    const environment = doc.source?.environment || (doc.source?.driver === "sqlite" && doc.source.path && !doc.context.machine ? "로컬" : null);
    const driver = DRIVERS.find(item => item.id === doc.source?.driver)?.label ?? doc.source?.driver ?? "";
    root.child(h_flex().h(38).flex_none().items_center().gap(8).px(12).border_b(1).border_color(c.separator).text_color(c.secondary)
      .child(uiIcon("database", 15)).child(div().font_semibold().text_size(adeSize(12)).child(doc.source?.name ?? "연결 확인 중"))
      .child(caption(`/ ${driver} / ${doc.spec.schema || doc.spec.database || (doc.source?.driver === "sqlite" ? "main" : "스키마 미선택")}`).text_size(adeSize(12)))
      .when(Boolean(environment), element => element.child(div().px(7).py(2).rounded(4).bg(c.surface).text_size(adeSize(11)).text_color(environment === "로컬" ? c.success : c.secondary).child(environment)))
      .when(doc.spec.kind === "ddl" || doc.spec.table_type === "view" || doc.page && !doc.page.primary_keys?.length, element => element.child(h_flex().gap(4).items_center().px(7).py(2).rounded(4).bg(c.surface).text_size(adeSize(11)).child(uiIcon("lock", 11)).child("읽기 전용"))));
    if (doc.error) root.child(adeNote(doc.error));
    if (doc.error && !doc.page && !doc.input) root.child(adeButton("db-load-retry", "다시 불러오기", (_event, eventCx) => this.load(doc, eventCx), { disabled: doc.loading }));
    if (doc.loading) return root.child(adeNote("데이터베이스 문서를 불러오는 중…"));
    if (this.closing === doc) root.child(h_flex().flex_none().gap(7).px(12).py(8).child(caption("반영하지 않은 변경이 있습니다."))
      .when(Boolean(doc.changes?.dirty), element => element.child(adeButton("db-close-apply", "적용 후 닫기", (_event, eventCx) => this.apply(doc, eventCx, nextCx => this.close(doc, nextCx, true)), { disabled: doc.applying })))
      .child(adeButton("db-close-discard", "변경 버리고 닫기", (_event, eventCx) => this.close(doc, eventCx, true)))
      .child(adeButton("db-close-cancel", "돌아가기", (_event, eventCx) => { this.closing = null; eventCx.notify(); })));
    if (doc.notice) root.child(caption(doc.notice).px(12).py(4));
    if (doc.spec.kind === "table" && doc.page) {
      root.child(h_flex().h(40).flex_none().items_center().gap(8).px(12).bg(c.surface).border_b(1).border_color(c.separator)
        .child(uiIcon("table", 16)).child(div().font_semibold().child(doc.spec.table))
        .child(caption(`${doc.page.rows.length}행 · ${doc.elapsedMs}ms`).px(7).py(3).rounded(4).bg(c.editor)).child(div().flex_1())
        .child(adeButton("db-table-ddl", "DDL", (_event, eventCx) => { openDatabaseDocument({ ...doc.spec, kind: "ddl", selection: [{ ...doc.spec, kind: "table", name: doc.spec.table }] }, this.context); this.refresh(eventCx); }, { icon: uiIcon("code", 14) }))
        .child(adeButton("db-table-copy", "복사…", () => this.transfer(doc, "export", "copy"), { icon: uiIcon("copy", 14), tip: "형식을 선택해 복사 · 키보드 복사는 CSV" }))
        .child(adeButton("db-table-export", "내보내기", () => this.transfer(doc, "export"), { icon: uiIcon("download", 14) }))
        .child(adeButton("db-table-import", "가져오기", () => this.transfer(doc, "import"), { disabled: doc.spec.table_type === "view" }))
        .child(adeButton("db-table-refresh", null, (_event, eventCx) => this.load(doc, eventCx), { icon: uiIcon("refresh-cw", 14), tip: "새로고침", square: true, disabled: doc.changes.dirty || Boolean(doc.editing) })));
      root.child(h_flex().min_h(36).flex_none().px(12).gap(8).items_center()
        .child(caption("WHERE")).child(adeInputBox(Input.new(doc.whereInput)).flex_1())
        .child(caption("ORDER BY")).child(adeInputBox(Input.new(doc.orderInput)).flex_1())
        .child(adeButton("db-filter-apply", "조회", (_event, eventCx) => this.filter(doc, eventCx), { disabled: doc.loading || doc.changes.dirty || Boolean(doc.editing) }))
        .child(adeButton("db-cell-copy", "셀 복사", (_event, eventCx) => doc.grid.copyCell(eventCx), { disabled: !doc.grid.selectedCell })));
      if (doc.changes.dirty || doc.editing) root.child(h_flex().h(36).flex_none().px(12).gap(6).items_center().child(caption(`대기 중 변경 ${doc.changes.changes.size}행`))
        .child(adeButton("db-apply", "적용", (_event, eventCx) => this.apply(doc, eventCx), { kind: "primary", disabled: doc.applying }))
        .child(adeButton("db-revert", "취소", (_event, eventCx) => { doc.changes.revert(); doc.editing = null; this.previewChanges(doc); eventCx.notify(); }, { disabled: doc.applying }))
        .when(Boolean(doc.editing), element => element.child(adeButton("db-cell-null", "NULL", (_event, eventCx) => this.stage(doc, eventCx, true)))));
      root.child(doc.grid.render(cx, { changes: doc.changes, editor: doc.editing ? { ...doc.editing, element: () => div().flex_1().min_w(0)
        .on_mouse_down("left", (_event, eventCx) => eventCx.stop_propagation())
        .on_key_down((event, eventCx) => { if (event.keystroke === "escape") { doc.editing = null; eventCx.stop_propagation(); eventCx.notify(); } }).child(Input.new(doc.cell).w_full().h(26)) } : null }));
      if (doc.offset || doc.page.rows.length >= 200 || doc.grid.selected.size) root.child(h_flex().h(32).flex_none().gap(6).items_center().px(12).border_t(1).border_color(c.separator)
        .child(caption(doc.grid.selected.size ? `선택 ${doc.grid.selected.size}행` : `${(doc.offset ?? 0) + 1}–${(doc.offset ?? 0) + doc.page.rows.length}행`)).child(div().flex_1())
        .when(Boolean(doc.offset || doc.page.rows.length >= 200), element => element
          .child(adeButton("db-page-prev", "이전 페이지", (_event, eventCx) => { doc.offset = Math.max(0, (doc.offset ?? 0) - 200); this.load(doc, eventCx); }, { disabled: !doc.offset || doc.changes.dirty || Boolean(doc.editing) }))
          .child(adeButton("db-page-next", "다음 페이지", (_event, eventCx) => { doc.offset = (doc.offset ?? 0) + 200; this.load(doc, eventCx); }, { disabled: doc.page.rows.length < 200 || doc.changes.dirty || Boolean(doc.editing) }))));
    } else if (doc.input) {
      if (doc.spec.kind === "console") root.child(h_flex().h(40).flex_none().px(12).gap(8).items_center().child(adeButton("db-run-sql", "실행 범위 선택", (_event, eventCx) => this.chooseSQL(doc, eventCx), { kind: "primary", icon: uiIcon("play", 14), disabled: doc.job?.starting || doc.job?.running })).child(caption("⌘Enter 실행 · ⌃Space 자동완성")).child(div().flex_1())
        .child(adeButton("db-completion-schema", null, (_event, eventCx) => this.refreshCatalog(doc, eventCx), { icon: uiIcon("refresh-cw", 14), square: true, tip: "자동완성 스키마 새로 읽기", disabled: Boolean(doc.catalog?.loading) })));
      else root.child(h_flex().h(36).flex_none().px(12).items_center().child(caption(`DDL · ${(doc.spec.selection ?? []).length}개 선택`)).child(div().flex_1()).child(adeButton("db-copy-ddl", "복사", (_event, eventCx) => eventCx.write_to_clipboard(doc.input.value()))));
      for (const warning of doc.warnings ?? []) root.child(adeNote(warning));
      root.child(doc.input.render(cx, { completion: doc.assist?.render(cx) }));
    }
    if (this.candidates?.doc === doc) {
      const dismiss = (_event, eventCx) => { this.candidates = null; doc.input.focus(); eventCx.notify(); };
      const activate = (id, _event, eventCx) => { const candidate = this.candidates?.rows.find(item => item.id === id); if (candidate) this.execute(doc, candidate, eventCx); };
      root.child(v_flex().id("db-sql-candidates").absolute().left(20).top(100).w(620).h(Math.min(360, this.candidates.rows.length * 28 + 100)).rounded(6).border(1).border_color(c.separator).bg(c.popup)
        .on_mouse_down_out(dismiss)
        .child(h_flex().h(36).flex_none().px(12).items_center().child(caption("실행할 SQL 범위를 선택하세요.")).child(div().flex_1())
          .child(adeButton("db-sql-picker-close", null, dismiss, { icon: uiIcon("x", 14), tip: "닫기", square: true })))
        .child(adeManagedList("db-sql-choice-list", this.candidates.rows.map(candidate => ({ id: candidate.id, label: `${candidate.label} · ${candidate.text.replace(/\s+/g, " ").slice(0, 75)}`, detail: `${candidate.from}–${candidate.to}` })), this.menu, cx,
          { selectedId: this.candidateId, onSelect: (id, _event, eventCx) => { this.candidateId = id; eventCx.notify(); }, onActivate: activate, onClose: dismiss }))
        .child(h_flex().h(44).flex_none().px(12).items_center().justify_end().child(adeButton("db-sql-choice-run", "선택 범위 실행", (event, eventCx) => activate(this.candidateId, event, eventCx), { kind: "primary" }))));
    }
    return root;
  }
}

export class DatabaseResults {
  init(props, cx) {
    this.context = props.context ?? currentProject(); this.alive = true; this.cache = new Map(); this.grids = new Map(); this.resultIndex = new Map();
    this.embedded = Boolean(props.embedded); this.error = ""; this.busy = false;
    if (props.selectedId) selectDatabaseExecution(props.selectedId, this.context);
    this.refresh(cx);
  }
  release() { this.alive = false; this.timer?.cancel(); for (const grid of this.grids.values()) { grid.editDoc?.cell.release(); grid.release(); } }
  closeExecution(id, cx, context = this.context) {
    const prefix = `${projectKey(context)}:${id}:`;
    if ([...this.grids].some(([key, grid]) => key.startsWith(prefix) && (grid.editDoc?.changes.dirty || grid.editDoc?.editing || grid.editDoc?.applying))) {
      this.notice = "먼저 결과의 변경을 적용하거나 취소하세요."; cx.notify(); return false;
    }
    closeDatabaseExecution(id, context); return true;
  }
  select(id, cx) { selectDatabaseExecution(id, this.context); this.refresh(cx); cx.notify(); }
  refresh(cx, context = this.context) {
    this.context = context;
    if (!this.alive) return;
    if (this.busy) { this.refreshRequested = true; return; }
    this.timer?.cancel(); this.timer = null;
    const scope = projectKey(context), metadata = databaseExecutionState(context);
    const visible = metadata.records.filter(record => !record.closed);
    const selected = visible.find(record => record.id === metadata.activeId) ?? visible.at(-1);
    const wanted = visible.filter(record => {
      const key = `${scope}:${record.id}`, cached = this.cache.get(key);
      return activeJob(record.state) || record.id === selected?.id && (!cached || cached.state !== record.state || cached.results?.length && !this.grids.has(`${key}:0`));
    });
    if (!wanted.length) return;
    this.busy = true;
    cx.spawn(async taskCx => {
      let changed = false;
      try {
        for (const record of wanted) {
          const snapshot = await databaseService.job(record.jobId ?? record.id, taskCx);
          if (!this.alive) return;
          const key = `${scope}:${record.id}`, previous = this.cache.get(key);
          this.cache.set(key, snapshot);
          if (record.id === selected?.id) for (let index = 0; index < (snapshot.results?.length ?? 0); index++) this.grid(`${key}:${index}`, snapshot.results[index], taskCx, record);
          while (this.cache.size > 3) {
            const oldest = [...this.cache.keys()].find(item => item !== `${scope}:${selected?.id}` && ![...this.grids].some(([id, grid]) => id.startsWith(`${item}:`) && (grid.editDoc?.changes.dirty || grid.editDoc?.editing || grid.editDoc?.applying)));
            if (!oldest) break;
            this.cache.delete(oldest);
            for (const [id, grid] of this.grids) if (id.startsWith(`${oldest}:`)) { grid.editDoc?.cell.release(); grid.release(); this.grids.delete(id); }
          }
          const signature = value => JSON.stringify([value?.state, value?.current, value?.total, value?.elapsed_ms, value?.results?.length, value?.error]);
          changed = signature(previous) !== signature(snapshot) || changed;
          const statements = (snapshot.results ?? []).map(result => result.statement).filter(text => typeof text === "string" && text.trim());
          publishDatabaseExecution(context, snapshot, { spec: record.spec, name: record.name,
            queryLabel: record.queryLabel || (statements.length ? sqlExecutionSummary(statements) : undefined),
            sourceName: record.sourceName, startedAt: record.startedAt, documentId: record.documentId });
        }
        this.error = "";
      } catch (error) { this.error = `실행 상태 확인 실패: ${message(error)}`; changed = true; }
      finally {
        this.busy = false;
        if (this.alive) {
          if (changed) taskCx.notify();
          if (this.refreshRequested) { this.refreshRequested = false; this.refresh(taskCx); }
          else if (databaseExecutionState(this.context).records.some(record => !record.closed && activeJob(record.state))) this.timer = taskCx.timer.after(1000, nextCx => { this.timer = null; this.refresh(nextCx); });
        }
      }
    });
  }
  grid(key, data, cx, record) {
    if (!this.grids.has(key)) {
      const grid = new DataGrid(); grid.init(`ade-db-result-${key}`, cx, { onEdit: (row, column, eventCx) => this.editResult(grid, record, data, row, column, eventCx), beforeScroll: eventCx => !grid.editDoc || stageCell(grid.editDoc, eventCx), onMessage: (text, eventCx) => { this.notice = text; eventCx.notify(); } }); this.grids.set(key, grid);
    }
    const grid = this.grids.get(key); grid.options.extract = { target: record.spec, driver: this.driver ?? "sqlite" };
    if (!grid.dataset) grid.update(data); return grid;
  }
  editResult(grid, record, data, row, column, cx) {
    if (grid.preparing || grid.editDoc?.applying) return;
    if (grid.editDoc) { editCell(grid.editDoc, row, column, cx); return; }
    grid.preparing = true; this.notice = "수정할 원본 테이블을 확인하는 중…"; cx.notify();
    const context = { ...this.context };
    cx.spawn(async taskCx => {
      try {
        const origin = await resultTarget(databaseService, record, data, taskCx);
        if (!this.alive || ![...this.grids.values()].includes(grid)) return;
        if (!origin) throw new Error("원본 테이블과 기본 키를 확인할 수 있는 SELECT 결과에서 수정할 수 있습니다.");
        const doc = { ...origin, spec: origin.target, display: data, grid, changes: new TableChanges(origin.page), cell: InputState.new(), error: "" };
        doc.cell.on("submit", (_event, eventCx) => stageCell(doc, eventCx));
        grid.editDoc = doc; grid.options.baseColumns = origin.page.columns; grid.options.extract = { driver: origin.source.driver, target: origin.target, keyColumns: origin.page.primary_keys };
        if (projectKey(currentProject()) === projectKey(context)) editCell(doc, row, column, taskCx);
        this.notice = "";
      } catch (error) { if (this.alive) this.notice = message(error); }
      finally { grid.preparing = false; if (this.alive) taskCx.notify(); }
    });
  }
  applyResult(grid, cx) {
    const doc = grid.editDoc;
    if (!doc || !stageCell(doc, cx) || !doc.changes.dirty || doc.applying) return;
    doc.applying = true; doc.error = ""; cx.notify();
    cx.spawn(async taskCx => {
      try {
        await doc.changes.apply(databaseService, doc.spec, taskCx);
        publishDataChange(doc.spec);
        doc.page = { ...doc.page, rows: grid.dataset.rows.map(row => [...row]) };
        doc.display = { ...doc.display, rows: doc.page.rows };
        doc.changes = new TableChanges(doc.page);
        this.notice = "변경을 적용했습니다. 조건·정렬 결과를 갱신하려면 쿼리를 다시 실행하세요.";
      } catch (error) { doc.error = `반영 실패: ${message(error)} · 변경을 유지했습니다.`; }
      finally { doc.applying = false; if (this.alive) taskCx.notify(); }
    });
  }
  tooltip(id, context = this.context) {
    return (this.cache.get(`${projectKey(context)}:${id}`)?.results ?? []).map(result => result.statement).filter(Boolean).join("\n\n");
  }
  render(cx, { selectedId } = {}) {
    const c = adeColors(), metadata = databaseExecutionState(this.context), records = metadata.records.filter(record => !record.closed);
    const selected = records.find(record => record.id === (selectedId ?? metadata.activeId)) ?? records.at(-1), key = selected && `${projectKey(this.context)}:${selected.id}`;
    const snapshot = this.cache.get(key), result = snapshot?.results?.[this.resultIndex.get(key) ?? 0];
    const root = adeUI(v_flex()).id("ade-database-results").size_full().min_w(0).min_h(0).bg(c.editor);
    if (!selected) return root.child(adeNote("SQL 실행 결과가 없습니다."));
    if (!this.embedded) root.child(h_flex().h(38).flex_none().min_w(0).overflow_x_scroll().children(records.map(record => adeTab(`db-job-${record.id}`, sqlResultTitle(record), {
      selected: record.id === selected.id, onSelect: (_event, eventCx) => this.select(record.id, eventCx),
      closeIcon: uiIcon("x", 12), onClose: (_event, eventCx) => { this.closeExecution(record.id, eventCx); eventCx.notify(); },
    }).tooltip(this.tooltip(record.id) || `${record.sourceName ?? record.name} · ${statusText(record.state)}`))));
    root.child(h_flex().h(32).flex_none().px(12).items_center().gap(7).child(caption(`${selected.sourceName ?? selected.name ?? "SQL"} · ${statusText(snapshot?.state ?? selected.state)} · ${snapshot?.current ?? selected.current ?? 0}/${snapshot?.total ?? selected.total ?? 0} 구문 · ${snapshot?.elapsed_ms ?? selected.elapsed_ms ?? 0}ms`)).child(div().flex_1())
      .child(adeButton("db-result-refresh", "다시 확인", (_event, eventCx) => { this.cache.delete(key); this.refresh(eventCx); }, { disabled: this.busy }))
      .when(activeJob(snapshot?.state ?? selected.state), element => element.child(adeButton("db-result-cancel", "중지", (_event, eventCx) => {
        const context = { ...this.context };
        eventCx.spawn(async taskCx => { try { const state = await databaseService.cancel(selected.jobId ?? selected.id, taskCx); if (this.alive) { this.cache.set(key, state); publishDatabaseExecution(context, state); this.refresh(taskCx); taskCx.notify(); } } catch (error) { if (this.alive) { this.error = message(error); taskCx.notify(); } } });
      }))));
    if (this.error || snapshot?.error) root.child(adeNote(this.error || snapshot.error));
    if (!snapshot) return root.child(adeNote(this.error
      ? "이 실행의 결과를 현재 엔진에서 읽을 수 없습니다. 엔진이 재시작됐다면 SQL 콘솔에서 실행 범위를 확인하고 다시 실행하세요."
      : "실행 결과를 불러오는 중…"));
    if (!snapshot.results?.length) return root.child(adeNote(activeJob(snapshot.state) ? "쿼리를 실행하는 중…" : "표시할 결과 집합이 없습니다."));
    root.child(h_flex().h(32).flex_none().overflow_x_scroll().gap(4).px(8).children(snapshot.results.map((_item, index) => adeButton(`db-result-set-${index}`, `결과 ${index + 1}`, (_event, eventCx) => { this.resultIndex.set(key, index); eventCx.notify(); }, { selected: index === (this.resultIndex.get(key) ?? 0) }))));
    if (!result) return root;
    const grid = this.grids.get(`${key}:${this.resultIndex.get(key) ?? 0}`);
    if (!grid) return root.child(adeNote("결과 표를 준비하는 중…"));
    const doc = grid.editDoc;
    const transferData = doc ? { ...grid.dataset, columns: doc.page.columns } : grid.dataset;
    root.child(h_flex().h(34).flex_none().px(12).gap(6).items_center().child(caption(`${result.rows?.length ?? 0}행 · ${result.elapsed_ms ?? 0}ms${result.affected_rows != null ? ` · 영향 ${result.affected_rows}행` : ""}${result.truncated ? " · 일부 결과만 표시" : ""}`)).child(div().flex_1())
      .child(adeButton("db-result-cell-copy", "셀 복사", (_event, eventCx) => grid.copyCell(eventCx), { disabled: !grid.selectedCell }))
      .child(adeButton("db-result-copy", "복사…", () => openOverlay({ mod: "ade", props: { view: "database-transfer", mode: "export", intent: "copy", context: this.context, spec: doc?.spec ?? selected.spec, dataset: transferData, selection: grid.indices() }, kind: "dialog", frame: "none", width: 860, height: 640 }), { icon: uiIcon("copy", 14), tip: "형식을 선택해 복사 · 키보드 복사는 CSV" }))
      .child(adeButton("db-result-export", "내보내기", () => openOverlay({ mod: "ade", props: { view: "database-transfer", mode: "export", context: this.context, spec: doc?.spec ?? selected.spec, dataset: transferData, selection: grid.indices() }, kind: "dialog", frame: "none", width: 860, height: 640 }))));
    if (this.notice) root.child(caption(this.notice).px(12));
    if (doc?.error) root.child(adeNote(doc.error));
    if (doc && (doc.changes.dirty || doc.editing)) root.child(h_flex().h(36).flex_none().px(12).gap(6).items_center()
      .child(caption(`대기 중 변경 ${doc.changes.changes.size}행`))
      .child(adeButton("db-result-apply", "적용", (_event, eventCx) => this.applyResult(grid, eventCx), { kind: "primary", disabled: doc.applying }))
      .child(adeButton("db-result-revert", "취소", (_event, eventCx) => { doc.changes.revert(); doc.editing = null; previewCellChanges(doc); eventCx.notify(); }, { disabled: doc.applying }))
      .when(Boolean(doc.editing), element => element.child(adeButton("db-result-null", "NULL", (_event, eventCx) => stageCell(doc, eventCx, true)))));
    return root.child(grid.render(cx, { changes: doc?.changes, editor: doc?.editing ? { ...doc.editing, element: () => div().flex_1().min_w(0)
      .on_mouse_down("left", (_event, eventCx) => eventCx.stop_propagation())
      .on_key_down((event, eventCx) => { if (event.keystroke === "escape") { doc.editing = null; eventCx.stop_propagation(); eventCx.notify(); } })
      .child(Input.new(doc.cell).w_full().h(26)) } : null }));
  }
}

export class DatabaseTransfer {
  init(props, cx) {
    this.context = props.context; this.spec = props.spec; this.dataset = props.dataset; this.selection = props.selection?.length ? [...props.selection] : undefined;
    this.source = props.source; this.mode = props.mode ?? "export"; this.intent = props.intent ?? "export"; this.overlay = props.overlay; this.alive = true; this.format = "csv";
    this.error = ""; this.notice = ""; this.busy = false; this.mappingInputs = Object.create(null); this.path = InputState.new({ placeholder: "절대 파일 경로" });
    this.table = InputState.new({ value: this.spec.table ?? "", placeholder: "SQL 출력 대상 테이블" });
    this.table.on("change", (_event, eventCx) => { this.spec = { ...this.spec, table: this.table.value().trim() }; this.regenerate(eventCx); });
    this.path.on("change", (_event, eventCx) => { this.confirmPath = null; this.expected = undefined; this.loadedPath = null; this.parsed = null; this.prepared = null; this.notice = ""; this.error = ""; eventCx.notify(); });
    this.preview = new CodeInput().init("", cx, { readOnly: true });
    if (this.mode === "export") this.regenerate(cx);
    if (!this.source) cx.spawn(async taskCx => {
      try {
        const sources = await databaseService.sources(taskCx); if (!this.alive) return;
        this.source = sources.sources.find(source => source.id === this.spec.source_id);
        if (!this.source) throw new Error("연결 정보를 찾을 수 없습니다.");
        if (this.mode === "export") this.regenerate(taskCx);
      } catch (error) { if (this.alive) { this.error = message(error); taskCx.notify(); } }
    });
  }
  release() { this.alive = false; this.path.release(); this.table.release(); this.preview.release(); for (const input of Object.values(this.mappingInputs)) input.release(); }
  regenerate(cx) {
    this.error = ""; this.confirmPath = null;
    try {
      if (this.format.startsWith("sql-") && !this.source?.driver) throw new Error("연결 드라이버를 확인하는 중입니다.");
      const text = this.mode === "export" ? extractData(this.dataset, { format: this.format, rowIndices: this.selection, target: this.spec, driver: this.source?.driver ?? "sqlite", keyColumns: this.dataset.primary_keys ?? [] }) : "";
      this.preview.release(); this.preview = new CodeInput().init(text, cx, { readOnly: true }); this.text = text;
    } catch (error) { this.error = message(error); }
    cx.notify();
  }
  chooseFormat(format, cx) {
    this.format = format;
    if (this.mode === "export") this.regenerate(cx);
    else { this.parsed = null; this.prepared = null; this.loadedPath = null; cx.notify(); }
  }
  load(cx) {
    if (this.busy) return;
    const path = this.path.value().trim(), format = this.format;
    if (!/^(\/|[A-Za-z]:[\\/])/.test(path)) { this.error = "절대 파일 경로를 입력하세요."; cx.notify(); return; }
    this.busy = true; this.error = ""; cx.notify();
    cx.spawn(async taskCx => {
      try {
        const text = await readTextFile(path);
        if (!this.alive || this.path.value().trim() !== path || this.format !== format) return;
        if (text === null) throw new Error("가져올 파일을 읽을 수 없습니다.");
        this.parsed = parseImport(text, format); this.loadedPath = path;
        for (const input of Object.values(this.mappingInputs)) input.release(); this.mappingInputs = Object.create(null);
        const columns = this.dataset.columns.map(columnName);
        for (const name of this.parsed.columns) {
          const input = InputState.new({ value: columns.includes(name) ? name : "" });
          input.on("change", (_event, eventCx) => this.prepare(eventCx)); this.mappingInputs[name] = input;
        }
        this.prepare(taskCx);
      } catch (error) { if (this.alive) this.error = message(error); }
      finally { if (this.alive) { this.busy = false; taskCx.notify(); } }
    });
  }
  prepare(cx) {
    if (!this.parsed) return;
    try {
      this.prepared = prepareImport(this.parsed, { columns: this.dataset.columns, mapping: Object.fromEntries(Object.entries(this.mappingInputs).map(([name, input]) => [name, input.value().trim()])) });
      this.error = this.prepared.errors.join("\n");
      const text = extractData({ columns: this.parsed.columns, rows: this.parsed.rows.slice(0, 20) }, { format: "csv" });
      this.preview.release(); this.preview = new CodeInput().init(text, cx, { readOnly: true });
    } catch (error) { this.prepared = null; this.error = message(error); }
    cx.notify();
  }
  save(cx) {
    if (this.busy || this.error) return;
    const path = this.path.value().trim(), text = this.text;
    if (!/^(\/|[A-Za-z]:[\\/])/.test(path)) { this.error = "저장할 절대 파일 경로를 입력하세요."; cx.notify(); return; }
    this.busy = true; cx.notify();
    cx.spawn(async taskCx => {
      try {
        let expected = this.expected;
        if (this.confirmPath !== path) {
          expected = await readTextFile(path);
          if (!this.alive || this.path.value().trim() !== path || this.text !== text) return;
          if (expected !== null) { this.expected = expected; this.confirmPath = path; this.notice = "같은 경로의 파일이 있습니다. 덮어쓰기를 눌러 저장하세요."; return; }
        }
        await writeTextFile(path, text, expected ?? null);
        if (this.alive) { this.notice = `파일을 저장했습니다: ${path}`; this.expected = text; this.confirmPath = path; }
      } catch (error) { if (this.alive) this.error = `파일 저장 실패: ${message(error)}`; }
      finally { if (this.alive) { this.busy = false; taskCx.notify(); } }
    });
  }
  copy(cx) { if (this.error || this.busy) return; cx.write_to_clipboard(this.text); this.notice = "복사했습니다."; cx.notify(); }
  apply(cx) {
    if (this.busy || !this.prepared || this.prepared.errors.length || this.loadedPath !== this.path.value().trim()) return;
    const changes = this.prepared.changes, count = this.prepared.count, target = targetOf(this.spec); this.busy = true; this.error = ""; cx.notify();
    cx.spawn(async taskCx => {
      try {
        const result = await databaseService.apply(target, changes, taskCx);
        publishDataChange(this.spec);
        if (this.alive) { this.notice = `${count}행 가져오기를 적용했습니다.`; this.prepared = null; this.parsed = null; }
      } catch (error) { if (this.alive) this.error = `가져오기 실패: ${message(error)} · 미리보기와 매핑을 유지했습니다.`; }
      finally { if (this.alive) { this.busy = false; taskCx.notify(); } }
    });
  }
  render(cx) {
    const c = adeColors(), importing = this.mode === "import", copying = !importing && this.intent === "copy";
    const formats = importing ? [["csv", "CSV"], ["tsv", "TSV"], ["json", "JSON"]] : [["csv", "CSV"], ["tsv", "TSV"], ["json", "JSON"], ["sql-insert", "SQL INSERT"], ["sql-update", "SQL UPDATE"], ["sql-where", "SQL WHERE"]];
    return adeUI(v_flex()).id("ade-database-transfer").size_full().min_w(0).min_h(0).rounded(8).overflow_hidden().bg(c.editor)
      .child(h_flex().h(48).flex_none().px(16).items_center().border_b(1).border_color(c.separator)
        .child(div().font_semibold().child(importing ? "데이터 가져오기" : copying ? "데이터 복사" : "데이터 내보내기")).child(div().flex_1())
        .child(adeButton("db-transfer-close", null, () => closeOverlay(this.overlay), { icon: uiIcon("x", 16), square: true, tip: "닫기", disabled: this.busy })))
      .child(h_flex().h(36).flex_none().px(12).items_center().gap(6).children(formats.map(([format, label]) => adeButton(`db-format-${format}`, label, (_event, eventCx) => this.chooseFormat(format, eventCx), { selected: this.format === format, disabled: this.busy }))))
      .when(!copying, element => element.child(h_flex().flex_none().px(16).py(8).gap(8).items_center().child(adeInputBox(Input.new(this.path)).flex_1())
        .when(importing, row => row.child(adeButton("db-import-load", "파일 읽기", (_event, eventCx) => this.load(eventCx), { disabled: this.busy })))))
      .when(!importing && this.format.startsWith("sql-"), element => element.child(h_flex().flex_none().px(16).py(4).gap(8).items_center().child(caption("대상 테이블")).child(adeInputBox(Input.new(this.table)).flex_1())))
      .child(caption(importing ? "CSV/TSV는 첫 행의 열 이름으로 매핑합니다. 빈 대상은 건너뜁니다. NULL은 따옴표 없는 \\N입니다." : "선택한 행이 있으면 선택 범위만 내보냅니다. 미리보기·복사·파일 저장은 동일한 추출 원문을 사용합니다.").px(16).py(4))
      .when(importing && Boolean(this.parsed), element => element.child(h_flex().flex_none().max_h(120).px(16).gap(8).overflow_x_scrollbar()
        .children(this.parsed.columns.map(name => v_flex().w(140).flex_none().gap(4).child(caption(name)).child(adeInputBox(Input.new(this.mappingInputs[name])))))))
      .when(Boolean(this.error), element => element.child(adeNote(this.error)))
      .when(Boolean(this.notice), element => element.child(adeNote(this.notice)))
      .child(v_flex().flex_1().min_h(0).min_w(0).border_t(1).border_color(c.separator).child(this.preview.render(cx)))
      .child(h_flex().h(54).flex_none().px(16).gap(8).items_center().justify_end().border_t(1).border_color(c.separator)
        .child(caption(importing ? `${this.prepared?.count ?? 0}행 · 미리보기 최대 20행` : `${this.selection?.length ?? this.dataset.rows.length}행`)).child(div().flex_1())
        .when(!importing && !copying, element => element.child(adeButton("db-transfer-copy", "복사", (_event, eventCx) => this.copy(eventCx), { disabled: Boolean(this.error) || this.busy })))
        .when(copying, element => element.child(adeButton("db-transfer-export-mode", "파일로 내보내기", (_event, eventCx) => { this.intent = "export"; eventCx.notify(); })))
        .child(adeButton("db-transfer-cancel", "닫기", () => closeOverlay(this.overlay), { disabled: this.busy }))
        .child(adeButton("db-transfer-apply", importing ? "가져오기 적용" : copying ? "복사" : this.confirmPath === this.path.value().trim() ? "덮어쓰기" : "파일 저장", (_event, eventCx) => importing ? this.apply(eventCx) : copying ? this.copy(eventCx) : this.save(eventCx), { kind: "primary", disabled: this.busy || Boolean(this.error) || importing && (!this.prepared || !this.prepared.changes.length) })));
  }
}

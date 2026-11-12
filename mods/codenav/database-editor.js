// Database documents share the source viewer's geometry, selection and syntax.
// Native editing and explicit Apply keep text drafts and row mutations local.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Editor, EditorState, Select, Popup } from "gpui-base";
import { shared, setShared, run, nextCommand, openOverlay, closeOverlay, theme, appHome, writeTextFile, readTextFile } from "herdr";
import CodeView from "./code.js";
import EditableCode from "./editable-code.js";
import { EditorBuffer } from "./editor-buffer.js";
import { editorSpec, editorKey, setEditorSpec, setLayout, STACK, AREA, CHILD, find, codeFont, displayWidth, icon } from "./common.js";
import { layout } from "herdr";
import { editorSurface } from "./editor-surface.js";
import { Scroller } from "./scroller.js";
import { lsp } from "./lsp.js";
import { T } from "./i18n.js";
import { ideaUI, isIdea, IDEA, uiColors, uiSize, uiButton, uiIconButton, uiCaption, uiInputBox, uiNotify, MenuController, uiMenu, uiPopupSize, uiDialog, uiTab, uiTabStrip, TabViewport, uiSpinner, uiManagedList, uiSeparator } from "./idea-design.js";
import { splitSQL, queryCandidates, extractData, parseImport, EXTRACTORS } from "./database-model.js";
import { beginExecution, updateExecution, executionStore, selectExecution, closeExecution, executionBusy, interruptExecution, claimExecution, releaseExecution, inspectExecutionTerminal, markUntrackedSession, EXECUTION_HISTORY_LIMIT } from "./execution-results.js";
import { runTerminalContent } from "./run-process.js";
import { executionTerminalLayout } from "./execution-layout.js";

const request = (method, database, cx) => lsp(method, { database }, ms => cx.sleep(ms));
const message = error => String(error?.message ?? error);
const coord = (text, position) => text.split("\n").slice(0, position?.line ?? 0).reduce((n, line) => n + line.length + 1, 0) + (position?.col ?? 0);
const parameters = doc => ({ source_id: doc.spec.source_id, database: doc.spec.database, schema: doc.spec.schema, table: doc.spec.table });
const label = spec => spec.kind === "console" ? `SQL console · ${spec.database || spec.source_id}` : `${spec.table || "Selection"}${spec.kind === "ddl" ? " (DDL)" : ""}`;

// Select owns the native trigger/content focus boundary; shared buttons and
// MenuController supply the same compact presentation as connection settings.
class DatabaseChoice {
  constructor(cx) { this.focus = cx.focus_handle(); this.menu = new MenuController(cx); this.open = false; }
  release() { this.menu.release(); this.menu.focus.release(); this.focus.release(); }
  render(id, label, options, value, change, cx, disabled = false) {
    const open = (show, eventCx) => {
      if (show && disabled) return;
      this.open = show;
      if (show) { this.menu.at = options.findIndex(option => option.id === value); this.menu.ensureVisible(); this.menu.focus.focus(); }
      else this.focus.focus();
      eventCx.notify();
    };
    const current = options.find(option => option.id === value);
    const trigger = uiButton(id, current?.label || label, (_event, eventCx) => open(!this.open, eventCx), { small: true, disabled })
      .w_full().justify_between().child(icon("chevron-down", 12));
    const rows = options.map(option => ({ ...option, disabled, action: (_event, eventCx) => {
      if (disabled) return;
      change(option.id, eventCx); open(false, eventCx);
    } }));
    return Select.new(`${id}-select`).accessibility_label(label).open(this.open).track_focus(this.focus)
      .content_focus_handle(this.menu.focus).on_open_change(open).w_full().min_w(0)
      .child(Popup.new(`${id}-popup`, trigger).anchor("bottom_left")
        .when(this.open, el => el.content(uiMenu(`${id}-options`, rows, this.menu, cx, { width: 240, maxHeight: 260, onClose: (_event, eventCx) => open(false, eventCx) }))));
  }
}
const gridColumns = result => {
  const cell = Math.max(7, codeFont().size * .6);
  return result.columns.map((col, index) => {
    const samples = result.rows.slice(0, 60).map(row => row[index] === null ? 4 : displayWidth(typeof row[index] === "object" ? JSON.stringify(row[index]) : String(row[index])));
    return Math.max(88, Math.min(320, (Math.max(displayWidth(col.name) + (result.primary_keys?.includes(col.name) ? 4 : 0), ...samples, 8) + 3) * cell));
  });
};

export async function openDatabaseDocument(payload) {
  if (!payload?.source_id || !["table", "ddl", "console"].includes(payload.kind)) return;
  const space = editorKey(), id = JSON.stringify([space, payload.source_id, payload.kind, payload.database, payload.schema, payload.table, payload.objects]);
  const spec = { kind: "database", path: `db://${encodeURIComponent(id)}`, rel: label(payload), database: { ...payload, space }, on: null };
  if (!find(layout(), CHILD.database)) {
    const tree = JSON.parse(JSON.stringify(layout())), stack = find(tree, STACK);
    if (!stack) throw new Error(T("This layout has no editor area."));
    stack.children.push({ id: CHILD.database, type: "block", content: { mod: "codenav", props: { view: "database-editor" } } });
    await setLayout(tree);
  }
  if (editorKey() !== space) return;
  if (shared("codenav.area")) setShared("codenav.area", null);
  setEditorSpec(space, spec);
  if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
  run("layout.select", { stack: STACK, child: CHILD.database });
}

// CodeView supplies real hit testing/drag selection rather than estimating a
// native editor selection that the installed API does not expose.
class SQLViewer extends CodeView {
  constructor(owner) { super(); this.owner = owner; }
  listenCommands() {} // The containing DatabaseEditor owns this copy's queue.
  sync() {}
  publish() {}
  httpLines() {}
  header() { return null; }
  infoBar() { return null; }
  outlinePanel() { return null; }
  fileComments() { return []; }
  commentLines() {}
  hoverAt() {}
  definition() {}
  openContext() {}
  command(command) { if (command === "focus") this.focus.focus(); }
  keyDown(event, cx) {
    if (event.key === "enter" && (event.modifiers?.platform || event.modifiers?.control)) { cx.stop_propagation(); this.owner.chooseQuery(cx); return; }
    return super.keyDown(event, cx);
  }
  setDocument(doc, cx) {
    if (this.text === doc.text && this.shown?.path === doc.path) return;
    this.shown = { path: doc.path, rel: label(doc.spec), on: null };
    this.text = doc.text; this.lines = doc.text.split("\n"); this.selection = null; this.sel = null; this.toks = null;
    this.width = Math.max(40, ...this.lines.slice(0, 20000).map(line => displayWidth(line)));
    this.scroll.setTop(0); this.info = null; this.navigation = []; this.commented = new Set();
    const text = doc.text, path = doc.path;
    cx.timer.after(0, eventCx => eventCx.spawn(async taskCx => {
      const tokens = await lsp("tokens", { path: "console.sql", text }, ms => taskCx.sleep(ms)).catch(() => null);
      if (!this.released && this.shown?.path === path && this.text === text) { this.toks = tokens; taskCx.notify(); }
    }));
  }
}

// The SQL console uses the same owned document, input and source rendering as
// files. Selection/caret execution is available while editing, with no second
// viewer mode and no attempt to infer the native Editor's hidden selection.
class SQLBuffer extends EditableCode {
  constructor(owner) { super(); this.owner = owner; }
  init(p, cx) {
    super.init({ ...p, disableLsp: true }, cx);
    cx.bind_keys(["HerdrSqlEditor", "HerdrSqlEditor > HerdrEditorInput > Input"].map(context =>
      ({ keystroke: "cmd-enter", action: "codebench-sql::run", context })));
  }
  listenCommands() {}
  sync() {}
  publish() {}
  publishState() {}
  httpLines() {}
  header() { return null; }
  infoBar() { return null; }
  outlinePanel() { return null; }
  fileComments() { return []; }
  commentLines() {}
  hoverAt() {}
  definition() {}
  openContext() {}
  save(cx) { this.owner.saveDraft(cx); }
  setDocument(doc, cx) {
    if (this.sqlDocument === doc && this.buffer?.text === doc.text) return;
    this.sqlDocument = doc;
    doc.codeDocument ??= { spec: { kind: "file", path: doc.path, rel: label(doc.spec), on: null },
      buffer: new EditorBuffer(doc.text, { readOnly: doc.spec.kind === "ddl" }), original: doc.savedText ?? doc.text };
    this.document = doc.codeDocument;
    // An explicit load/discard replaces the model once. Normal commits already
    // update doc.text from this buffer and never reset its history/selection.
    if (this.buffer.text !== doc.text) this.document.buffer = new EditorBuffer(doc.text, { readOnly: doc.spec.kind === "ddl" });
    this.document.original = doc.savedText ?? doc.text;
    this.shown = this.document.spec; this.documentSpace = editorKey();
    this.text = this.buffer.text; this.lines = this.text.split("\n");
    this.navigation = []; this.info = null; this.diags = []; this.symbols = [];
    this.width = Math.max(40, ...this.lines.slice(0, 20000).map(line => displayWidth(line)));
    this.selectionFromBuffer(); this.analyze(cx);
  }
  changed(cx, revision) {
    super.changed(cx, revision);
    if (!this.sqlDocument || this.buffer.revision === revision) return;
    this.sqlDocument.text = this.buffer.text;
    this.sqlDocument.textDirty = this.buffer.text !== this.sqlDocument.savedText;
    this.owner.publishState(cx);
  }
  analyze(cx) {
    const doc = this.sqlDocument, text = this.buffer?.text, revision = this.buffer?.revision;
    cx.timer.after(120, eventCx => eventCx.spawn(async taskCx => {
      if (this.released || !doc || this.sqlDocument !== doc || this.buffer.revision !== revision) return;
      const tokens = await lsp("tokens", { path: "console.sql", text }, ms => taskCx.sleep(ms)).catch(() => null);
      if (!this.released && this.sqlDocument === doc && this.buffer.revision === revision) { this.toks = tokens; taskCx.notify(); }
    }));
  }
  render(cx) {
    return div().flex().flex_1().size_full().min_w(0).min_h(0).key_context("HerdrSqlEditor").child(super.render(cx)).on_action("codebench-sql::run", (_event, eventCx) => {
      if (this.input.pending()) { eventCx.propagate(); return; }
      eventCx.stop_propagation(); this.owner.chooseQuery(eventCx);
    });
  }
  keyDown(event, cx) {
    if (event.key === "enter" && event.modifiers?.platform && !this.input.pending()) { cx.stop_propagation(); this.owner.chooseQuery(cx); return; }
    super.keyDown(event, cx);
  }
}

export class DatabaseEditor {
  init(_props, cx) {
    this.alive = true; this.stateOwner = `${Date.now()}-${Math.random()}`; this.stateLayout = shared("layout");
    const owners = Object.fromEntries(Object.entries(shared("codenav.databaseState") || {}).filter(([_id, state]) => state.layout !== this.stateLayout));
    setShared("codenav.databaseState", owners);
    this.documents = new Map(); this.viewer = isIdea() ? new SQLBuffer(this) : new SQLViewer(this); this.viewer.init({}, cx);
    this.editor = isIdea() ? null : EditorState.new({ language: "sql", value: "", readonly: false, font_family: codeFont().family, font_size: codeFont().size });
    this.editor?.on("change", (_event, eventCx) => {
      if (this.doc?.editing && !this.syncing) { this.doc.text = this.editor.value(); this.doc.textDirty = this.doc.text !== this.doc.savedText; this.publishState(eventCx); eventCx.notify(); }
    });
    this.cell = InputState.new(); this.cell.on("submit", (_event, eventCx) => this.finishCell(eventCx, true));
    this.grid = new Scroller(); this.gridFocus = cx.focus_handle();
    cx.spawn(async taskCx => {
      while (this.alive) {
        const command = await nextCommand();
        if (!this.alive) return;
        if (command === "focus") { if (this.doc?.spec.kind === "table") this.gridFocus.focus(); else if (!this.doc?.editing) this.viewer.command("focus", taskCx); }
        else if (command === "save" && this.doc?.spec.kind === "console") this.saveDraft(taskCx);
        else if (command === "database-run") this.chooseQuery(taskCx);
        else if (command === "database-cancel") this.cancel(taskCx);
        else if (command.startsWith("database-execute:")) {
          try { const item = JSON.parse(command.slice(17)); if (this.doc?.path === item.path && editorSpec()?.path === item.path) this.execute(item.sql, taskCx); } catch (error) { this.fail(error); }
        } else if (command.startsWith("database-grid:")) {
          try { const item = JSON.parse(command.slice(14)); if (this.doc?.path === item.path && editorSpec()?.path === item.path) this.gridAction(item, taskCx); } catch (error) { this.fail(error); }
        } else if (command.startsWith("database-transfer:")) {
          try { const item = JSON.parse(command.slice(18)); if (this.doc?.path === item.path && editorSpec()?.path === item.path) this.transfer(item, taskCx); } catch (error) { this.fail(error); }
        }
      }
    });
  }
  release() {
    this.alive = false;
    const owners = { ...(shared("codenav.databaseState") || {}) }; delete owners[this.stateOwner];
    setShared("codenav.databaseState", owners);
    this.viewer.release(); if (!isIdea()) this.viewer.focus?.release(); this.gridFocus.release(); this.editor?.release(); this.cell.release();
  }
  publishState(cx, defer = false) {
    if (!this.alive) return;
    // sync() runs during render. Event handlers publish before another close
    // action can observe the tab, while render only schedules the write.
    if (defer) {
      if (this.publishingState) return;
      this.publishingState = true;
      cx.timer.after(0, eventCx => { this.publishingState = false; this.publishState(eventCx); });
      return;
    }
    const documents = {};
    for (const doc of this.documents.values()) {
      documents[doc.path] = {
        dirty: Boolean(doc.textDirty || doc.changes.size || this.doc === doc && this.editingCell),
        busy: Boolean(doc.loading || doc.saving || doc.applying || doc.transferring || ["queued", "running"].includes(doc.job?.state)),
      };
    }
    const owners = shared("codenav.databaseState") || {};
    const state = { layout: this.stateLayout, documents };
    if (JSON.stringify(owners[this.stateOwner]) !== JSON.stringify(state)) setShared("codenav.databaseState", { ...owners, [this.stateOwner]: state });
  }
  fail(error) { uiNotify({ title: T("Database operation failed"), body: message(error), level: "error" }); }
  sync(cx) {
    const current = editorSpec();
    if (this.doc && this.doc.path !== current?.path && this.editingCell) {
      this.stageCell(this.cell.value()); this.publishState(cx, true);
    }
    if (current?.kind !== "database") { this.doc = null; return; }
    if (this.doc?.path === current.path) return;
    let doc = this.documents.get(current.path);
    if (!doc) {
      doc = { path: current.path, spec: current.database, text: "", editing: false, changes: new Map(), selected: new Set(), offset: 0, limit: 200, textDirty: false };
      this.documents.set(doc.path, doc);
      cx.timer.after(0, taskCx => this.load(doc, taskCx));
    }
    this.doc = doc; this.editingCell = null; this.publishState(cx, true); this.grid.setTop(0); this.grid.setLeft(0);
    cx.timer.after(0, eventCx => {
      if (!this.alive || this.doc !== doc) return;
      this.syncing = true; this.editor?.set_value(doc.text); this.syncing = false; eventCx.notify();
    });
    if (doc.spec.kind !== "table") this.viewer.setDocument(doc, cx);
  }
  load(doc, cx) {
    if (this.doc === doc && this.editingCell) this.finishCell(cx);
    if (doc.loading || doc.changes.size || doc.applying) return;
    if (this.doc === doc) this.editingCell = null;
    doc.loading = true; doc.error = null; this.publishState(cx); cx.notify();
    cx.spawn(async taskCx => {
      try {
        const { sources } = await request("db_sources", {}, taskCx);
        doc.source = sources.find(source => source.id === doc.spec.source_id);
        if (!doc.source) throw new Error(T("This data source no longer exists."));
        if (doc.spec.kind === "table") {
          doc.result = await request("db_rows", { ...parameters(doc), limit: doc.limit, offset: doc.offset }, taskCx);
          doc.selected.clear(); doc.focusedCell = null;
        } else if (doc.spec.kind === "ddl") {
          const result = await request("db_ddl", { ...parameters(doc), objects: doc.spec.objects || [{ kind: "table", name: doc.spec.table, ...parameters(doc) }] }, taskCx);
          doc.text = result.sql; doc.warnings = result.warnings;
        } else {
          doc.draftPath = `${appHome()}/data/database-console-${encodeURIComponent((doc.spec.space || "") + ":" + doc.spec.source_id + ":" + (doc.spec.database || "") + ":" + (doc.spec.schema || ""))}.sql`;
          doc.diskText = await readTextFile(doc.draftPath);
          doc.text = doc.diskText ?? "-- SQL console\nSELECT 1;\n";
          doc.savedText = doc.text;
        }
        if (this.alive && this.doc === doc) { this.syncing = true; this.editor?.set_value(doc.text); this.syncing = false; this.viewer.setDocument(doc, taskCx); }
      } catch (error) { doc.error = message(error); }
      finally { doc.loading = false; this.publishState(taskCx); if (this.alive) taskCx.notify(); }
    });
  }
  toggleEditing(cx) {
    if (isIdea()) return;
    const doc = this.doc;
    if (!doc || doc.spec.kind !== "console") return;
    if (doc.editing) { doc.text = this.editor.value(); this.viewer.setDocument(doc, cx); }
    else { this.syncing = true; this.editor.set_value(doc.text); this.syncing = false; }
    doc.editing = !doc.editing; cx.notify();
  }
  saveDraft(cx) {
    const doc = this.doc;
    if (!doc?.draftPath || doc.saving) return;
    if (doc.editing) doc.text = this.editor.value();
    const text = doc.text; doc.saving = true; this.publishState(cx);
    cx.spawn(async taskCx => {
      try { await writeTextFile(doc.draftPath, text, doc.diskText); doc.diskText = text; doc.savedText = text; doc.textDirty = doc.text !== text; }
      catch (error) { this.fail(error); }
      finally { doc.saving = false; this.publishState(taskCx); }
      if (this.alive) taskCx.notify();
    });
  }
  discardDraft(cx) {
    const doc = this.doc;
    if (!doc || doc.spec.kind !== "console" || doc.saving || doc.loading || ["queued", "running"].includes(doc.job?.state)) return;
    doc.text = doc.savedText ?? doc.diskText ?? "-- SQL console\nSELECT 1;\n";
    doc.textDirty = false;
    this.syncing = true; this.editor?.set_value(doc.text); this.syncing = false;
    this.viewer.setDocument(doc, cx); this.publishState(cx); cx.notify();
  }
  chooseQuery(cx) {
    const doc = this.doc;
    if (!doc || editorSpec()?.path !== doc.path || doc.spec.kind !== "console" || doc.loading || doc.job?.state === "running" || doc.job?.state === "queued") return;
    if (doc.editing) doc.text = this.editor.value();
    const selected = !doc.editing && this.viewer.span(), dialect = doc.source?.driver || "mysql";
    const options = selected ? { start: coord(doc.text, selected[0]), end: coord(doc.text, selected[1]), dialect }
      : { caret: coord(doc.text, this.viewer.sel), dialect };
    let candidates;
    try { candidates = queryCandidates(doc.text, options); }
    catch (error) { this.fail(error); return; }
    // Native EditorState does not expose its caret/selection. In edit mode
    // list actual statement ranges explicitly rather than assuming a location.
    if (doc.editing) {
      const statements = splitSQL(doc.text, { dialect });
      candidates = statements.map((span, index) => ({ ...span, label: `${T("Statement")} ${index + 1}` }));
      if (statements.length > 1) candidates.push({ start: 0, end: doc.text.length, text: doc.text, label: "Entire script" });
    }
    candidates = candidates.map(span => ({ ...span, firstLine: doc.text.slice(0, span.start).split("\n").length,
      lastLine: doc.text.slice(0, span.end).split("\n").length }));
    if (!candidates.length) return;
    openOverlay({ mod: "codenav", props: { view: "database-query", path: doc.path, candidates, source: [doc.source?.name || doc.spec.source_id, doc.spec.database, doc.spec.schema].filter(Boolean).join(" / ") }, kind: isIdea() ? "dialog" : "popup", frame: "none", ...(isIdea() ? { width: 760, height: 520 } : uiPopupSize(candidates.length + 1, { width: 640, maxHeight: 360 })) });
  }
  execute(sql, cx) {
    const doc = this.doc;
    if (!doc || editorSpec()?.path !== doc.path || doc.job && ["queued", "running"].includes(doc.job.state)) return;
    const dialect = doc.source?.driver || "mysql";
    let blocks = [];
    try { blocks = splitSQL(doc.text, { dialect }); } catch { /* A valid selection may coexist with an unfinished draft. */ }
    // A resolved routine block has already consumed its client's DELIMITER.
    // Preserve that verified block rather than splitting its body a second time.
    const resolved = blocks.find(span => span.text === sql);
    let statements;
    try { statements = resolved ? [resolved.text] : splitSQL(sql, { dialect }).map(span => span.text); }
    catch (error) { this.fail(error); return; }
    if (!statements.length) return;
    doc.cancelRequested = false;
    doc.job = { state: "queued", current: 0, total: statements.length, results: [] }; doc.result = null; doc.resultIndex = 0; doc.selected.clear(); doc.error = null; this.publishState(cx); cx.notify();
    const scope = editorKey();
    const executionId = isIdea() ? beginExecution({ kind: "sql", name: label(doc.spec), command: sql, spec: { ...doc.spec }, source: { ...doc.source }, job: doc.job }, scope) : null;
    if (executionId) claimExecution(executionId, scope);
    const publish = () => { if (executionId) updateExecution(executionId, { state: doc.job.state, job: doc.job, error: doc.error || null, elapsed_ms: doc.job.elapsed_ms || 0 }, scope); };
    cx.spawn(async taskCx => {
      try {
        const { job_id } = await request("db_query", { ...parameters(doc), statements, limit: 1000 }, taskCx);
        doc.job.id = job_id;
        if (doc.cancelRequested || executionId && executionStore(scope).entries.find(entry => entry.id === executionId)?.stopRequested)
          await request("db_cancel", { job_id }, taskCx);
        publish();
        while (this.alive) {
          doc.job = await request("db_job", { job_id }, taskCx);
          doc.result = doc.job.results?.[doc.resultIndex] || null;
          publish();
          if (!["queued", "running"].includes(doc.job.state)) break;
          taskCx.notify(); await taskCx.sleep(300);
        }
        doc.result = doc.job.results?.[doc.resultIndex] || null; doc.selected.clear();
        if (doc.job.error) doc.error = doc.job.error;
      } catch (error) { doc.error = message(error); doc.job = { ...doc.job, state: "error" }; }
      finally {
        publish(); if (executionId) releaseExecution(executionId, scope);
        this.publishState(taskCx); if (this.alive) taskCx.notify();
      }
    });
  }
  cancel(cx) { const doc = this.doc; if (!doc?.job) return; doc.cancelRequested = true; if (doc.job.id) cx.spawn(async taskCx => { try { doc.job = await request("db_cancel", { job_id: doc.job.id }, taskCx); } catch (error) { this.fail(error); } taskCx.notify(); }); }
  selectRow(index, event, cx) {
    const doc = this.doc, mods = event.modifiers || {};
    if (mods.shift && doc.anchor !== undefined) for (let i = Math.min(doc.anchor, index); i <= Math.max(doc.anchor, index); i++) doc.selected.add(i);
    else if (mods.platform || mods.control) doc.selected.has(index) ? doc.selected.delete(index) : doc.selected.add(index);
    else { doc.selected.clear(); doc.selected.add(index); }
    doc.anchor = index; doc.focusedCell = { row: index, column: doc.focusedCell?.column || 0 }; this.gridFocus.focus(); cx.notify();
  }
  focusCell(row, column, cx) {
    const doc = this.doc, result = doc.result;
    if (!result?.rows.length || !result.columns.length) return;
    row = Math.max(0, Math.min(result.rows.length - 1, row));
    column = Math.max(0, Math.min(result.columns.length - 1, column));
    doc.focusedCell = { row, column };
    this.grid.scrollTo(row + (isIdea() ? 0 : 1));
    const widths = isIdea() ? gridColumns(result) : result.columns.map(() => 180);
    const left = 44 + widths.slice(0, column).reduce((sum, width) => sum + width, 0), right = left + widths[column];
    if (left < this.grid.left) this.grid.setLeft(left);
    else if (right > this.grid.left + this.grid.viewW) this.grid.setLeft(right - this.grid.viewW);
    this.gridFocus.focus(); cx.notify();
  }
  editCell(row, column, cx) {
    if (this.doc.spec.kind !== "table" || this.doc.loading || this.doc.applying || this.doc.transferring || this.doc.changes.get(row)?.op === "delete") return;
    if (!this.doc.result?.primary_keys?.length) { this.fail(new Error(T("A primary key is required to edit this table."))); return; }
    this.doc.focusedCell = { row, column };
    this.editingCell = { row, column }; const name = this.doc.result.columns[column].name;
    const values = this.doc.changes.get(row)?.values;
    const value = values && Object.prototype.hasOwnProperty.call(values, name) ? values[name] : this.doc.result.rows[row][column];
    this.cell.set_value(value === null ? "" : String(value)); this.cell.focus(); this.publishState(cx); cx.notify();
  }
  stageCell(value) {
    if (!this.editingCell || this.doc.applying || this.doc.transferring) return false;
    const doc = this.doc, { row, column } = this.editingCell, columns = doc.result.columns;
    const original = Object.fromEntries(columns.map((col, i) => [col.name, doc.result.rows[row][i]]));
    const change = doc.changes.get(row) || { op: "update", original, values: {} };
    change.values[columns[column].name] = value; doc.changes.set(row, change); this.editingCell = null;
    return true;
  }
  setCell(value, cx) {
    if (!this.stageCell(value)) return;
    this.gridFocus.focus(); this.publishState(cx); cx.notify();
  }
  finishCell(cx, move = false) {
    const cell = this.editingCell;
    if (!cell) return;
    this.setCell(this.cell.value(), cx);
    if (move) this.focusCell(cell.row + 1, cell.column, cx);
  }
  deleteRows(cx) {
    const doc = this.doc;
    if (doc.applying || doc.transferring) return;
    if (!doc.result?.primary_keys?.length) return this.fail(new Error(T("A primary key is required to edit this table.")));
    for (const index of doc.selected) doc.changes.set(index, { op: "delete", original: Object.fromEntries(doc.result.columns.map((col, i) => [col.name, doc.result.rows[index][i]])) });
    this.publishState(cx); cx.notify();
  }
  revert(cx) {
    const doc = this.doc;
    if (!doc || doc.applying || doc.transferring) return;
    doc.changes.clear(); this.editingCell = null; this.publishState(cx); cx.notify();
  }
  apply(cx) {
    const doc = this.doc;
    if (!doc || doc.applying || doc.transferring) return;
    if (this.editingCell) this.finishCell(cx);
    if (!doc.changes.size) return;
    const staged = [...doc.changes.entries()];
    const changes = JSON.parse(JSON.stringify(staged.map(([_row, change]) => change)));
    doc.applying = true; doc.error = null; doc.status = null; this.publishState(cx); cx.notify();
    cx.spawn(async taskCx => {
      try {
        const result = await request("db_apply", { ...parameters(doc), changes }, taskCx);
        for (const [row, change] of staged) if (doc.changes.get(row) === change) doc.changes.delete(row);
        doc.status = `${T("Changes applied")} · ${result.affected_rows ?? changes.length} ${T("affected")}`;
        doc.applying = false; this.load(doc, taskCx);
      }
      catch (error) { doc.error = message(error); }
      finally { doc.applying = false; this.publishState(taskCx); if (this.alive) taskCx.notify(); }
    });
  }
  dataset(doc, selected = true) {
    const result = doc.result;
    return { ...result, ...parameters(doc), driver: doc.source?.driver, rows: selected && doc.selected.size ? [...doc.selected].sort((a, b) => a - b).map(index => result.rows[index]) : result.rows };
  }
  copy(cx) {
    try { cx.write_to_clipboard(extractData(this.dataset(this.doc), this.doc.format || "csv")); }
    catch (error) { this.fail(error); }
  }
  transferDialog(mode) {
    const doc = this.doc;
    openOverlay({ mod: "codenav", props: { view: "database-transfer", path: doc.path, mode, source: [doc.source?.name || doc.spec.source_id, doc.spec.database, doc.spec.schema, doc.spec.table].filter(Boolean).join(" / "), format: doc.format || "csv", dataset: doc.result ? this.dataset(doc) : null,
      loaded: doc.result ? this.dataset(doc, false) : null, selectedCount: doc.selected.size, table: doc.spec.kind === "table" }, kind: "dialog", frame: "none", width: 920, height: 620 });
  }
  showExtractors() {
    openOverlay({ mod: "codenav", props: { view: "database-transfer", mode: "format", path: this.doc.path }, kind: "popup", frame: "none", ...uiPopupSize(EXTRACTORS.length, { width: 260 }) });
  }
  gridAction(item, cx) {
    if (item.action === "copy") this.copy(cx);
    else if (item.action === "format") this.showExtractors();
    else if (item.action === "export") this.transferDialog("export");
    else if (item.action === "ddl" && this.doc.spec.kind === "table") openDatabaseDocument({ ...this.doc.spec, kind: "ddl" }).catch(error => this.fail(error));
    else if (item.action === "edit" && this.doc.focusedCell) this.editCell(this.doc.focusedCell.row, this.doc.focusedCell.column, cx);
  }
  gridContext(row, column, event, cx) {
    cx.stop_propagation();
    if (!this.doc.selected.has(row)) this.selectRow(row, event, cx);
    this.focusCell(row, column, cx);
    openOverlay({ mod: "codenav", props: { view: "database-query", grid: true, path: this.doc.path, table: this.doc.spec.kind === "table",
      editable: this.doc.spec.kind === "table" && !!this.doc.result.primary_keys?.length && !this.doc.applying && this.doc.changes.get(row)?.op !== "delete" },
      kind: "popup", frame: "none", at: event?.position ?? "pointer", ...uiPopupSize(5, { width: 280 }) });
  }
  transfer(item, cx) {
    const doc = this.doc; if (!doc || doc.transferring || doc.applying || item.mode === "import" && (doc.changes.size || this.editingCell)) return;
    if (item.mode === "format") { doc.format = item.format; cx.notify(); return; }
    doc.transferring = true; doc.error = null; doc.status = null; this.publishState(cx); cx.notify();
    cx.spawn(async taskCx => {
      try {
        if (item.mode === "import") {
          const text = await readTextFile(item.file);
          if (item.reviewedText !== undefined && text !== item.reviewedText) throw new Error(T("The import file changed. Preview it again before importing."));
          const data = parseImport(text, item.format);
          if (data.rows.length > 1000) throw new Error(T("Import is limited to 1,000 rows per transaction."));
          const changes = data.rows.map(row => ({ op: "insert", values: Object.fromEntries(data.columns.map((col, i) => [col.name, row[i]])) }));
          const result = await request("db_apply", { ...parameters(doc), changes }, taskCx);
          doc.status = `${T("Import completed")} · ${result.affected_rows ?? changes.length} ${T("affected")}`;
          this.load(doc, taskCx);
        } else {
          let data = this.dataset(doc, item.scope !== "table" && item.scope !== "loaded");
          if (item.scope === "table") {
            const rows = []; let bytes = 0;
            for (let offset = 0; ; offset += 1000) {
              const page = await request("db_rows", { ...parameters(doc), limit: 1000, offset }, taskCx);
              bytes += JSON.stringify(page.rows).length;
              if (bytes > 16 * 1024 * 1024) throw new Error(T("This export exceeds 16 MiB. Export a smaller result range."));
              rows.push(...page.rows); if (page.rows.length < 1000) break;
            }
            data = { ...data, rows };
          }
          const text = extractData(data, item.format);
          if (item.destination === "clipboard") taskCx.write_to_clipboard(text);
          else await writeTextFile(item.file, text, await readTextFile(item.file));
          doc.status = `${T("Export completed")} · ${data.rows.length} ${T("rows")} · ${item.destination === "clipboard" ? T("Clipboard") : item.file}`;
        }
      } catch (error) { doc.error = message(error); }
      finally { doc.transferring = false; this.publishState(taskCx); if (this.alive) taskCx.notify(); }
    });
  }
  gridView(cx) {
    const doc = this.doc, result = doc.result, c = uiColors(), height = Math.max(isIdea() ? 28 : 24, uiSize() + (isIdea() ? 12 : 10));
    const widths = isIdea() ? gridColumns(result) : result.columns.map(() => 180), width = 44 + widths.reduce((sum, width) => sum + width, 0);
    this.grid.setHeights(Array(result.rows.length + (isIdea() ? 0 : 1)).fill(height));
    const row = index => index === 0 ? h_flex().h(height).w(width).bg(c.surface).children([
      div().w(44).flex_none().child("#"),
      ...result.columns.map((col, column) => h_flex().w(widths[column]).px(6).gap(4).items_center().flex_none().font_semibold()
        .when(result.primary_keys?.includes(col.name), el => el.child(icon("key", 12).text_color(c.secondary)))
        .child(div().flex_1().min_w(0).truncate().child(col.name))),
    ])
      : h_flex().id(`db-row-${doc.path}-${index}`).h(height).w(width).bg(doc.changes.has(index - 1) ? c.hover : doc.selected.has(index - 1) ? c.selection : c.editor)
        .on_mouse_down("left", (event, eventCx) => this.selectRow(index - 1, event, eventCx))
        .child(div().w(44).px(6).flex_none().text_color(c.secondary).child(`${doc.changes.get(index - 1)?.op === "delete" ? "− " : ""}${doc.offset + index}`))
        .children(result.columns.map((col, column) => {
          const change = doc.changes.get(index - 1), value = change?.values && Object.prototype.hasOwnProperty.call(change.values, col.name) ? change.values[col.name] : result.rows[index - 1][column];
          const editing = this.editingCell?.row === index - 1 && this.editingCell.column === column;
          const focused = doc.focusedCell?.row === index - 1 && doc.focusedCell.column === column;
          const modified = change?.values && Object.prototype.hasOwnProperty.call(change.values, col.name);
          return div().id(`db-cell-${index}-${column}`).w(widths[column]).h_full().flex_none().px(6).border(1).border_color(focused ? c.focus : modified ? c.lineModified : c.border).overflow_hidden()
            .on_mouse_down("right", (event, eventCx) => this.gridContext(index - 1, column, event, eventCx))
            .on_mouse_down("left", (event, eventCx) => {
              eventCx.stop_propagation(); this.selectRow(index - 1, event, eventCx); this.focusCell(index - 1, column, eventCx);
              if (event.click_count > 1) this.editCell(index - 1, column, eventCx);
            })
            .child(editing ? div().w_full().on_key_down((event, eventCx) => {
              // InputState submits before bubbling. Keep that Enter from opening
              // another editor after the submit handler restores grid focus.
              if (event.key === "enter") eventCx.stop_propagation();
            }).child(Input.new(this.cell).w_full()) : div().w_full().truncate().when(typeof value === "number", el => el.text_right()).text_color(value === null ? c.secondary : c.foreground).child(value === null ? "NULL" : (typeof value === "object" ? JSON.stringify(value) : String(value)).replace(/\r\n|[\r\n]/g, "↵")));
        }));
    const body = this.grid.view("database-grid", theme(), width, index => row(index + (isIdea() ? 1 : 0))).track_focus(this.gridFocus)
      .on_key_down((event, eventCx) => {
        const mods = event.modifiers || {};
        if (this.editingCell) {
          if (event.key === "escape") { eventCx.stop_propagation(); this.editingCell = null; this.gridFocus.focus(); this.publishState(eventCx); eventCx.notify(); }
          return;
        }
        if (mods.platform || mods.control) {
          if (event.key === "c") { eventCx.stop_propagation(); this.copy(eventCx); }
          else if (event.key === "a") { eventCx.stop_propagation(); doc.selected = new Set(result.rows.map((_row, index) => index)); eventCx.notify(); }
          return;
        }
        if (mods.alt || mods.shift || !result.rows.length || !result.columns.length) return;
        let { row, column } = doc.focusedCell || { row: 0, column: 0 };
        if (event.key === "enter" || event.key === "f2") {
          eventCx.stop_propagation(); this.editCell(row, column, eventCx); return;
        }
        if (event.key === "up") row--;
        else if (event.key === "down") row++;
        else if (event.key === "left") column--;
        else if (event.key === "right") column++;
        else if (event.key === "home") column = 0;
        else if (event.key === "end") column = result.columns.length - 1;
        else return;
        eventCx.stop_propagation(); this.selectRow(Math.max(0, Math.min(result.rows.length - 1, row)), event, eventCx); this.focusCell(row, column, eventCx);
      });
    if (!isIdea()) return body;
    return v_flex().size_full().min_w(0).min_h(0)
      .child(div().h(height).flex_none().w_full().relative().overflow_hidden().border_b(1).border_color(c.border)
        .child(div().absolute().left(-this.grid.left).top(0).child(row(0))))
      .child(body)
      .when(!result.rows.length, el => el.child(uiCaption(T("No rows returned.")).px(10).py(8)));
  }
  renderIdea(cx) {
    const doc = this.doc, c = uiColors(); if (!doc) return div();
    const busy = ["queued", "running"].includes(doc.job?.state), blocked = doc.loading || doc.applying || doc.transferring;
    const button = (id, label, action, disabled = false, primary = false) => uiButton(`db-${id}`, T(label), action, { small: true, disabled, primary });
    const action = (id, label, graphic, callback, disabled = false) => uiIconButton(`db-${id}`, icon(graphic, 16), callback, { tip: T(label), disabled });
    const context = [doc.source?.name || doc.spec.source_id, doc.source?.driver === "sqlite" ? "SQLite" : doc.source?.driver, doc.spec.database, doc.spec.schema].filter(Boolean).join(" / ");
    const root = ideaUI(v_flex()).size_full().min_h(0).min_w(0).bg(c.editor).text_color(c.foreground)
      .child(h_flex().h(IDEA.toolbarHeight).flex_none().px(10).gap(8).items_center().border_b(1).border_color(c.separator)
        .child(icon("database", 16)).child(div().flex_1().min_w(0).truncate().text_color(c.secondary).child(context).tooltip(context)));
    const toolbar = h_flex().h(IDEA.toolbarHeight).flex_none().px(8).gap(8).items_center().border_b(1).border_color(c.separator);
    if (doc.spec.kind === "console") toolbar
      .child(button("run", "Choose Execution Scope", (_e, eventCx) => this.chooseQuery(eventCx), busy || doc.loading, true).tooltip("⌘Enter"))
      .child(action("stop", "Cancel Query", "stop", (_e, eventCx) => this.cancel(eventCx), !busy))
      .child(uiSeparator().h(18).w(1).flex_none())
      .child(action("save", "Save SQL draft", "save", (_e, eventCx) => this.saveDraft(eventCx), !doc.textDirty || doc.saving || doc.loading))
      .when(doc.textDirty, el => el.child(action("discard", "Discard SQL draft changes", "undo", (_e, eventCx) => this.discardDraft(eventCx), doc.saving || busy)))
      .child(div().flex_1()).child(uiCaption(T(doc.saving ? "Saving…" : doc.textDirty ? "Unsaved" : "Saved")));
    else if (doc.spec.kind === "ddl") toolbar.child(div().flex_1().font_semibold().child(doc.spec.table || "DDL"))
      .child(button("ddl-copy", "Copy DDL", (_e, eventCx) => eventCx.write_to_clipboard(doc.text), doc.loading));
    else toolbar.child(div().flex_1().min_w(0).truncate().font_semibold().child(doc.spec.table))
      .child(action("refresh", "Refresh", "refresh", (_e, eventCx) => this.load(doc, eventCx), blocked || !!doc.changes.size || !!this.editingCell))
      .child(button("ddl", "DDL", () => openDatabaseDocument({ ...doc.spec, kind: "ddl" }).catch(error => this.fail(error))))
      .child(action("delete", "Delete Rows", "trash", (_e, eventCx) => this.deleteRows(eventCx), blocked || !doc.selected.size || !doc.result?.primary_keys?.length))
      .child(button("import", "Import Data…", () => this.transferDialog("import"), blocked || !!doc.changes.size || !!this.editingCell))
      .child(button("export", "Export Data…", () => this.transferDialog("export"), blocked || !doc.result));
    root.child(toolbar);
    if (doc.error) root.child(uiCaption(doc.error).text_color(c.error).px(10).py(6));
    if (doc.status) root.child(uiCaption(doc.status).text_color(c.success).px(10).py(4));
    for (const warning of doc.warnings || []) root.child(uiCaption(warning).px(10).py(4));
    if (doc.loading) root.child(uiCaption(T("Loading…")).p(12));
    if (doc.spec.kind !== "table" && !doc.loading) {
      root.child(div().flex_1().min_h(0).min_w(0).flex().child(this.viewer.render(cx)));
      if (doc.spec.kind === "console") root.child(uiCaption(T("Confirm the SQL range, then view results in Run Results below.")).px(10).py(7).border_t(1).border_color(c.separator)
        .tooltip(T("Each Run uses a separate connection. Complete explicit transactions within one Run.")));
    } else if (doc.spec.kind === "table" && doc.result) {
      if (doc.changes.size || this.editingCell) root.child(h_flex().flex_none().min_h(IDEA.toolbarHeight).px(10).gap(8).items_center().bg(c.surface)
        .child(uiCaption(T(doc.applying ? "Applying changes…" : "Pending changes") + ` · ${doc.changes.size + (this.editingCell && !doc.changes.has(this.editingCell.row) ? 1 : 0)}`).flex_1())
        .when(Boolean(this.editingCell), el => el.child(button("cell-save", "Set Value", (_e, eventCx) => this.finishCell(eventCx)))
          .child(button("cell-null", "Set NULL", (_e, eventCx) => this.setCell(null, eventCx))))
        .child(button("revert", "Revert", (_e, eventCx) => this.revert(eventCx), blocked))
        .child(button("apply", "Apply Changes", (_e, eventCx) => this.apply(eventCx), blocked, true)));
      if (!doc.result.primary_keys?.length) root.child(uiCaption(T("Read-only rows. A primary key is required for updates and deletes.")).px(10).py(5));
      root.child(div().flex_1().min_h(0).flex().child(this.gridView(cx)));
      root.child(h_flex().h(32).flex_none().px(8).gap(6).items_center().border_t(1).border_color(c.separator)
        .child(uiCaption(`${doc.offset + (doc.result.rows.length ? 1 : 0)}–${doc.offset + doc.result.rows.length} ${T("rows")} · ${doc.selected.size} ${T("selected")}`).flex_1().truncate())
        .child(button("previous", "Previous", (_e, eventCx) => { if (blocked || doc.changes.size) return; doc.offset = Math.max(0, doc.offset - doc.limit); this.load(doc, eventCx); }, blocked || !!doc.changes.size || doc.offset === 0))
        .child(button("next", "Next", (_e, eventCx) => { if (blocked || doc.changes.size) return; doc.offset += doc.limit; this.load(doc, eventCx); }, blocked || !!doc.changes.size || doc.result.rows.length < doc.limit)));
    }
    if (doc.transferring) root.child(uiCaption(T("Transferring data…")).px(10).py(4));
    return editorSurface(root, { topCorners: Boolean(find(layout(), "editor-tabs")?.hidden) });
  }
  render(cx) {
    this.sync(cx); if (isIdea()) return this.renderIdea(cx);
    const doc = this.doc, c = uiColors();
    if (!doc) return div();
    const busy = doc.job && ["queued", "running"].includes(doc.job.state);
    const button = (id, text, action, disabled = false) => uiButton(`db-${id}`, T(text), action, { small: true, disabled });
    const action = (id, text, graphic, callback, disabled = false) => uiIconButton(`db-${id}`, icon(graphic, 14), callback, { tip: T(text), disabled });
    const toolbar = h_flex().flex_none().h(32).px(6).gap(4).items_center()
      .child(uiCaption(`${doc.source?.name || ""}${doc.spec.database ? " / " + doc.spec.database : ""}${doc.spec.schema ? " / " + doc.spec.schema : ""}`).flex_1().min_w(0).truncate());
    if (doc.spec.kind === "console") toolbar.children([
      ...(!isIdea() ? [button("edit", doc.editing ? "Select and Run" : "Edit SQL", (_e, eventCx) => this.toggleEditing(eventCx))] : []),
      action("save", "Save SQL draft", "save", (_e, eventCx) => this.saveDraft(eventCx), !doc.textDirty || doc.saving || doc.loading),
      action("discard", "Discard SQL draft changes", "undo", (_e, eventCx) => this.discardDraft(eventCx), !doc.textDirty || doc.saving || doc.loading || busy),
      button("run", "Run… (⌘Enter)", (_e, eventCx) => this.chooseQuery(eventCx), busy || doc.loading),
      action("stop", "Cancel Query", "x", (_e, eventCx) => this.cancel(eventCx), !busy),
    ]);
    else if (doc.spec.kind === "ddl") toolbar.children([button("ddl-copy", "Copy DDL", (_e, eventCx) => eventCx.write_to_clipboard(doc.text))]);
    const docked = isIdea() && doc.spec.kind === "console";
    if (doc.result && !docked) toolbar.children([
      action("copy", "Copy Rows", "copy", (_e, eventCx) => this.copy(eventCx)),
      button("format", EXTRACTORS.find(format => format.id === (doc.format || "csv"))?.label || "CSV", () => this.showExtractors()),
      action("export", "Export Data…", "download", () => this.transferDialog("export")),
    ]);
    if (doc.spec.kind === "table") toolbar.children([
      action("import", "Import Data…", "arrow-up", () => this.transferDialog("import"), !!doc.changes.size || !!this.editingCell || doc.applying || doc.transferring),
      action("delete", "Delete Rows", "trash", (_e, eventCx) => this.deleteRows(eventCx), !doc.selected.size || !doc.result?.primary_keys?.length || doc.applying || doc.transferring),
      action("apply", "Apply Changes", "check", (_e, eventCx) => this.apply(eventCx), (!doc.changes.size && !this.editingCell) || doc.applying || doc.transferring),
      action("revert", "Revert", "undo", (_e, eventCx) => this.revert(eventCx), (!doc.changes.size && !this.editingCell) || doc.applying || doc.transferring),
      action("refresh", "Refresh", "refresh", (_e, eventCx) => this.load(doc, eventCx), !!doc.changes.size || doc.loading || doc.applying || doc.transferring),
    ]);
    if (this.editingCell) toolbar.children([button("cell-save", "Set Value", (_e, eventCx) => this.finishCell(eventCx)), button("cell-null", "Set NULL", (_e, eventCx) => this.setCell(null, eventCx))]);
    const root = ideaUI(v_flex()).size_full().min_h(0).bg(c.editor).text_color(c.foreground).child(toolbar);
    if (doc.status) root.child(uiCaption(doc.status).text_color(c.success).px(10).py(4));
    if (doc.transferring) root.child(uiCaption(T("Transferring data…")).px(10).py(4));
    if (doc.applying) root.child(uiCaption(T("Applying changes…")).px(10).py(4));
    if (doc.error) root.child(uiCaption(doc.error).text_color(c.error || theme().ansi1).px(10).py(6));
    for (const warning of doc.warnings || []) root.child(uiCaption(warning).px(10));
    if (doc.loading) root.child(uiCaption(T("Loading…")).p(12));
    else if (doc.spec.kind !== "table") {
      if (doc.spec.kind === "console") root.child(uiCaption(T(doc.editing
        ? "Choose a statement or the entire script. Selection execution is available in Select and Run mode."
        : "Each Run uses a separate connection. Complete explicit transactions within one Run.")).px(8).py(4));
      root.child(div().flex_1().min_h(120).flex().on_key_down((event, eventCx) => {
        if (!doc.editing) return;
        if (event.key === "enter" && (event.modifiers?.platform || event.modifiers?.control)) { eventCx.stop_propagation(); this.chooseQuery(eventCx); }
      }).child(doc.editing ? Editor.new(this.editor).size_full() : this.viewer.render(cx)));
      if (doc.spec.kind === "console" && !doc.editing) {
        try { root.child(h_flex().flex_none().h(28).overflow_x_scrollbar().gap(4).px(6).items_center()
          .children(splitSQL(doc.text, { dialect: doc.source?.driver }).map((span, index) => button(`block-${index}`, `${T("Run Block")} ${index + 1}`, (_e, eventCx) => this.execute(span.text, eventCx), busy)))); }
        catch (error) { root.child(uiCaption(message(error)).px(8)); }
      }
    }
    if (doc.job && !docked) root.child(uiCaption(`${T(doc.job.state)} · ${doc.job.current}/${doc.job.total} · ${doc.job.elapsed_ms || 0} ms`).px(8).py(4));
    if (!docked && doc.job?.results?.length > 1) root.child(h_flex().flex_none().h(28).gap(4).children(doc.job.results.map((result, index) => button(`result-${index}`, `${T("Result")} ${index + 1} · ${result.rows?.length || 0} ${T("rows")}`, (_e, eventCx) => { doc.resultIndex = index; doc.result = result; doc.selected.clear(); eventCx.notify(); }))));
    if (doc.result && !docked) {
      if (doc.result.statement) root.child(uiCaption(`${T("Executed SQL")} · ${doc.result.elapsed_ms || 0} ms · ${doc.result.statement.replace(/\s+/gu, " ")}`).px(8).truncate().tooltip(doc.result.statement));
      if (doc.spec.kind === "table") {
        const pending = [...doc.changes.values()];
        root.child(uiCaption(`${T("Pending updates")} ${pending.filter(change => change.op === "update").length} · ${T("Pending deletes")} ${pending.filter(change => change.op === "delete").length}`).px(8).py(4));
        if (!doc.result.primary_keys?.length) root.child(uiCaption(T("Read-only rows. A primary key is required for updates and deletes.")).px(8));
      }
      root.child(div().flex_1().min_h(100).flex().child(this.gridView(cx)));
      root.child(h_flex().flex_none().h(28).px(8).gap(6).items_center()
        .child(uiCaption(`${doc.spec.kind === "table" && doc.result.rows.length ? `${doc.offset + 1}–${doc.offset + doc.result.rows.length}` : doc.result.rows?.length || 0} ${T("rows")} · ${doc.selected.size} ${T("selected")}${doc.spec.kind !== "table" && doc.result.truncated ? " · " + T("Result limited; use a narrower query or export the table.") : ""}${doc.result.affected_rows != null ? " · " + doc.result.affected_rows + " " + T("affected") : ""}`))
        .when(doc.spec.kind === "table", el => el.child(button("previous", "Previous", (_e, eventCx) => { if (doc.loading || doc.applying || doc.transferring || doc.changes.size) return; doc.offset = Math.max(0, doc.offset - doc.limit); this.load(doc, eventCx); }, doc.loading || doc.applying || doc.transferring || doc.offset === 0 || !!doc.changes.size))
          .child(button("next", "Next", (_e, eventCx) => { if (doc.loading || doc.applying || doc.transferring || doc.changes.size) return; doc.offset += doc.limit; this.load(doc, eventCx); }, doc.loading || doc.applying || doc.transferring || doc.result.rows.length < doc.limit || !!doc.changes.size))));
    }
    return editorSurface(root, { topCorners: Boolean(find(layout(), "editor-tabs")?.hidden) });
  }
}

// The bottom tool reuses DatabaseEditor's grid, selection, clipboard and
// extractor operations against execution snapshots, never the source document.
export class RunResults extends DatabaseEditor {
  init(_props, cx) {
    this.alive = true; this.documents = new Map(); this.grid = new Scroller();
    this.gridFocus = cx.focus_handle(); this.tabsFocus = cx.focus_handle();
    this.viewport = new TabViewport(); this.resultViewport = new TabViewport();
    this.transcript = EditorState.new({ language: "text", readonly: true, value: "", font_family: codeFont().family, font_size: codeFont().size });
    this.recoverExecutions(cx);
    this.recoveryTimer = cx.timer.every(1000, eventCx => this.recoverExecutions(eventCx));
    cx.spawn(async taskCx => {
      while (this.alive) {
        const command = await nextCommand();
        if (!this.alive) return;
        if (command === "focus") this.tabsFocus.focus();
        else if (command === "run-results-stop") this.stop(taskCx);
        else if (command.startsWith("database-grid:") || command.startsWith("database-transfer:")) {
          try {
            const grid = command.startsWith("database-grid:"), item = JSON.parse(command.slice(grid ? 14 : 18));
            const entry = executionStore().entries.find(entry => entry.id === item.path);
            if (!entry || entry.kind !== "sql") continue;
            this.doc = this.resultDocument(entry);
            if (grid) this.gridAction(item, taskCx); else this.transfer(item, taskCx);
          } catch (error) { this.fail(error); }
        }
        taskCx.notify();
      }
    });
  }
  release() { this.alive = false; this.recoveryTimer?.cancel(); this.gridFocus.release(); this.tabsFocus.release(); this.transcript.release(); }
  recoverExecutions(cx) {
    if (!this.alive) return;
    const scope = editorKey();
    for (const entry of executionStore(scope).entries) {
      if (!executionBusy(entry) || !claimExecution(entry.id, scope)) continue;
      cx.spawn(async taskCx => {
        try {
          if (entry.kind === "sql") {
            if (!entry.job?.id) throw new Error(T("SQL job ID was lost. Check the database before running again."));
            while (this.alive) {
              const current = executionStore(scope).entries.find(item => item.id === entry.id);
              if (!executionBusy(current)) break;
              const job = await request("db_job", { job_id: entry.job.id }, taskCx);
              updateExecution(entry.id, { job, state: job.state, error: job.error || null, elapsed_ms: job.elapsed_ms || 0, stopRequested: false }, scope);
              if (!executionBusy(job)) break;
              if (this.alive) taskCx.notify();
              await taskCx.sleep(300);
            }
          } else if (entry.processOwned) {
            const status = await inspectExecutionTerminal(entry);
            updateExecution(entry.id, { ...status, continuityLost: false }, scope);
            if (entry.stopRequested && status.state === "running") await interruptExecution({ ...entry, ...status, stopRequested: true }, scope);
          } else {
            const { output: _terminalHistory, ...status } = await inspectExecutionTerminal(entry);
            // The pre-run baseline belonged to the previous VM. Preserve its
            // captured log instead of attaching another execution's history.
            updateExecution(entry.id, { ...status, state: status.state || "untracked", continuityLost: true, stopRequested: false }, scope);
            if (!status.state) markUntrackedSession(entry);
          }
        } catch (error) {
          updateExecution(entry.id, { state: entry.kind === "shell" ? "untracked" : "error", error: entry.kind === "sql" ? `${T("Execution status could not be recovered")} · ${message(error)}` : null, continuityLost: entry.kind === "shell", stopRequested: false }, scope);
          if (entry.kind === "shell") markUntrackedSession(entry);
        } finally { releaseExecution(entry.id, scope); if (this.alive) taskCx.notify(); }
      });
    }
  }
  // SQL source owners publish dirty/busy close protection. Results are copies.
  publishState() {}
  resultDocument(entry) {
    let doc = this.documents.get(entry.id);
    if (!doc) {
      doc = { path: entry.id, spec: { ...entry.spec, kind: "console" }, source: entry.source, selected: new Set(), changes: new Map(), offset: 0, resultIndex: 0 };
      this.documents.set(entry.id, doc);
    }
    doc.job = entry.job;
    doc.result = entry.job?.results?.[doc.resultIndex] || null;
    return doc;
  }
  select(id, cx) {
    selectExecution(id); this.tabsFocus.focus(); this.grid.setTop(0); this.grid.setLeft(0); cx.notify();
  }
  close(id, cx) {
    if (this.documents.get(id)?.transferring) return;
    if (closeExecution(id)) this.documents.delete(id);
    this.tabsFocus.focus(); cx.notify();
  }
  stop(cx) {
    const scope = editorKey(), state = executionStore(scope), entry = state.entries.find(entry => entry.id === state.selected);
    if (!executionBusy(entry) || entry.stopRequested) return;
    updateExecution(entry.id, { stopRequested: true }, scope);
    cx.spawn(async taskCx => {
      try {
        if (entry.kind === "shell") {
          await interruptExecution(entry, scope);
        } else if (entry.job?.id) {
          const job = await request("db_cancel", { job_id: entry.job.id }, taskCx);
          updateExecution(entry.id, { job, state: job.state }, scope);
        }
      } catch (error) { updateExecution(entry.id, { stopRequested: false }, scope); this.fail(error); }
      if (this.alive) taskCx.notify();
    });
  }
  syncTerminal(cx) {
    if (!isIdea() || this.layoutUpdating || this.layoutError) return;
    const state = executionStore(), entry = state.entries.find(item => item.id === state.selected);
    const terminal = runTerminalContent(entry), height = Math.max(IDEA.tabHeight, uiSize() + 16) + IDEA.toolbarHeight;
    const tree = JSON.parse(JSON.stringify(layout()));
    if (!executionTerminalLayout(tree, terminal, height)) return;
    this.layoutUpdating = true;
    cx.timer.after(0, eventCx => eventCx.spawn(async taskCx => {
      try {
        if (!this.alive || !isIdea()) return;
        const latest = executionStore(), selected = latest.entries.find(item => item.id === latest.selected);
        const current = JSON.parse(JSON.stringify(layout()));
        if (executionTerminalLayout(current, runTerminalContent(selected), Math.max(IDEA.tabHeight, uiSize() + 16) + IDEA.toolbarHeight)) await setLayout(current);
        this.layoutError = null;
      } catch (error) { this.layoutError = message(error); }
      finally { this.layoutUpdating = false; if (this.alive) taskCx.notify(); }
    }));
  }
  render(cx) {
    const state = executionStore(), entry = state.entries.find(entry => entry.id === state.selected), c = uiColors();
    this.syncTerminal(cx);
    for (const id of this.documents.keys()) if (!state.entries.some(entry => entry.id === id) && !this.documents.get(id).transferring) this.documents.delete(id);
    const root = ideaUI(v_flex()).size_full().min_h(0).min_w(0).bg(c.editor).text_color(c.foreground);
    const tabs = state.entries.map(item => ({ id: item.id, content: uiTab(`execution-tab-${item.id}`, [
      executionBusy(item) ? uiSpinner(() => icon("progress", 14)) : icon(item.kind === "sql" ? "database" : "play", 14),
      div().max_w(200).truncate().child(`${item.name} · ${item.sequence}`),
      uiIconButton(`execution-close-${item.id}`, icon("x", 12), (_event, eventCx) => this.close(item.id, eventCx), { tip: T("Close"), size: 18, disabled: executionBusy(item) || !!this.documents.get(item.id)?.transferring }),
    ], { selected: item.id === state.selected, onSelect: (_event, eventCx) => this.select(item.id, eventCx),
      ...(!executionBusy(item) ? { onClose: (_event, eventCx) => this.close(item.id, eventCx) } : {}), tip: `${item.command}\n${T(item.state)}` }) }));
    root.child(h_flex().h(Math.max(IDEA.tabHeight, uiSize() + 16)).flex_none().min_w(0).track_focus(this.tabsFocus)
      .on_key_down((event, eventCx) => {
        const key = event.key, index = state.entries.findIndex(item => item.id === state.selected), length = state.entries.length;
        if (!length || !["left", "right", "home", "end"].includes(key) || event.modifiers?.platform || event.modifiers?.control || event.modifiers?.alt) return;
        eventCx.stop_propagation();
        const at = key === "home" ? 0 : key === "end" ? length - 1 : (index + (key === "left" ? -1 : 1) + length) % length;
        this.select(state.entries[at].id, eventCx);
      }).child(uiTabStrip("execution-tabs", tabs, state.selected, this.viewport)));
    if (isIdea() && runTerminalContent(entry)) {
      const detail = `${entry.folder || ""} · ${T(entry.state)} · ${entry.elapsed_ms || 0} ms`;
      return root.child(h_flex().h(IDEA.toolbarHeight).flex_none().min_w(0).px(8).items_center()
        .child(uiCaption(entry.error || this.layoutError || detail).truncate().flex_1().min_w(0)
          .text_color(entry.error || this.layoutError ? c.error : c.secondary).tooltip(entry.error || this.layoutError || `${entry.command}\n${detail}`))
        .when(Boolean(this.layoutError), el => el.child(uiButton("execution-layout-retry", T("Retry"), (_event, eventCx) => { this.layoutError = null; eventCx.notify(); }, { small: true }))));
    }
    root.child(uiCaption(T("Recent completed runs: {count}", { count: EXECUTION_HISTORY_LIMIT })).px(8).py(2)
      .tooltip(T("History is bounded to 32 MiB. Selected and running results are kept.")));
    if (!entry) return root.child(uiCaption(T("Run a configuration or SQL query to see its results here.")).p(12));
    root.child(uiCaption(`${entry.kind === "sql" ? [entry.source?.name || entry.spec.source_id, entry.spec.database, entry.spec.schema].filter(Boolean).join(" / ") : entry.folder} · ${T(entry.state === "untracked" ? "Execution status unavailable" : entry.state)} · ${entry.elapsed_ms || 0} ms`).px(8).py(4));
    if (entry.state === "untracked") root.child(uiCaption(T("The process may still be running. Check its terminal before restarting.")).px(8).py(2));
    if (entry.continuityLost) root.child(uiCaption(T("Output continuity was lost after restart. Previously captured output is preserved.")).px(8).py(2));
    if (entry.error) root.child(uiCaption(entry.error).text_color(c.error).px(8).py(4));
    const transcript = entry.kind === "sql" ? entry.command : `$ ${entry.command}\n${entry.output || ""}`;
    if (this.transcriptText !== transcript) {
      this.transcriptText = transcript;
      cx.timer.after(0, eventCx => { if (this.alive && this.transcriptText === transcript) { this.transcript.set_value(transcript); eventCx.notify(); } });
    }
    if (entry.kind === "shell") return root.child(uiCaption(T(entry.completionUnavailable ? "Terminal output · automatic completion is unavailable for this shell; Stop ends this result" : "Terminal output · up to 2,000 history lines · exit status captured")).px(8).py(2))
      .child(div().flex_1().min_h(0).flex().child(Editor.new(this.transcript).size_full()));
    this.doc = this.resultDocument(entry);
    const doc = this.doc;
    if (this.showSQL) root.child(div().h(80).flex_none().flex().child(Editor.new(this.transcript).size_full()));
    if (executionBusy(entry)) root.child(uiCaption(`${T(doc.job?.state || entry.state)} · ${doc.job?.current || 0}/${doc.job?.total || 0}`).px(8).py(2));
    if (!isIdea() && doc.job?.results?.length > 1) root.child(h_flex().h(28).flex_none().overflow_x_scrollbar().gap(4).children(doc.job.results.map((result, index) => uiButton(`execution-statement-${index}`, `${T("Result")} ${index + 1} · ${result.rows?.length || 0} ${T("rows")}`, (_event, eventCx) => {
      doc.resultIndex = index; doc.result = result; doc.selected.clear(); doc.focusedCell = null; this.grid.setTop(0); this.grid.setLeft(0); eventCx.notify();
    }, { small: true, primary: doc.resultIndex === index }))));
    if (isIdea() && doc.job?.results?.length > 1) root.child(h_flex().h(IDEA.tabHeight).flex_none().min_w(0)
      .child(uiTabStrip("execution-statement-tabs", doc.job.results.map((result, index) => ({ id: String(index),
        content: uiTab(`execution-statement-${index}`, [icon("table", 14), `${T("Result")} ${index + 1}`, uiCaption(`${result.rows?.length || 0} ${T("rows")}`)], {
          selected: doc.resultIndex === index, onSelect: (_event, eventCx) => {
            doc.resultIndex = index; doc.result = result; doc.selected.clear(); doc.focusedCell = null; this.grid.setTop(0); this.grid.setLeft(0); eventCx.notify();
          }, tip: result.statement || "" }) })), String(doc.resultIndex || 0), this.resultViewport)));
    if (doc.result) {
      root.child(h_flex().h(30).flex_none().px(6).gap(4).items_center()
        .child(uiButton("execution-sql", T(this.showSQL ? "Hide Executed SQL" : "Executed SQL"), (_event, eventCx) => { this.showSQL = !this.showSQL; eventCx.notify(); }, { small: true }))
        .child(uiCaption(`${doc.result.rows.length} ${T("rows")} · ${doc.selected.size} ${T("selected")}${doc.result.affected_rows != null ? ` · ${doc.result.affected_rows} ${T("affected")}` : ""}`).flex_1().min_w(0).truncate())
        .when(!isIdea(), el => el.child(uiIconButton("execution-copy", icon("copy", 14), (_event, eventCx) => this.copy(eventCx), { tip: T("Copy Rows") }))
          .child(uiButton("execution-extractor", EXTRACTORS.find(format => format.id === (doc.format || "csv"))?.label || "CSV", () => this.showExtractors(), { small: true })))
        .child(uiButton("execution-export", T("Export Data…"), () => this.transferDialog("export"), { small: true, disabled: doc.transferring })));
      if (doc.result.truncated) root.child(uiCaption(T("Result limited; use a narrower query or export the table.")).px(8));
      if (doc.status) root.child(uiCaption(doc.status).px(8));
      if (doc.error) root.child(uiCaption(doc.error).text_color(c.error).px(8));
      if (doc.transferring) root.child(uiCaption(T("Transferring data…")).px(8));
      root.child(div().flex_1().min_h(0).flex().child(this.gridView(cx)));
      if (isIdea()) root.child(uiCaption(`${doc.selected.size} ${T("selected")} · ${T("Copy Rows")} ⌘C`).px(10).py(5).border_t(1).border_color(c.separator));
    }
    return root;
  }
}

export class DatabaseQueryMenu {
  init(props, cx) {
    this.props = props; this.menu = new MenuController(cx); this.menu.focus.focus(); this.selected = 0;
    if (isIdea() && !props.grid) this.preview = EditorState.new({ language: "sql", readonly: true, value: props.candidates?.[0]?.text || "", font_family: codeFont().family, font_size: codeFont().size });
  }
  release() { this.preview?.release(); this.menu.release(); this.menu.focus.release(); }
  render(cx) {
    const p = this.props;
    if (isIdea() && !p.grid) {
      const candidates = p.candidates || [], current = candidates[this.selected], c = uiColors();
      const choose = (id, _event, eventCx) => { this.selected = Number(id); this.preview.set_value(candidates[this.selected]?.text || ""); eventCx.notify(); };
      const execute = () => {
        if (this.submitted || !candidates[this.selected]) return;
        this.submitted = true;
        run(`codenav.database-execute:${JSON.stringify({ path: p.path, sql: candidates[this.selected].text })}`); closeOverlay(p.overlay);
      };
      return uiDialog("database-query-dialog", { title: T("Choose SQL to execute"),
        body: v_flex().size_full().min_h(0).gap(10)
          .child(uiCaption(p.source || ""))
          .child(h_flex().flex_1().min_h(0).items_stretch().gap(14)
            .child(v_flex().w(220).h_full().min_h(0).flex_none().border_r(1).border_color(c.separator)
              .child(uiManagedList("database-query-choices", candidates.map((span, index) => ({ id: String(index), label: T(span.label || "Statement"), detail: `${span.firstLine || 1}–${span.lastLine || 1} ${T("Lines")}`, icon: () => icon("code", 16) })), this.menu, cx,
                { selectedId: String(this.selected), onSelect: choose, onActivate: execute, onClose: () => closeOverlay(p.overlay) })))
            .child(v_flex().flex_1().h_full().min_w(0).min_h(0).gap(8)
              .child(div().font_semibold().child(`${T(current?.label || "Statement")} · ${current?.firstLine || 1}–${current?.lastLine || 1} ${T("Lines")}`))
              .child(div().flex_1().min_h(0).flex().border(1).border_color(c.border).child(Editor.new(this.preview).size_full())))),
        footer: h_flex().gap(8).child(uiButton("db-query-cancel", T("Cancel"), () => closeOverlay(p.overlay)))
          .child(uiButton("db-query-execute", T("Run Selected SQL"), execute, { primary: true, disabled: !current || this.submitted })) }).size_full();
    }
    if (p.grid) {
      const rows = [
        { id: "edit", label: T("Edit Cell"), shortcut: "F2", disabled: !p.editable },
        { id: "copy", label: T("Copy Rows") },
        { id: "format", label: T("Data Extractor…") },
        { id: "export", label: T("Export Data…") },
        { id: "ddl", label: T("View DDL"), disabled: !p.table },
      ].map(row => ({ ...row, action: () => run(`codenav.database-grid:${JSON.stringify({ path: p.path, action: row.id })}`) }));
      return uiMenu("database-grid-menu", rows, this.menu, cx, { width: 280, onClose: () => closeOverlay(p.overlay) });
    }
    const rows = [{ id: "title", label: `${T("Choose SQL to execute")} · ${p.source || ""}`, disabled: true }, ...(p.candidates || []).map((span, index) => ({ id: String(index),
      label: `${T(span.label || "Statement")} · ${T("Lines")} ${span.firstLine || 1}–${span.lastLine || 1} · ${span.text.replace(/\s+/gu, " ").slice(0, 150)}`,
      action: () => run(`codenav.database-execute:${JSON.stringify({ path: p.path, sql: span.text })}`) }))];
    return uiMenu("database-query", rows, this.menu, cx, { width: 640, maxHeight: 360, onClose: () => closeOverlay(p.overlay) });
  }
}

export class DatabaseTransfer {
  init(props, cx) {
    this.alive = true; this.generation = 0; this.props = props; this.format = props.format || "csv"; this.destination = "file"; this.scope = props.table ? "table" : props.selectedCount ? "selected" : "loaded";
    this.file = InputState.new({ placeholder: T("Absolute file path"), value: "" });
    this.file.on("change", (_event, eventCx) => { this.reviewed = null; this.error = null; ++this.generation; eventCx.notify(); });
    this.preview = EditorState.new({ language: this.format.startsWith("sql") ? "sql" : "text", readonly: true, value: "" });
    this.menu = new MenuController(cx); this.formatChoice = new DatabaseChoice(cx); this.scopeChoice = new DatabaseChoice(cx); if (props.mode === "format") this.menu.focus.focus();
  }
  release() { this.alive = false; this.generation++; this.file.release(); this.preview.release(); this.menu.release(); this.menu.focus.release(); this.formatChoice.release(); this.scopeChoice.release(); }
  choose(format, cx) { this.format = format; this.error = null; this.updatePreview(cx); }
  updatePreview(cx) {
    if (!this.props.dataset) return;
    const data = this.scope === "selected" ? this.props.dataset : this.props.loaded || this.props.dataset;
    try { this.preview.set_value(extractData({ ...data, rows: data.rows.slice(0, 20) }, this.format)); }
    catch (error) { this.error = message(error); }
    cx.notify();
  }
  previewImport(cx) {
    const file = this.file.value(), format = this.format, generation = ++this.generation; this.reviewed = null; this.error = null;
    const current = () => this.alive && generation === this.generation && this.file.value() === file && this.format === format;
    cx.spawn(async taskCx => {
      try { const text = await readTextFile(file); if (!current()) return; const result = parseImport(text, format); this.preview.set_value(extractData({ ...result, rows: result.rows.slice(0, 20) }, "csv")); this.reviewed = { file, format, rows: result.rows.length, text }; }
      catch (error) { if (current()) this.error = message(error); }
      if (current()) taskCx.notify();
    });
  }
  render(cx) {
    const p = this.props;
    if (p.mode === "format") return uiMenu("database-extractors", EXTRACTORS.map(format => ({ id: format.id, label: format.label,
      action: () => run(`codenav.database-transfer:${JSON.stringify({ path: p.path, mode: "format", format: format.id })}`) })), this.menu, cx,
      { width: 260, onClose: () => closeOverlay(p.overlay) });
    if (!this.initialized) { this.initialized = true; cx.timer.after(0, eventCx => this.updatePreview(eventCx)); }
    const importing = p.mode === "import", formats = importing ? EXTRACTORS.filter(format => ["csv", "tsv", "json"].includes(format.id)) : EXTRACTORS;
    const send = destination => {
      if (importing && (!this.reviewed || this.reviewed.file !== this.file.value() || this.reviewed.format !== this.format)) return;
      const item = { path: p.path, mode: p.mode, format: this.format, file: this.file.value(), destination, scope: this.scope,
        ...(importing ? { reviewedText: this.reviewed.text } : {}) };
      run(`codenav.database-transfer:${JSON.stringify(item)}`); closeOverlay(p.overlay);
    };
    if (isIdea()) {
      const c = uiColors(), field = (label, control) => v_flex().flex_none().gap(6).child(uiCaption(T(label))).child(control);
      const options = formats.map(format => ({ id: format.id, label: format.label }));
      const scopes = [...(p.selectedCount ? [{ id: "selected", label: `${T("Selected Rows")} · ${p.selectedCount}` }] : []), { id: "loaded", label: `${T("Loaded Rows")} · ${p.loaded?.rows?.length || 0}` }, ...(p.table ? [{ id: "table", label: T("Entire Table") }] : [])];
      return uiDialog("database-transfer", { title: T(importing ? "Import Data" : "Export Data"),
        body: v_flex().size_full().min_h(0).gap(12).child(uiCaption(p.source || ""))
          .child(h_flex().flex_1().min_h(0).items_stretch().gap(20)
            .child(v_flex().w(250).flex_none().h_full().gap(16)
              .when(!importing, el => el.child(field("Scope", this.scopeChoice.render("db-export-scope", T("Scope"), scopes, this.scope, (value, eventCx) => { this.scope = value; this.updatePreview(eventCx); }, cx))))
              .child(field("Format", this.formatChoice.render("db-transfer-format", T("Format"), options, this.format, (value, eventCx) => this.choose(value, eventCx), cx)))
              .child(field(importing ? "Source File" : "File Destination", uiInputBox(Input.new(this.file).w_full())))
              .child(uiCaption(T(importing ? "Column names come from file headers. All rows are inserted in one transaction." : "Preview samples up to 20 loaded rows. Entire-table export reads all pages. Pending changes are excluded.")))
              .when(Boolean(this.error), el => el.child(uiCaption(this.error).text_color(c.error)))
              .when(Boolean(this.reviewed), el => el.child(uiCaption(`${this.reviewed.rows} ${T("rows to import")}`).text_color(c.success))))
            .child(v_flex().flex_1().h_full().min_w(0).min_h(0).gap(6).child(uiCaption(T("Preview")))
              .child(div().flex_1().min_h(0).flex().border(1).border_color(c.border).child(Editor.new(this.preview).size_full())))),
        footer: h_flex().gap(8)
          .child(uiButton("db-transfer-cancel", T("Close"), () => closeOverlay(p.overlay)))
          .when(importing, el => el.child(uiButton("db-import-preview", T("Preview Import"), (_e, eventCx) => this.previewImport(eventCx)))
            .child(uiButton("db-import-apply", T("Import Rows"), () => send("table"), { primary: true, disabled: !this.reviewed || this.reviewed.file !== this.file.value() || this.reviewed.format !== this.format })))
          .when(!importing, el => el.child(uiButton("db-export-copy", T("Copy to Clipboard"), () => send("clipboard")))
            .child(uiButton("db-export-file", T("Export to File"), () => send("file"), { primary: true, disabled: !this.file.value() }))) }).size_full();
    }
    return uiDialog("database-transfer", { title: T(importing ? "Import Data" : "Export Data"),
      body: v_flex().size_full().min_h(0).gap(8)
        .child(uiCaption(p.source || ""))
        .child(h_flex().flex_none().gap(4).flex_wrap().children(formats.map(format => uiButton(`db-format-${format.id}`, format.label, (_event, eventCx) => this.choose(format.id, eventCx), { small: true, primary: this.format === format.id }))))
        .child(uiInputBox(Input.new(this.file)))
        .when(!importing, el => el.child(h_flex().gap(6).children([...(p.selectedCount ? ["selected"] : []), "loaded", ...(p.table ? ["table"] : [])].map(scope => uiButton(`db-export-${scope}`, T(scope === "table" ? "Entire Table" : scope === "loaded" ? "Loaded Rows" : "Selected Rows"), (_e, eventCx) => { this.scope = scope; this.updatePreview(eventCx); }, { small: true, primary: this.scope === scope })))))
        .child(uiCaption(T(importing ? "Column names come from file headers. All rows are inserted in one transaction." : "Preview samples up to 20 loaded rows. Entire-table export reads all pages. Pending changes are excluded.")))
        .when(Boolean(this.error), el => el.child(uiCaption(this.error).text_color(theme().ansi1)))
        .when(Boolean(this.reviewed), el => el.child(uiCaption(`${this.reviewed.rows} ${T("rows to import")}`)))
        .child(div().flex_1().min_h(0).flex().child(Editor.new(this.preview).size_full())),
      footer: h_flex().gap(6).justify_end()
        .child(uiButton("db-transfer-cancel", T("Cancel"), () => closeOverlay(p.overlay)))
        .when(importing, el => el.child(uiButton("db-import-preview", T("Preview Import"), (_e, eventCx) => this.previewImport(eventCx)))
          .child(uiButton("db-import-apply", T("Import Rows"), () => send("table"), { primary: true, disabled: !this.reviewed || this.reviewed.file !== this.file.value() || this.reviewed.format !== this.format })))
        .when(!importing, el => el.child(uiButton("db-export-copy", T("Copy to Clipboard"), () => send("clipboard")))
          .child(uiButton("db-export-file", T("Export to File"), () => send("file"), { primary: true, disabled: !this.file.value() }))),
    }).size_full();
  }
}

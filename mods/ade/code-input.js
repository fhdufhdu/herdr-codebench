import { div } from "gpui-kit";
import { h_flex, v_flex, TextareaState, Textarea, InputState, Input, HoverCard, Popup } from "gpui-base";
import { window as appWindow, settings, shared } from "herdr";
import { adeColors, adeUI, adeSize, adeButton, adeInputBox, adeGutterAction, uiSelectableText } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { gutterIcon } from "./gutter-navigation.js";
import { graphemeSegments } from "./editor-state-vendor.js";
import { CodeDocument, identifierText } from "./code-document.js";

const PREFIX = "ade-code::", CONTEXT = "ADECodeInput", SQL_CONTEXT = "ADECodeSQL", LANGUAGE_CONTEXT = "ADECodeLanguage";
let boundPlatform;
let nextId = 0;
// Map only the immediate prior revision; semantic confirmation still belongs to LSP.
function mapSpans(spans, delta, edits, tokens) {
  return spans.flatMap(span => {
    if (!Number.isInteger(span.from) || !Number.isInteger(span.to) || span.from < 0 || span.to < span.from || span.to > delta.before.length) return [];
    let edited = false, extendIdentifier = false;
    const oldIdentifier = tokens && span.to > span.from && identifierText(delta.before.sliceString(span.from, span.to));
    for (const edit of edits) {
      const insertion = edit.from === edit.to;
      const inside = span.from === span.to ? edit.from <= span.from && edit.to >= span.to
        : insertion ? edit.from > span.from && edit.from < span.to : edit.from < span.to && edit.to > span.from;
      const joinsIdentifier = insertion && (edit.from === span.from || edit.from === span.to) && identifierText(edit.insert);
      if (!inside && !joinsIdentifier) continue;
      edited = true;
      if (!oldIdentifier || edit.from < span.from || edit.to > span.to || edit.from <= span.from && edit.to >= span.to
        || edit.insert && !identifierText(edit.insert)) return [];
      extendIdentifier = true;
    }
    if (edited && !tokens) return [];
    const from = delta.changes.mapPos(span.from, extendIdentifier ? -1 : 1), to = delta.changes.mapPos(span.to, extendIdentifier ? 1 : -1);
    if (from > to || tokens && from === to) return [];
    return [{ ...span, from, to, provisional: true }];
  });
}
export function codeBindings(platform) {
  const primary = platform === "macos" ? "cmd" : "ctrl";
  const entries = [];
  for (const direction of ["left", "right", "up", "down", "home", "end", "pageup", "pagedown"]) {
    entries.push([direction, direction], [`shift-${direction}`, `select-${direction}`]);
  }
  const word = platform === "macos" ? "alt" : "ctrl";
  entries.push(["backspace", "backspace"], ["delete", "delete"], ["enter", "newline"], ["tab", "tab"], ["shift-tab", "outdent"],
    [`${word}-left`, "word-left"], [`${word}-right`, "word-right"], [`${word}-shift-left`, "select-word-left"], [`${word}-shift-right`, "select-word-right"],
    [`${word}-backspace`, "delete-word-left"], [`${word}-delete`, "delete-word-right"],
    [`${primary}-a`, "all"], [`${primary}-s`, "save"], [`${primary}-z`, "undo"], [`${primary}-shift-z`, "redo"],
    [`${primary}-f`, "find"], [`${primary}-g`, "find-next"], [`${primary}-shift-g`, "find-previous"], [platform === "macos" ? "cmd-r" : "ctrl-h", "replace"],
    [`${primary}-c`, "copy"], [`${primary}-x`, "cut"], [`${primary}-v`, "paste"]);
  if (platform === "macos") entries.push(["cmd-left", "home"], ["cmd-right", "end"], ["cmd-up", "first"], ["cmd-down", "last"],
    ["cmd-shift-left", "select-home"], ["cmd-shift-right", "select-end"], ["cmd-shift-up", "select-first"], ["cmd-shift-down", "select-last"], ["ctrl-a", "home"], ["ctrl-e", "end"],
    ["cmd-backspace", "delete-line-start"], ["cmd-delete", "delete-line-end"]);
  else entries.push(["ctrl-home", "first"], ["ctrl-end", "last"], ["ctrl-shift-home", "select-first"], ["ctrl-shift-end", "select-last"], ["ctrl-y", "redo"]);
  const readOnly = entries.filter(([_key, command]) => !["save", "execute", "cut", "paste", "undo", "redo", "newline", "tab", "outdent", "backspace", "delete", "replace"].includes(command) && !command.startsWith("delete-"));
  return [...[CONTEXT, SQL_CONTEXT, LANGUAGE_CONTEXT].flatMap(context => entries.map(([keystroke, command]) => ({ keystroke, action: PREFIX + command, context: `${context} > Input` }))),
    ...[SQL_CONTEXT, LANGUAGE_CONTEXT].flatMap(context => [
      { keystroke: "ctrl-space", action: PREFIX + "complete", context: `${context} > Input` },
      { keystroke: "escape", action: PREFIX + "escape", context: `${context} > Input` },
      { keystroke: `${primary}-/`, action: PREFIX + "toggle-comment", context: `${context} > Input` },
    ]),
    { keystroke: platform === "macos" ? "cmd-alt-l" : "ctrl-alt-l", action: PREFIX + "format", context: `${LANGUAGE_CONTEXT} > Input` },
    { keystroke: platform === "macos" ? "cmd-alt-b" : "ctrl-alt-b", action: PREFIX + "implementation", context: `${LANGUAGE_CONTEXT} > Input` },
    { keystroke: platform === "macos" ? "cmd-u" : "ctrl-u", action: PREFIX + "super", context: `${LANGUAGE_CONTEXT} > Input` },
    ...readOnly.map(([keystroke, command]) => ({ keystroke, action: PREFIX + command, context: "ADECodeReadOnly" })),
    ...entries.filter(([_key, command]) => ["find", "replace", "find-next", "find-previous"].includes(command)).map(([keystroke, command]) => ({ keystroke, action: PREFIX + command, context: "ADECodeFind > Input" })),
    ...[["escape", "find-close"], ["enter", "find-next"], ["shift-enter", "find-previous"]].map(([keystroke, command]) => ({ keystroke, action: PREFIX + command, context: "ADECodeFind > Input" })),
    ...["ADECodeComposition", "ADECodeSQLComposition"].map(context => ({ keystroke: `${primary}-s`, action: PREFIX + "save", context: `${context} > Input` })),
    ...[SQL_CONTEXT, "ADECodeSQLComposition"].map(context => ({ keystroke: `${primary}-enter`, action: PREFIX + "execute", context: `${context} > Input` }))];
}

// Fresh ADE source editor: one CodeMirror document, one OS text boundary.
export class CodeInput {
  init(text, cx, { onChange, onSelection, onSave, onExecute, onNavigate, onContextMenu, onComplete, onFormat, onCommand, onToggleComment, onGutter, readOnly = false } = {}) {
    this.id = `ade-code-${++nextId}`;
    this.model = new CodeDocument(text);
    this.readOnly = readOnly;
    this.callbacks = { onChange, onSelection, onSave, onExecute, onNavigate, onContextMenu, onComplete, onFormat, onCommand, onToggleComment, onGutter };
    this.gutterMarkers = new Map();
    this.alive = true;
    this.resetting = false;
    this.dragging = false;
    this.pendingWidth = 0;
    this.contentWidth = 0;
    this.viewport = { width: 0, height: 0 };
    this.windowStart = 0;
    this.windowRows = 20;
    this.tokens = [];
    this.diagnostics = [];
    this.fontSize = 14;
    this.rowHeight = 24;
    this.focusHandle = cx.focus_handle();
    this.findFocus = cx.focus_handle(); this.matchCase = false; this.searchInfo = { total: 0, match: null };
    this.findText = InputState.new(); this.replaceText = InputState.new();
    this.findText.on("change", (_event, eventCx) => { if (!this.findUpdating) { this.searchNotice = ""; this.findNext(1, eventCx, true); } });
    this.input = TextareaState.new({ value: "", rows: 1 });
    this.input.set_rows(1);
    this.input.set_auto_grow(1, 1);
    this.input.set_soft_wrap(false);
    this.input.on("change", (_event, eventCx) => {
      if (!this.alive || this.resetting || this.readOnly) return;
      const committed = this.input.value();
      if (!committed) return;
      this.model.replace(committed);
      this.resetting = true;
      try { this.input.set_value(""); } finally { this.resetting = false; }
      this.input.focus();
      this.pendingWidth = 0;
      this.changed(eventCx);
      if (this.savePending) { this.savePending = false; this.callbacks.onSave?.(eventCx); }
    });
    const platform = appWindow()?.platform ?? "macos";
    if (boundPlatform !== platform) { cx.bind_keys(codeBindings(platform)); boundPlatform = platform; }
    return this;
  }
  value() { return this.model.value(); }
  selection() { return this.model.selection(); }
  get hasPendingText() { return Boolean(this.input.value()); }
  get revision() { return this.model.revision; }
  get completionViewport() {
    return { ...this.viewport, caretTop: (this.model.doc.lineAt(this.selection().head).number - 1 - this.windowStart) * this.rowHeight, caretHeight: this.rowHeight };
  }
  set tokens(spans) { this._tokens = [...spans].sort((a, b) => a.from - b.from); this.tokensRevision = this.revision; }
  get tokens() { return this._tokens; }
  set diagnostics(spans) {
    this.diagnosticsRevision = this.revision;
    this._diagnostics = [];
    this.diagnosticLines = new Map();
    for (const span of spans) {
      if (!Number.isFinite(span.from) || !Number.isFinite(span.to)) continue;
      const from = Math.max(0, Math.min(this.model.doc.length, Math.trunc(span.from)));
      const to = Math.max(from, Math.min(this.model.doc.length, Math.trunc(span.to)));
      const item = { ...span, from, to, severity: [1, 2, 3, 4].includes(span.severity) ? span.severity : 1 };
      this._diagnostics.push(item);
      const first = this.model.doc.lineAt(from).number;
      const last = this.model.doc.lineAt(to).number;
      for (let line = first; line <= last; line++) {
        if (!this.diagnosticLines.has(line)) this.diagnosticLines.set(line, []);
        this.diagnosticLines.get(line).push(item);
      }
    }
  }
  get diagnostics() { return this._diagnostics; }
  diagnosticsAt(line, from, to) {
    return (this.diagnosticLines.get(line) ?? []).filter(item => item.from === item.to
      ? item.from >= from && item.from < to
      : item.from < to && item.to > from);
  }
  decorate(id, cell, diagnostics) {
    if (!diagnostics.length) return cell;
    const c = adeColors(), color = severity => severity === 1 ? c.error : severity === 2 ? c.warning : c.accent;
    const severity = Math.min(...diagnostics.map(item => item.severity));
    const groups = [1, 2, 3, 4].map(level => ({
      severity: level,
      messages: [...new Set(diagnostics.filter(item => item.severity === level).map(item => String(item.message ?? "")))],
    })).filter(group => group.messages.length);
    const lines = groups.reduce((total, group) => total + 1 + group.messages.reduce((sum, message) => sum + message.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 60)), 0), 0), 0);
    const provisional = diagnostics.some(item => item.provisional);
    const card = adeUI(v_flex()).w(480).h(Math.min(280, 24 + lines * 20 + groups.length * 8 + (provisional ? 20 : 0))).p(12).gap(8).overflow_y_scrollbar()
      .bg(c.surface).border(1).border_color(c.separator).rounded(6)
      .when(provisional, element => element.child(div().flex_none().text_size(adeSize(11)).text_color(c.secondary).child("변경 후 진단 확인 중")))
      .children(groups.map(group => v_flex().flex_none().gap(4)
        .child(div().text_size(adeSize(11)).font_semibold().text_color(color(group.severity)).child(["", "오류", "경고", "정보", "힌트"][group.severity]))
        .children(group.messages.map((message, index) => uiSelectableText(`${id}-${group.severity}-${index}`, message).flex_none().w_full().whitespace_normal().text_size(adeSize(12))))));
    return HoverCard.new(`${id}-diagnostic`).open_delay(500).close_delay(150).anchor("bottom_left")
      .trigger(cell.border_b(1).border_color(color(severity))).content(card);
  }
  tokenIndexAt(offset) {
    let lo = 0, hi = this._tokens.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._tokens[mid].from <= offset) lo = mid + 1; else hi = mid;
    }
    return lo - 1;
  }
  tokenAt(offset) {
    const token = this._tokens[this.tokenIndexAt(offset)];
    return token?.to > offset ? token : null;
  }
  // Batch ASCII in a fixed-pitch font, retaining exact glyph hit positions.
  // Unicode and proportional fonts keep their individual grapheme cells.
  *renderSegments(line, selection, fixedPitch) {
    let run = null, tokenIndex = this.tokenIndexAt(line.from);
    const diagnostic = this.diagnosticLines.has(line.number);
    for (const part of graphemeSegments(line.text)) {
      const from = line.from + part.index;
      while (tokenIndex + 1 < this._tokens.length && this._tokens[tokenIndex + 1].from <= from) tokenIndex++;
      const candidate = this._tokens[tokenIndex];
      const token = candidate?.from <= from && candidate.to > from ? candidate : null;
      const selected = from < selection.end && from + part.segment.length > selection.start;
      const batch = fixedPitch && !diagnostic && /^[\x20-\x7e]$/.test(part.segment);
      if (run && batch && run.batch && run.token === token && run.selected === selected && from !== selection.head && run.segment.length < 32) {
        run.segment += part.segment;
      } else {
        if (run) yield run;
        run = { index: part.index, segment: part.segment, token, selected, batch };
      }
    }
    if (run) yield run;
  }
  focus() { if (this.alive) this.readOnly ? this.focusHandle.focus() : this.input.focus(); }
  setSelection(range, cx) {
    if (!this.alive) return false;
    this.model.setSelection(range);
    this.callbacks.onSelection?.(this.selection(), cx);
    const requested = this.reveal(true);
    cx?.notify();
    return requested;
  }
  transaction(from, to, insert, cx) {
    if (this.readOnly || !this.alive) return false;
    if (!this.model.transaction(from, to, insert)) return false;
    this.changed(cx);
    return true;
  }
  applyEdits(edits, cx, options) {
    if (!this.alive || this.readOnly || this.input.value()) return false;
    const changed = this.model.applyEdits(edits, options);
    if (changed) this.changed(cx);
    return changed;
  }
  toggleLineComment(prefix, cx, options) {
    if (!this.alive || this.readOnly || this.input.value()) return false;
    const changed = this.model.toggleLineComment(prefix, options);
    if (changed) this.changed(cx);
    return changed;
  }
  changed(cx) {
    const delta = this.model.lastChange, edits = [];
    if (delta && delta.revision === this.revision && !delta.fullReplace) delta.changes.iterChanges((from, to, _newFrom, _newTo, insert) => edits.push({ from, to, insert: insert.toString() }));
    const usable = delta && delta.revision === this.revision && !delta.fullReplace;
    const tokens = usable && this.tokensRevision === delta.fromRevision ? mapSpans(this.tokens, delta, edits, true) : [];
    const diagnostics = usable && this.diagnosticsRevision === delta.fromRevision ? mapSpans(this.diagnostics, delta, edits, false) : [];
    this.tokens = tokens;
    this.diagnostics = diagnostics;
    this.callbacks.onChange?.(this.value(), this.revision, cx);
    this.callbacks.onSelection?.(this.selection(), cx);
    if (this.findOpen) this.searchInfo = this.model.find(this.findText.value(), this.matchCase, this.selection().start);
    this.reveal();
    cx?.notify();
  }
  reveal(center = false) {
    if (!this.alive) return false;
    const line = this.model.doc.lineAt(this.selection().head).number - 1;
    if (line < this.windowStart || line >= this.windowStart + this.windowRows) {
      this.windowStart = center ? line - Math.floor(this.windowRows / 2) : line < this.windowStart ? line : line - this.windowRows + 1;
    }
    this.windowStart = Math.max(0, Math.min(this.windowStart, Math.max(0, this.model.doc.lines - this.windowRows)));
    return true;
  }
  scrollLines(lines, cx) {
    if (!this.alive) return;
    this.windowStart = Math.max(0, Math.min(this.windowStart + lines, Math.max(0, this.model.doc.lines - this.windowRows)));
    cx.notify();
  }
  release() {
    if (!this.alive) return;
    this.alive = false;
    this.input.release(); this.findText.release(); this.replaceText.release(); this.focusHandle.release(); this.findFocus.release();
  }
  openFind(replace, cx) {
    if (!this.alive || this.input.value()) return;
    this.findOpen = true; this.replaceOpen = replace && !this.readOnly; this.searchNotice = "";
    const s = this.selection(), selected = this.model.doc.sliceString(s.start, s.end);
    if (selected && !/[\r\n]/.test(selected) && selected.length <= 200) {
      this.findUpdating = true; this.findText.set_value(selected); this.findUpdating = false;
    }
    this.findNext(1, cx, true); this.findText.set_selected_range({ start: 0, end: this.findText.value().length }); this.findText.focus(); cx.notify();
  }
  findNext(direction, cx, includeCurrent = false) {
    if (!this.alive) return;
    const s = this.selection();
    this.searchInfo = this.model.find(this.findText.value(), this.matchCase, includeCurrent ? s.start : direction > 0 ? s.end : s.start, direction);
    const match = this.searchInfo.match;
    if (match) this.setSelection({ anchor: match.from, head: match.to }, cx);
    cx.notify();
  }
  replaceFound(all, cx) {
    if (!this.alive || this.readOnly || this.input.value() || !this.findText.value()) return;
    const query = this.findText.value(), replacement = this.replaceText.value();
    if (all) {
      const result = this.model.replaceAll(query, replacement, this.matchCase);
      if (result.changed) this.changed(cx);
      this.searchNotice = `${result.count}개 치환`; cx.notify(); return;
    }
    const s = this.selection(), result = this.model.find(query, this.matchCase, s.start);
    if (result.match?.from === s.start && result.match.to === s.end) {
      if (this.model.doc.sliceString(s.start, s.end) !== replacement) { this.model.replace(replacement); this.changed(cx); }
      this.findNext(1, cx);
    } else this.findNext(1, cx, true);
  }
  renderFind(cx) {
    const c = adeColors();
    let bar = adeUI(v_flex()).id(`${this.id}-find`).flex_none().min_w(0).bg(c.surface).border_b(1).border_color(c.separator)
      .track_focus(this.findFocus).key_context("ADECodeFind")
      .on_key_down((event, eventCx) => { if (event.keystroke === "escape") { this.findOpen = false; this.focus(); eventCx.stop_propagation(); eventCx.notify(); } });
    for (const command of ["find", "replace", "find-next", "find-previous", "find-close"]) bar = bar.on_action(PREFIX + command, (_event, eventCx) => this.command(command, eventCx));
    return bar.child(h_flex().flex_none().min_w(0).flex_wrap().items_center().gap(5).px(8).py(4)
      .child(adeInputBox(Input.new(this.findText)).flex_1().min_w(100))
      .child(div().text_size(adeSize(11)).text_color(c.secondary).child(`${this.searchInfo.match?.index ?? 0}/${this.searchInfo.total}`))
      .child(adeButton(`${this.id}-find-previous`, "↑", (_event, eventCx) => this.findNext(-1, eventCx), { tip: "이전 결과 · Shift Enter", disabled: !this.searchInfo.total }))
      .child(adeButton(`${this.id}-find-next`, "↓", (_event, eventCx) => this.findNext(1, eventCx), { tip: "다음 결과 · Enter", disabled: !this.searchInfo.total }))
      .child(adeButton(`${this.id}-match-case`, "Aa", (_event, eventCx) => { this.matchCase = !this.matchCase; this.findNext(1, eventCx, true); }, { tip: "대소문자 구분", selected: this.matchCase }))
      .when(!this.readOnly, row => row.child(adeButton(`${this.id}-find-replace`, "치환", (_event, eventCx) => { this.replaceOpen = !this.replaceOpen; eventCx.notify(); }, { selected: this.replaceOpen })))
      .child(adeButton(`${this.id}-find-close`, "닫기", (_event, eventCx) => { this.findOpen = false; this.focus(); eventCx.notify(); })))
      .when(this.replaceOpen && !this.readOnly, el => el.child(h_flex().flex_none().min_w(0).flex_wrap().items_center().gap(5).px(8).pb(4)
        .child(adeInputBox(Input.new(this.replaceText)).flex_1().min_w(100))
        .when(Boolean(this.searchNotice), row => row.child(div().text_size(adeSize(11)).text_color(c.secondary).child(this.searchNotice)))
        .child(adeButton(`${this.id}-replace-one`, "바꾸기", (_event, eventCx) => this.replaceFound(false, eventCx), { disabled: !this.searchInfo.total }))
        .child(adeButton(`${this.id}-replace-all`, "모두 바꾸기", (_event, eventCx) => this.replaceFound(true, eventCx), { disabled: !this.searchInfo.total }))));
  }
  command(command, cx) {
    if (["implementation", "super"].includes(command)) {
      if (this.alive && !this.input.value() && this.callbacks.onNavigate) this.callbacks.onNavigate({ kind: command, offset: this.selection().head, revision: this.revision }, cx);
      cx.stop_propagation(); return;
    }
    if (this.alive && !this.input.value() && this.callbacks.onCommand?.(command, cx) === true) { cx.stop_propagation(); return; }
    if (command === "escape") { cx.propagate(); return; }
    if (command === "toggle-comment") {
      if (!this.callbacks.onToggleComment) { cx.propagate(); return; }
      if (this.alive && !this.readOnly && !this.input.value()) this.callbacks.onToggleComment({ revision: this.revision, selection: this.selection() }, cx);
      cx.stop_propagation(); return;
    }
    if (command === "complete" || command === "format") {
      const callback = command === "complete" ? this.callbacks.onComplete : this.callbacks.onFormat;
      if (!callback) { cx.propagate(); return; }
      if (this.alive && !this.readOnly && !this.input.value()) callback(command === "complete" ? { offset: this.selection().head, revision: this.revision } : { revision: this.revision }, cx);
      cx.stop_propagation(); return;
    }
    if (["find", "replace", "find-next", "find-previous", "find-close"].includes(command)) {
      if (!this.alive || this.input.value()) return;
      if (command === "find-close") { this.findOpen = false; this.focus(); cx.notify(); }
      else if (command === "find" || command === "replace" || !this.findText.value()) this.openFind(command === "replace", cx);
      else { this.findOpen = true; this.findNext(command === "find-previous" ? -1 : 1, cx); }
      cx.stop_propagation(); return;
    }
    if (command === "execute") {
      if (!this.callbacks.onExecute) { cx.propagate(); return; }
      if (this.alive && !this.readOnly && !this.input.value()) this.callbacks.onExecute(cx);
      cx.stop_propagation();
      return;
    }
    if (this.alive && command === "save") {
      if (this.input.value()) this.savePending = true;
      else this.callbacks.onSave?.(cx);
      cx.stop_propagation();
      return;
    }
    // A nonempty native value is a conservative pending/preedit signal. The
    // public runtime has no composition getter. Leave native IME actions alone.
    if (!this.alive || this.input.value()) { cx.propagate(); return; }
    let changed = false;
    const s = this.selection();
    if (command === "all") this.model.setSelection({ anchor: 0, head: this.model.doc.length });
    else if (command === "copy" || command === "cut") {
      if (s.start !== s.end) cx.write_to_clipboard(this.model.doc.sliceString(s.start, s.end));
      if (command === "cut" && !this.readOnly) changed = this.model.replace("");
    } else if (["undo", "redo", "paste", "backspace", "delete", "newline", "tab", "outdent", "delete-word-left", "delete-word-right", "delete-line-start", "delete-line-end"].includes(command)) {
      if (!this.readOnly) {
        if (command === "undo" || command === "redo") changed = this.model.undo(command === "redo");
        else if (command === "backspace" || command === "delete") changed = this.model.delete(command === "backspace" ? -1 : 1);
        else if (command === "paste") { const text = cx.read_from_clipboard(); if (typeof text === "string") changed = this.model.replace(text); }
        else if (command.startsWith("delete-word-")) changed = this.model.deleteWord(command.endsWith("left") ? -1 : 1);
        else if (command.startsWith("delete-line-")) changed = this.model.deleteToLine(command.endsWith("start") ? -1 : 1);
        else if (command === "newline") changed = this.model.newline();
        else changed = this.model.indent(command === "outdent");
      }
    } else {
      const direction = command.replace(/^select-/, ""), extend = command.startsWith("select-");
      if (direction === "pageup" || direction === "pagedown") for (let n = 0; n < this.windowRows; n++) this.model.move(direction === "pageup" ? "up" : "down", extend);
      else this.model.move(direction, extend);
    }
    cx.stop_propagation();
    if (changed) this.changed(cx);
    else { this.callbacks.onSelection?.(this.selection(), cx); this.reveal(); cx.notify(); }
  }
  point(offset, event, cx, dragging = false, hitOffset = offset) {
    if (!this.alive || this.input.value()) return;
    const primary = appWindow()?.platform === "macos" ? event.modifiers?.platform : event.modifiers?.control;
    if (!dragging && primary && !event.modifiers?.shift && (event.click_count ?? 1) === 1 && this.callbacks.onNavigate) {
      this.dragging = false; this.setSelection({ anchor: hitOffset, head: hitOffset }, cx); this.focus();
      this.callbacks.onNavigate({ kind: event.modifiers?.alt ? "implementation" : "definition", offset: this.selection().head, revision: this.revision }, cx); cx.stop_propagation(); return;
    }
    if (!dragging) {
      this.dragUnit = event.click_count >= 3 ? "line" : event.click_count === 2 ? "word" : null;
      this.dragOrigin = this.dragUnit === "line" ? this.model.lineRange(hitOffset) : this.dragUnit === "word" ? this.model.wordRange(hitOffset) : null;
    }
    if (this.dragOrigin) {
      const range = this.dragUnit === "line" ? this.model.lineRange(hitOffset) : this.model.wordRange(hitOffset), origin = this.dragOrigin;
      this.setSelection(range.anchor < origin.anchor ? { anchor: origin.head, head: range.anchor } : { anchor: origin.anchor, head: range.head }, cx);
    } else this.setSelection({ anchor: dragging || event.modifiers?.shift ? this.selection().anchor : offset, head: offset }, cx);
    this.dragging = true;
    if (!dragging) this.focus();
    cx.stop_propagation();
  }
  context(offset, event, cx) {
    if (!this.alive || this.input.value() || !this.callbacks.onContextMenu) return;
    this.dragging = false; this.setSelection({ anchor: offset, head: offset }, cx); this.focus();
    this.callbacks.onContextMenu({ offset: this.selection().head, revision: this.revision, position: { ...event.position } }, cx);
    cx.stop_propagation();
  }
  endDrag(cx) {
    if (!this.dragging) return;
    this.dragging = false; this.dragOrigin = null; cx.notify();
  }
  render(cx, { completion } = {}) {
    const c = adeColors(), pending = this.input.value(), s = this.selection();
    const font = settings(), preferences = shared("ade.preferences") ?? {};
    const globalSize = Number(font.font_size), fallbackSize = Number.isFinite(globalSize) ? globalSize : 14;
    const preferredSize = Number(preferences.editorSize ?? fallbackSize);
    this.fontSize = Math.max(8, Math.min(40, Number.isFinite(preferredSize) ? preferredSize : fallbackSize));
    this.rowHeight = Math.max(24, Math.round(this.fontSize * 1.65));
    const family = String(preferences.editorFont ?? "").trim() || String(font.font_family ?? "").trim() || "monospace";
    const fontKey = JSON.stringify([family, this.fontSize]);
    if (this.fontKey !== fontKey) {
      this.fontKey = fontKey;
      this.contentWidth = 0;
      this.pendingWidth = 0;
      this.windowRows = Math.max(1, Math.floor(((this.viewport.height || this.rowHeight * 20 + 16) - 16) / this.rowHeight));
      this.reveal();
    }
    let surface = v_flex().id(this.id).size_full().flex_1().min_w(0).min_h(0).relative().bg(c.editor)
      .font_family(family).text_size(this.fontSize).line_height(`${this.rowHeight}px`).text_color(c.foreground)
      .track_focus(this.focusHandle).key_context(this.readOnly ? "ADECodeReadOnly" : pending ? this.callbacks.onExecute ? "ADECodeSQLComposition" : "ADECodeComposition" : this.callbacks.onExecute ? SQL_CONTEXT : this.callbacks.onComplete || this.callbacks.onFormat || this.callbacks.onCommand || this.callbacks.onToggleComment ? LANGUAGE_CONTEXT : CONTEXT)
      .on_key_up((_event, eventCx) => { if (this.input.value()) this.reveal(); eventCx.notify(); })
      .on_mouse_up("left", (_event, eventCx) => this.endDrag(eventCx))
      .on_mouse_down_out((_event, eventCx) => this.endDrag(eventCx))
      .on_hover((hovered, eventCx) => { if (!hovered) this.endDrag(eventCx); });
    for (const action of new Set(codeBindings(appWindow()?.platform ?? "macos").map(binding => binding.action))) {
      const command = action.slice(PREFIX.length);
      surface = surface.on_action(action, (_event, eventCx) => this.command(command, eventCx));
    }
    this.windowRows = Math.max(1, Math.floor(((this.viewport.height || this.rowHeight * 20 + 16) - 16) / this.rowHeight));
    this.windowStart = Math.max(0, Math.min(this.windowStart, Math.max(0, this.model.doc.lines - this.windowRows)));
    const visibleRange = { start: this.windowStart, end: Math.min(this.model.doc.lines, this.windowStart + this.windowRows) };
    const caretLine = this.model.doc.lineAt(s.head).number - 1;
    const nativeInput = () => Textarea.new(this.input).size_full().min_w(0).min_h(0).p(0).border(0).rounded(0).bg("#00000000")
      .font_family(family).text_size(this.fontSize).line_height(`${this.rowHeight}px`).text_color(c.foreground);
    const renderRows = range => {
        const rows = [];
        for (let index = range.start; index < range.end; index++) {
          const line = this.model.doc.line(index + 1), caretLine = this.model.doc.lineAt(s.head).number === line.number;
          const row = h_flex().h(this.rowHeight).w_full().flex_none().min_w(0).items_center().whitespace_nowrap().relative()
            .child(h_flex().w(72).h(this.rowHeight).flex_none().items_center().border_r(1).border_color(c.separator)
              .child(div().w(48).h(this.rowHeight).flex_none().pr(8).text_size(11).text_color(c.secondary).text_right().child(`${line.number}`)
                .on_mouse_down("left", (event, eventCx) => this.point(line.from, { ...event, click_count: 3 }, eventCx)))
              .child(adeGutterAction(`${this.id}-gutter-${index}`, this.gutterMarkers.get(index), { height: this.rowHeight,
                graphic: () => uiIcon(gutterIcon(this.gutterMarkers.get(index)), 14), onActivate: (_event, eventCx) => this.callbacks.onGutter?.(this.gutterMarkers.get(index), eventCx) })));
          const content = h_flex().id(`${this.id}-line-${fontKey}-${index}`).min_w(0).flex_none().h(this.rowHeight).pl(8).items_center().relative()
            .on_size_change((size, eventCx) => {
              if (!this.alive || this.fontKey !== fontKey) return;
              if (size.width > this.contentWidth + 0.5) { this.contentWidth = size.width; eventCx.notify(); }
            });
          const caret = () => {
            const trigger = div().w(pending ? this.pendingWidth : 0).h(this.rowHeight).flex_none().relative()
              .child(div().absolute().left(0).top(0).w(Math.max(this.fontSize * 4 + 12, this.pendingWidth + 12, 128)).h(this.rowHeight)
                .child(nativeInput().opacity(this.dragging && !pending ? 0 : 1)))
              .when(this.dragging && !pending, element => element.child(div().id(`${this.id}-drag-caret`).absolute().left(0).top(2).w(1).h(this.rowHeight - 4).bg(c.foreground)));
            return Popup.new(`${this.id}-completion-anchor`, trigger).anchor(completion?.bounds?.anchor ?? "top_left").flex_none()
              .when(Boolean(completion?.element && !pending), element => element.content(completion.element));
          };
          const fixedPitch = /mono|menlo|courier|consolas|cascadia|jetbrains|fira.?code|source.?code/i.test(family);
          for (const part of this.renderSegments(line, s, fixedPitch)) {
            const from = line.from + part.index, to = from + part.segment.length;
            if (caretLine && from === s.head && !this.readOnly) content.child(caret());
            const token = part.token;
            const hit = event => {
              const ratio = Math.max(0, Math.min(1, (event.local_position?.x ?? 0) / Math.max(1, event.bounds?.width ?? 1)));
              return part.batch ? from + Math.round(ratio * part.segment.length) : ratio > 0.5 ? to : from;
            };
            const cell = div().h(this.rowHeight).flex_none().bg(from < s.end && to > s.start ? c.selection : "#00000000")
              .text_color(token?.color ?? c.foreground).child(part.segment === "\t" ? "    " : part.segment)
              .on_mouse_down("left", (event, eventCx) => this.point(hit(event), event, eventCx, false, Math.min(to - 1, hit(event))))
              .when(Boolean(this.callbacks.onContextMenu), element => element.on_mouse_down("right", (event, eventCx) => this.context(Math.min(to - 1, hit(event)), event, eventCx)))
              .on_mouse_move((event, eventCx) => { if (this.dragging) this.point(hit(event), event, eventCx, true, Math.min(to - 1, hit(event))); });
            content.child(this.decorate(`${this.id}-${this.revision}-${from}`, cell, this.diagnosticsAt(line.number, from, to)));
          }
          if (caretLine && s.head === line.to && !this.readOnly) content.child(caret());
          const atEnd = (this.diagnosticLines.get(line.number) ?? []).filter(item => item.from === line.to && item.to === line.to);
          if (atEnd.length) content.child(this.decorate(`${this.id}-${this.revision}-${line.to}-eol`, div().w(8).h(this.rowHeight), atEnd));
          row.child(content).child(div().flex_1().min_w(40).h(this.rowHeight)
            .on_mouse_down("left", (event, eventCx) => this.point(line.to, event, eventCx))
            .when(Boolean(this.callbacks.onContextMenu), element => element.on_mouse_down("right", (event, eventCx) => this.context(line.to, event, eventCx)))
            .on_mouse_move((event, eventCx) => { if (this.dragging) this.point(line.to, event, eventCx, true); }));
          rows.push(row);
        }
        return rows;
    };
    const viewport = v_flex().id(`${this.id}-viewport`).flex_1().min_w(0).min_h(0)
      .overflow_x_scrollbar()
      .on_scroll_wheel((event, eventCx) => {
        const y = Number(event.delta?.y) || 0, x = Number(event.delta?.x) || 0;
        if (!y || Math.abs(x) > Math.abs(y)) return;
        this.scrollLines(-Math.sign(y) * Math.max(1, Math.round(Math.abs(y) / this.rowHeight)), eventCx);
        eventCx.stop_propagation();
      })
      .on_size_change((size, eventCx) => {
        if (!this.alive || size.height <= 0 || size.width <= 0) return;
        if (Math.abs(size.width - this.viewport.width) > 0.5 || Math.abs(size.height - this.viewport.height) > 0.5) {
          this.viewport = { width: size.width, height: size.height };
          this.windowRows = Math.max(1, Math.floor((size.height - 16) / this.rowHeight));
          this.reveal();
          eventCx.notify();
        }
      });
    const width = Math.max(this.viewport.width, this.contentWidth + 64);
    // Rows are bounded by the measured viewport but built in ordinary render.
    // Native list deferred callbacks prohibit every event registration, which
    // this editable glyph/IME surface requires for exact hit testing.
    viewport.child(v_flex().id(`${this.id}-rows`).w(width).h(this.rowHeight * (visibleRange.end - visibleRange.start)).flex_none()
      .children(renderRows(visibleRange)));
    const content = surface.child(viewport)
      .child(h_flex().h(28).flex_none().items_center().gap(6).px(8).border_t(1).border_color(c.separator)
        .child(div().flex_1().text_size(adeSize(11)).text_color(c.secondary).child(`${visibleRange.start + 1}–${visibleRange.end} / ${this.model.doc.lines}줄 · ${caretLine + 1}행`)))
      .when(!this.readOnly && (caretLine < visibleRange.start || caretLine >= visibleRange.end), element => element.child(div().absolute().left(-10000).top(0).w(Math.max(128, this.fontSize * 4 + 12)).h(this.rowHeight).opacity(0).child(nativeInput())))
      .when(Boolean(pending), element => element.child(div().id(`${this.id}-pending-${fontKey}`).absolute().left(0).top(0).opacity(0).whitespace_nowrap().child(pending)
        .on_size_change((size, eventCx) => {
          if (!this.alive || this.fontKey !== fontKey) return;
          if (Math.abs(size.width - this.pendingWidth) > 0.5) { this.pendingWidth = size.width; eventCx.notify(); }
        })));
    return v_flex().id(`${this.id}-shell`).size_full().flex_1().min_w(0).min_h(0).bg(c.editor)
      .when(this.findOpen, shell => shell.child(this.renderFind(cx))).child(content);
  }
}

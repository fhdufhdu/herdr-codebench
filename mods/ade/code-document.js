import { Text, ChangeSet, EditorSelection, graphemeSegments } from "./editor-state-vendor.js";
export const identifierText = text => /^[\p{L}\p{N}\p{M}_$]+$/u.test(text);
const group = text => identifierText(text) ? "word" : /^\s+$/u.test(text) ? "space" : "symbol";
const literalPattern = (text, matchCase) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
function boundaryAt(doc, offset) {
  const line = doc.lineAt(offset);
  if (offset === line.to && line.to < doc.length && line.text.endsWith("\r")) return offset - 1;
  for (const part of graphemeSegments(line.text)) {
    const from = line.from + part.index, to = from + part.segment.length;
    if (offset > from && offset < to) return from;
  }
  return offset;
}
function strictOffset(doc, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > doc.length || boundaryAt(doc, offset) !== offset) throw new RangeError("편집 위치가 UTF16/grapheme 경계 또는 문서 범위를 벗어났습니다.");
  return offset;
}
function validText(text) {
  if (typeof text !== "string") throw new TypeError("삽입 원문은 문자열이어야 합니다.");
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const low = text.charCodeAt(++index); if (!(low >= 0xdc00 && low <= 0xdfff)) throw new RangeError("삽입 원문의 surrogate가 올바르지 않습니다."); }
    else if (code >= 0xdc00 && code <= 0xdfff) throw new RangeError("삽입 원문의 surrogate가 올바르지 않습니다.");
  }
}

// Pure document/selection/history owner. Native input is an OS boundary only.
export class CodeDocument {
  constructor(text) {
    this.doc = Text.of(text.split("\n"));
    this.sel = EditorSelection.single(0);
    this.revision = 0;
    this.past = [];
    this.future = [];
    this.lineBreak = text.includes("\r\n") ? "\r\n" : "\n";
  }
  value() { return this.doc.toString(); }
  selection() {
    const { anchor, head, from: start, to: end } = this.sel.main;
    return { anchor, head, start, end };
  }
  boundary(offset) {
    const bounded = Math.max(0, Math.min(this.doc.length, Math.trunc(Number(offset) || 0)));
    return boundaryAt(this.doc, bounded);
  }
  setSelection(range) {
    this.sel = EditorSelection.single(this.boundary(range.anchor ?? range.start), this.boundary(range.head ?? range.end ?? range.anchor ?? range.start));
  }
  snapshot() { return { doc: this.doc, sel: this.sel }; }
  recordChange(changes, before) {
    let fullReplace = false;
    changes.iterChanges((from, to) => { if (before.length > 0 && from === 0 && to === before.length) fullReplace = true; });
    this.lastChange = { changes, before, fromRevision: this.revision, revision: this.revision + 1, fullReplace };
  }
  commit(changes, selection) {
    this.recordChange(changes, this.doc);
    this.past.push({ ...this.snapshot(), changes: changes.invert(this.doc) });
    if (this.past.length > 100) this.past.shift();
    this.future.length = 0;
    this.doc = changes.apply(this.doc);
    this.setSelection(selection);
    this.revision++;
    return true;
  }
  transaction(from, to, insert, selection) {
    from = this.boundary(from); to = this.boundary(to);
    if (from > to) [from, to] = [to, from];
    if (from === to && !insert) return false;
    const changes = ChangeSet.of({ from, to, insert: Text.of(insert.split("\n")) }, this.doc.length);
    return this.commit(changes, selection ?? { anchor: from + insert.length, head: from + insert.length });
  }
  replace(text) { const s = this.selection(); return this.transaction(s.start, s.end, text); }
  applyEdits(edits, { expectedRevision, selection } = {}) {
    if (!Number.isInteger(expectedRevision) || expectedRevision !== this.revision) throw new Error("편집 응답의 문서 revision이 변경됐습니다.");
    if (!Array.isArray(edits)) throw new TypeError("편집 목록이 필요합니다.");
    const sorted = edits.map(edit => {
      if (!edit || typeof edit !== "object") throw new TypeError("편집 범위를 확인하세요.");
      strictOffset(this.doc, edit.from); strictOffset(this.doc, edit.to); validText(edit.insert);
      if (edit.from > edit.to) throw new RangeError("편집 시작이 끝보다 큽니다.");
      return { from: edit.from, to: edit.to, insert: edit.insert };
    }).sort((a, b) => a.from - b.from || a.to - b.to);
    for (let index = 1; index < sorted.length; index++) {
      const previous = sorted[index - 1], current = sorted[index];
      if (previous.to > current.from || previous.from === current.from) throw new Error("겹치거나 같은 시작 위치를 가진 편집은 적용할 수 없습니다.");
    }
    const active = sorted.filter(edit => this.doc.sliceString(edit.from, edit.to) !== edit.insert);
    if (!active.length) return false;
    const changes = ChangeSet.of(active.map(edit => ({ ...edit, insert: Text.of(edit.insert.split("\n")) })), this.doc.length);
    const next = changes.apply(this.doc), current = this.selection();
    const chosen = selection ? { anchor: selection.anchor ?? selection.start, head: selection.head ?? selection.end ?? selection.anchor ?? selection.start }
      : { anchor: changes.mapPos(current.anchor, 1), head: changes.mapPos(current.head, 1) };
    strictOffset(next, chosen.anchor); strictOffset(next, chosen.head);
    return this.commit(changes, chosen);
  }
  undo(redo = false) {
    const source = redo ? this.future : this.past, target = redo ? this.past : this.future;
    if (!source.length) return false;
    const next = source.pop();
    this.recordChange(next.changes, this.doc);
    target.push({ ...this.snapshot(), changes: next.changes.invert(this.doc) });
    this.doc = next.doc; this.sel = next.sel; this.revision++;
    return true;
  }
  adjacent(offset, direction) {
    if (direction < 0 && offset <= 0 || direction > 0 && offset >= this.doc.length) return offset;
    const line = this.doc.lineAt(offset);
    if (line.text.endsWith("\r") && offset === line.to - 1 && direction > 0) return Math.min(this.doc.length, line.to + 1);
    const boundaries = [line.from, ...Array.from(graphemeSegments(line.text), part => line.from + part.index + part.segment.length)];
    if (direction < 0) return boundaries.filter(at => at < offset).pop() ?? Math.max(0, line.from - (line.number > 1 && this.doc.line(line.number - 1).text.endsWith("\r") ? 2 : 1));
    return boundaries.find(at => at > offset) ?? Math.min(this.doc.length, line.to + 1);
  }
  wordRange(offset) {
    const line = this.doc.lineAt(this.boundary(offset)), cells = Array.from(graphemeSegments(line.text.replace(/\r$/, "")));
    if (!cells.length) return { anchor: line.from, head: line.from };
    let at = cells.findIndex(part => line.from + part.index + part.segment.length > offset);
    if (at < 0) at = cells.length - 1;
    const kind = group(cells[at].segment); let first = at, last = at;
    if (kind !== "symbol") {
      while (first > 0 && group(cells[first - 1].segment) === kind) first--;
      while (last + 1 < cells.length && group(cells[last + 1].segment) === kind) last++;
    }
    return { anchor: line.from + cells[first].index, head: line.from + cells[last].index + cells[last].segment.length };
  }
  lineRange(offset) {
    const line = this.doc.lineAt(this.boundary(offset));
    return { anchor: line.from, head: Math.min(this.doc.length, line.to + 1) };
  }
  wordBoundary(offset, direction) {
    const line = this.doc.lineAt(offset), cells = Array.from(graphemeSegments(line.text));
    let at = direction < 0 ? cells.findIndex(part => line.from + part.index + part.segment.length >= offset) : cells.findIndex(part => line.from + part.index >= offset);
    if (at < 0) at = direction < 0 ? cells.length - 1 : cells.length;
    if (direction < 0 && cells[at] && line.from + cells[at].index >= offset) at--;
    while (at >= 0 && at < cells.length && group(cells[at].segment) === "space") at += direction;
    if (at < 0) return Math.max(0, line.from - (line.number > 1 && this.doc.line(line.number - 1).text.endsWith("\r") ? 2 : 1));
    if (at >= cells.length) return Math.min(this.doc.length, line.to + 1);
    const kind = group(cells[at].segment);
    if (kind === "word") while (cells[at + direction] && group(cells[at + direction].segment) === kind) at += direction;
    return line.from + cells[at].index + (direction > 0 ? cells[at].segment.length : 0);
  }
  move(direction, extend = false) {
    const s = this.selection(), line = this.doc.lineAt(s.head);
    let head = s.head;
    if ((direction === "left" || direction === "right") && !extend && s.start !== s.end) head = direction === "left" ? s.start : s.end;
    else if (direction === "left" || direction === "right") head = this.adjacent(head, direction === "left" ? -1 : 1);
    else if (direction === "home") head = line.from;
    else if (direction === "end") head = line.to - (line.text.endsWith("\r") ? 1 : 0);
    else if (direction === "first") head = 0;
    else if (direction === "last") head = this.doc.length;
    else if (direction === "word-left" || direction === "word-right") head = this.wordBoundary(head, direction === "word-left" ? -1 : 1);
    else {
      const target = this.doc.line(Math.max(1, Math.min(this.doc.lines, line.number + (direction === "up" ? -1 : 1))));
      const column = Array.from(graphemeSegments(line.text.slice(0, head - line.from))).length;
      const cells = Array.from(graphemeSegments(target.text));
      head = target.from + (cells[column]?.index ?? target.text.length);
    }
    this.sel = EditorSelection.single(extend ? s.anchor : head, head);
  }
  delete(direction) {
    const s = this.selection();
    return s.start !== s.end ? this.transaction(s.start, s.end, "") : this.transaction(direction < 0 ? this.adjacent(s.head, -1) : s.head, direction > 0 ? this.adjacent(s.head, 1) : s.head, "");
  }
  deleteWord(direction) {
    const s = this.selection();
    return s.start !== s.end ? this.replace("") : this.transaction(direction < 0 ? this.wordBoundary(s.head, -1) : s.head, direction > 0 ? this.wordBoundary(s.head, 1) : s.head, "");
  }
  deleteToLine(direction) {
    const s = this.selection(), line = this.doc.lineAt(s.head);
    return s.start !== s.end ? this.replace("") : this.transaction(direction < 0 ? line.from : s.head, direction > 0 ? line.to - (line.text.endsWith("\r") ? 1 : 0) : s.head, "");
  }
  newline() {
    const s = this.selection(), line = this.doc.lineAt(s.start), indent = /^[\t ]*/.exec(line.text)[0];
    return this.replace(this.lineBreak + indent.slice(0, s.start - line.from));
  }
  indent(outdent = false) {
    const s = this.selection();
    if (!outdent && s.start === s.end) return this.replace("\t");
    const first = this.doc.lineAt(s.start), end = this.doc.lineAt(s.end);
    const last = s.end > s.start && end.from === s.end ? end.number - 1 : end.number, edits = [];
    for (let number = first.number; number <= last; number++) {
      const line = this.doc.line(number), removed = outdent ? /^(?:\t| {1,4})/.exec(line.text)?.[0].length ?? 0 : 0;
      if (!outdent || removed) edits.push({ from: line.from, to: line.from + removed, insert: outdent ? "" : "\t" });
    }
    if (!edits.length) return false;
    const changes = ChangeSet.of(edits, this.doc.length), forward = s.anchor <= s.head;
    return this.commit(changes, { anchor: changes.mapPos(s.anchor, forward ? -1 : 1), head: changes.mapPos(s.head, forward ? 1 : -1) });
  }
  toggleLineComment(prefix, options) {
    if (typeof prefix !== "string" || !prefix.trim() || /[\r\n]/.test(prefix)) throw new TypeError("언어의 줄 주석 prefix가 필요합니다.");
    const s = this.selection(), first = this.doc.lineAt(s.start), end = this.doc.lineAt(s.end);
    const last = s.end > s.start && end.from === s.end ? end.number - 1 : end.number, lines = [];
    for (let number = first.number; number <= last; number++) {
      const line = this.doc.line(number), indent = /^[\t ]*/.exec(line.text)[0].length;
      lines.push({ at: line.from + indent, body: line.text.slice(indent) });
    }
    const remove = lines.every(line => line.body.startsWith(prefix));
    return this.applyEdits(lines.map(line => remove ? { from: line.at, to: line.at + prefix.length + (line.body[prefix.length] === " " ? 1 : 0), insert: "" }
      : { from: line.at, to: line.at, insert: prefix + (/\s$/.test(prefix) ? "" : " ") }), options);
  }
  *matches(query, matchCase = false) {
    if (!query) return;
    const text = this.value(), boundaries = new Set([0]);
    for (const part of graphemeSegments(text)) boundaries.add(part.index + part.segment.length);
    for (const match of text.matchAll(literalPattern(query, matchCase))) {
      const from = match.index, to = from + match[0].length;
      if (boundaries.has(from) && boundaries.has(to)) yield { from, to };
    }
  }
  find(query, matchCase = false, from = this.selection().head, direction = 1) {
    let total = 0, first, last, chosen;
    for (const range of this.matches(query, matchCase)) {
      const match = { ...range, index: ++total }; first ??= match; last = match;
      if (direction > 0 && match.from >= from && !chosen || direction < 0 && match.to <= from) chosen = match;
    }
    return { total, match: chosen ?? (direction > 0 ? first : last) ?? null };
  }
  replaceAll(query, replacement, matchCase = false) {
    const ranges = [...this.matches(query, matchCase)];
    if (!ranges.length) return { count: 0, changed: false };
    const text = this.value(), pieces = []; let at = 0;
    for (const range of ranges) { pieces.push(text.slice(at, range.from), replacement); at = range.to; }
    pieces.push(text.slice(at)); const next = pieces.join("");
    return { count: ranges.length, changed: next === text ? false : this.transaction(0, text.length, next, { anchor: ranges[0].from, head: ranges[0].from + replacement.length }) };
  }
}

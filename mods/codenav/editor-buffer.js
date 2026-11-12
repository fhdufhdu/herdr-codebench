// Pure document owner. Native inputs, files, rendering and LSP stay with callers.
import { Text, ChangeSet, EditorSelection, graphemeSegments } from './editor-state-vendor.js';

const HISTORY_LIMIT = 100, HISTORY_TEXT_LIMIT = 1_048_576;
const integer = (value, label) => {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`Invalid ${label}`);
};
const textValue = value => {
  if (typeof value !== 'string') throw new TypeError('Expected text');
  // Invalid scalar input cannot enter through a well-formed UTF-8 file/IME commit.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new RangeError('Unpaired surrogate');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new RangeError('Unpaired surrogate');
  }
  return value;
};
const boundary = (doc, offset) => {
  integer(offset, 'offset');
  if (offset > doc.length) throw new RangeError('Offset exceeds document');
  if (offset > 0 && offset < doc.length) {
    const pair = doc.sliceString(offset - 1, offset + 1);
    if (pair.charCodeAt(0) >= 0xd800 && pair.charCodeAt(0) <= 0xdbff && pair.charCodeAt(1) >= 0xdc00 && pair.charCodeAt(1) <= 0xdfff) {
      throw new RangeError('Offset splits surrogate pair');
    }
  }
  return offset;
};
const selection = (doc, anchor, head = anchor) => EditorSelection.single(boundary(doc, anchor), boundary(doc, head));

export class EditorBuffer {
  constructor(text = '', { readOnly = false } = {}) {
    this._doc = Text.of(textValue(text).split('\n'));
    this._selection = EditorSelection.single(0);
    this._readOnly = Boolean(readOnly); this._revision = 0;
    this._undo = []; this._redo = []; this._segments = new Map();
    this._goalColumn = null; this._group = undefined;
  }
  get text() { return this._doc.toString(); }
  get length() { return this._doc.length; }
  get lineCount() { return this._doc.lines; }
  get revision() { return this._revision; }
  get anchor() { return this._selection.main.anchor; }
  get head() { return this._selection.main.head; }
  get from() { return this._selection.main.from; }
  get to() { return this._selection.main.to; }
  get selectedText() { return this._doc.sliceString(this.from, this.to); }
  get readOnly() { return this._readOnly; }

  line(number) {
    integer(number, 'line');
    if (number >= this.lineCount) throw new RangeError('Line exceeds document');
    const line = this._doc.line(number + 1);
    return { from: line.from, to: line.to, text: line.text };
  }
  position(offset) {
    boundary(this._doc, offset);
    const line = this._doc.lineAt(offset);
    return { line: line.number - 1, col: offset - line.from };
  }
  offset(number, col) {
    integer(col, 'column');
    const line = this.line(number);
    return boundary(this._doc, Math.min(line.to, line.from + col));
  }
  select(anchor, head = anchor) {
    const next = selection(this._doc, anchor, head);
    this._group = undefined; this._goalColumn = null;
    if (next.eq(this._selection)) return false;
    this._selection = next; return true;
  }
  replace(text, { group } = {}) {
    if (this.readOnly) return false;
    textValue(text);
    return this.apply([{ from: this.from, to: this.to, insert: text }], { anchor: this.from + text.length, group });
  }
  apply(edits, { anchor, head, group } = {}) {
    if (this.readOnly) return false;
    if (!Array.isArray(edits)) throw new TypeError('Expected edits');
    const specs = edits.map(edit => {
      const from = boundary(this._doc, edit.from), to = boundary(this._doc, edit.to);
      if (to < from) throw new RangeError('Reversed edit');
      return { from, to, insert: Text.of(textValue(edit.insert).split('\n')) };
    }).sort((a, b) => a.from - b.from || a.to - b.to);
    for (let i = 1; i < specs.length; i++) {
      if (specs[i].from < specs[i - 1].to || specs[i].from === specs[i - 1].from) throw new RangeError('Overlapping edits');
    }
    const changes = ChangeSet.of(specs, this.length), doc = changes.apply(this._doc);
    const mapped = this._selection.map(changes, 1).main;
    const next = selection(doc, anchor ?? mapped.anchor, head ?? (anchor === undefined ? mapped.head : anchor));
    const changed = !doc.eq(this._doc), moved = !next.eq(this._selection);
    if (!changed) {
      if (moved) { this._selection = next; this._group = undefined; this._goalColumn = null; }
      return moved;
    }
    const before = { doc: this._doc, selection: this._selection }, after = { doc, selection: next };
    const cost = specs.reduce((sum, edit) => sum + edit.to - edit.from + edit.insert.length, 0);
    const previous = this._undo.at(-1);
    if (group !== undefined && group === this._group && previous && previous.after.selection.eq(before.selection)) {
      previous.after = after; previous.cost += cost;
    } else this._undo.push({ before, after, cost });
    this._redo = [];
    let retained = this._undo.reduce((sum, item) => sum + item.cost, 0);
    while (this._undo.length > HISTORY_LIMIT || retained > HISTORY_TEXT_LIMIT) retained -= this._undo.shift().cost;
    this._doc = doc; this._selection = next; this._revision++;
    this._segments.clear(); this._goalColumn = null; this._group = group;
    return true;
  }
  _restore(snapshot) {
    this._doc = snapshot.doc; this._selection = snapshot.selection; this._revision++;
    this._segments.clear(); this._goalColumn = null; this._group = undefined;
  }
  undo() {
    if (this.readOnly || !this._undo.length) return false;
    const entry = this._undo.pop(); this._redo.push(entry); this._restore(entry.before); return true;
  }
  redo() {
    if (this.readOnly || !this._redo.length) return false;
    const entry = this._redo.pop(); this._undo.push(entry); this._restore(entry.after); return true;
  }
  _breaks(number) {
    let breaks = this._segments.get(number);
    if (!breaks) {
      const line = this._doc.line(number), end = number < this.lineCount ? this._doc.line(number + 1).from : this.length;
      breaks = [line.from];
      for (const part of graphemeSegments(this._doc.sliceString(line.from, end))) breaks.push(line.from + part.index + part.segment.length);
      // Cache only a bounded number of recently visited line segmentations.
      if (this._segments.size >= 32) this._segments.delete(this._segments.keys().next().value);
      this._segments.set(number, breaks);
    }
    return breaks;
  }
  _step(pos, forward) {
    if (forward ? pos === this.length : pos === 0) return pos;
    let line = this._doc.lineAt(pos);
    if (!forward && pos === line.from) line = this._doc.line(line.number - 1);
    const breaks = this._breaks(line.number);
    let lo = 0, hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (breaks[mid] < pos || forward && breaks[mid] === pos) lo = mid + 1;
      else hi = mid;
    }
    return forward ? breaks[lo] ?? pos : breaks[Math.max(0, lo - 1)];
  }
  _word(pos, forward) {
    const category = (from, to) => {
      const text = this._doc.sliceString(from, to);
      return /^\s+$/u.test(text) ? 'space' : /[\p{L}\p{N}_]/u.test(text) ? 'word' : 'punctuation';
    };
    let at = pos, next, kind;
    if (!forward) {
      while ((next = this._step(at, false)) !== at && category(next, at) === 'space') at = next;
    }
    next = this._step(at, forward);
    if (next === at) return at;
    kind = category(Math.min(at, next), Math.max(at, next));
    while ((next = this._step(at, forward)) !== at && category(Math.min(at, next), Math.max(at, next)) === kind) at = next;
    if (forward) while ((next = this._step(at, true)) !== at && category(at, next) === 'space') at = next;
    return at;
  }
  move(direction, { extend = false, word = false } = {}) {
    let next = this.head, goal = null;
    if (direction === 'left' || direction === 'right') {
      const forward = direction === 'right';
      next = !extend && this.from !== this.to ? forward ? this.to : this.from : word ? this._word(this.head, forward) : this._step(this.head, forward);
    } else if (direction === 'up' || direction === 'down') {
      const current = this.position(this.head), target = current.line + (direction === 'down' ? 1 : -1);
      if (target < 0 || target >= this.lineCount) { this._group = undefined; return false; }
      goal = this._goalColumn ?? current.col;
      const line = this.line(target), wanted = Math.min(line.from + goal, line.to);
      next = line.from;
      for (const point of this._breaks(target + 1)) { if (point > wanted) break; next = point; }
    } else if (direction === 'home') next = this._doc.lineAt(this.head).from;
    else if (direction === 'end') next = this._doc.lineAt(this.head).to;
    else if (direction === 'doc-start') next = 0;
    else if (direction === 'doc-end') next = this.length;
    else throw new RangeError('Unknown movement direction');
    const moved = this.select(extend ? this.anchor : next, next);
    this._goalColumn = goal; return moved;
  }
  erase(direction, { word = false } = {}) {
    if (direction !== 'left' && direction !== 'right') throw new RangeError('Unknown erase direction');
    if (this.readOnly) return false;
    if (this.from !== this.to) return this.replace('');
    const forward = direction === 'right', other = word ? this._word(this.head, forward) : this._step(this.head, forward);
    let from = Math.min(this.head, other), to = Math.max(this.head, other);
    // A caller may select a scalar boundary inside a combining/ZWJ cluster.
    // Backspace/delete still remove the whole cluster rather than leave a fragment.
    if (!word && other !== this.head) {
      const low = this._step(this.head, false), high = this._step(low, true);
      if (high > this.head) { from = low; to = high; }
    }
    return this.apply([{ from, to, insert: '' }], { anchor: from });
  }
}

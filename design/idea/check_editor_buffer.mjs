// node --experimental-vm-modules design/idea/check_editor_buffer.mjs
// Executes the shipped bundle/model with no DOM, Node globals, or Intl.Segmenter.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({ Intl: undefined });
const vendorPath = new URL('../../mods/codenav/editor-state-vendor.js', import.meta.url);
const modelPath = new URL('../../mods/codenav/editor-buffer.js', import.meta.url);
const vendorSource = await readFile(vendorPath, 'utf8');
const vendor = new vm.SourceTextModule(vendorSource, { context, identifier: vendorPath.href });
await vendor.link(() => { throw new Error('Vendor must not import dependencies at runtime'); });
const model = new vm.SourceTextModule(await readFile(modelPath, 'utf8'), { context, identifier: modelPath.href });
await model.link(specifier => {
  assert.equal(specifier, './editor-state-vendor.js'); return vendor;
});
await model.evaluate();
const { EditorBuffer } = model.namespace;
const plain = value => JSON.parse(JSON.stringify(value));
const state = buffer => ({ text: buffer.text, anchor: buffer.anchor, head: buffer.head, revision: buffer.revision });

const empty = new EditorBuffer('');
assert.equal(empty.lineCount, 1); assert.equal(empty.length, 0);
assert.deepEqual(plain(empty.line(0)), { from: 0, to: 0, text: '' });
assert.equal(empty.move('left'), false); assert.equal(empty.move('down'), false);
assert.equal(empty.erase('left'), false); assert.equal(empty.undo(), false); assert.equal(empty.redo(), false);
assert.equal(empty.replace(''), false); assert.equal(empty.revision, 0);

const source = '한글😀\r\nsecond\n';
const lines = new EditorBuffer(source);
assert.equal(lines.text, source, 'CRLF source is preserved without line-ending normalization');
assert.equal(lines.lineCount, 3);
assert.deepEqual(plain(lines.line(0)), { from: 0, to: 5, text: '한글😀\r' });
assert.deepEqual(plain(lines.position(6)), { line: 1, col: 0 });
assert.equal(lines.offset(1, 999), 12, 'columns clamp at end of line');
for (let offset = 0; offset <= lines.length; offset++) {
  if (offset === 3) continue;
  const position = lines.position(offset);
  assert.equal(lines.offset(position.line, position.col), offset);
}
assert.throws(() => lines.position(3), /surrogate/);
assert.throws(() => lines.offset(0, 3), /surrogate/);
assert.throws(() => lines.line(3), /Line/);
assert.throws(() => lines.position(-1), /offset/);
assert.throws(() => lines.select(1.5), /offset/);
assert.throws(() => new EditorBuffer('\ud800'), /surrogate/);

const edit = new EditorBuffer('ab😀cd\nef');
edit.select(6, 2); assert.equal(edit.selectedText, '😀cd');
assert.equal(edit.from, 2); assert.equal(edit.to, 6); assert.equal(edit.revision, 0);
assert.equal(edit.replace('한'), true);
assert.deepEqual(state(edit), { text: 'ab한\nef', anchor: 3, head: 3, revision: 1 });
assert.equal(edit.undo(), true);
assert.deepEqual(state(edit), { text: 'ab😀cd\nef', anchor: 6, head: 2, revision: 2 });
assert.equal(edit.redo(), true); assert.equal(edit.revision, 3);
assert.equal(edit.text, 'ab한\nef'); assert.equal(edit.head, 3);
edit.select(0); edit.replace('X'); assert.equal(edit.redo(), false, 'new mutation clears redo branch');

const multi = new EditorBuffer('one two three'); multi.select(4, 7);
assert.equal(multi.apply([{ from: 8, to: 13, insert: '3' }, { from: 0, to: 3, insert: '1' }]), true);
assert.equal(multi.text, '1 two 3'); assert.equal(multi.selectedText, 'two');
assert.equal(multi.anchor, 2); assert.equal(multi.head, 5, 'selection maps through original-coordinate edits');
multi.undo(); assert.equal(multi.text, 'one two three'); assert.equal(multi.selectedText, 'two');
multi.redo();
const beforeInvalid = state(multi);
for (const operation of [
  () => multi.apply([{ from: 0, to: 2, insert: '' }, { from: 1, to: 3, insert: '' }]),
  () => multi.apply([{ from: 0, to: 0, insert: 'a' }, { from: 0, to: 0, insert: 'b' }]),
  () => multi.apply([{ from: 3, to: 2, insert: '' }]),
  () => multi.apply([{ from: 0, to: 99, insert: '' }]),
  () => multi.apply([{ from: 0, to: 1, insert: 'x' }], { anchor: 99 }),
]) { assert.throws(operation); assert.deepEqual(state(multi), beforeInvalid, 'invalid transaction is atomic'); }
const surrogate = new EditorBuffer('A😀B');
assert.throws(() => surrogate.apply([{ from: 2, to: 3, insert: '' }]), /surrogate/);
assert.throws(() => surrogate.apply([{ from: 1, to: 3, insert: '\udfff' }]), /surrogate/);
assert.deepEqual(state(surrogate), { text: 'A😀B', anchor: 0, head: 0, revision: 0 });
assert.equal(surrogate.apply([{ from: 0, to: 1, insert: 'A' }]), false, 'equal text does not advance revision');
assert.equal(surrogate.apply([], { anchor: 4, head: 1 }), true, 'selection-only transaction is supported');
assert.equal(surrogate.revision, 0);
assert.equal(surrogate.apply([{ from: 0, to: 1, insert: 'Long' }], { anchor: 4, head: 6 }), true);
assert.equal(surrogate.selectedText, '😀', 'explicit selection uses post-change UTF-16 offsets');

const clusters = ['😀', '👩🏽‍💻', '👨‍👩‍👧‍👦', '🇰🇷', 'e\u0301', '\u1100\u1161\u11a8', 'क्‍ष', '\r\n'];
for (const cluster of clusters) {
  const buffer = new EditorBuffer(`a${cluster}z`);
  buffer.select(1); buffer.move('right'); assert.equal(buffer.head, 1 + cluster.length, `right moves one cluster: ${cluster}`);
  buffer.move('left'); assert.equal(buffer.head, 1);
  buffer.erase('right'); assert.equal(buffer.text, 'az', 'delete removes the complete cluster');
  buffer.undo(); buffer.select(1 + cluster.length); buffer.erase('left'); assert.equal(buffer.text, 'az', 'backspace removes the complete cluster');
}
const inside = new EditorBuffer('e\u0301X'); inside.select(1); inside.erase('right'); assert.equal(inside.text, 'X');

const movement = new EditorBuffer('abc😀z\nx\nabc😀z');
movement.select(5); movement.move('down'); assert.equal(movement.head, 8);
movement.move('down'); assert.equal(movement.head, 14, 'vertical motion retains preferred UTF-16 column over short lines');
movement.move('home', { extend: true }); assert.equal(movement.selectedText, 'abc😀');
movement.move('left'); assert.equal(movement.head, 9, 'non-extending left collapses reverse selection');
movement.move('doc-end', { extend: true }); assert.equal(movement.selectedText, 'abc😀z');
movement.move('end'); assert.equal(movement.head, movement.length);
movement.move('doc-start'); assert.equal(movement.head, 0);
assert.throws(() => movement.move('unknown'), /direction/);
assert.throws(() => movement.erase('up'), /direction/);
const words = new EditorBuffer('one  two_2 ! 한글');
words.move('right', { word: true }); assert.equal(words.head, 5);
words.move('right', { word: true }); assert.equal(words.head, 11);
words.move('left', { word: true, extend: true }); assert.equal(words.selectedText, 'two_2 ');
words.erase('left', { word: true }); assert.equal(words.text, 'one  ! 한글');

const history = new EditorBuffer('');
history.replace('a', { group: 'typing-1' }); history.replace('b', { group: 'typing-1' });
history.undo(); assert.equal(history.text, ''); history.redo(); assert.equal(history.text, 'ab');
history.select(2); history.replace('c', { group: 'typing-1' }); history.undo(); assert.equal(history.text, 'ab', 'explicit selection is a grouping boundary even if unchanged');
const bounded = new EditorBuffer('');
for (let i = 0; i < 130; i++) bounded.replace('a');
let undone = 0; while (bounded.undo()) undone++;
assert.equal(undone, 100); assert.equal(bounded.length, 30);
const oversized = new EditorBuffer(''); oversized.replace('x'.repeat(1_048_577));
assert.equal(oversized.undo(), false, 'one edit above retained-text budget is intentionally not retained');
assert.equal(oversized.revision, 1);
const readonly = new EditorBuffer('locked😀', { readOnly: true });
readonly.select(6, 0); assert.equal(readonly.selectedText, 'locked'); readonly.move('doc-end');
const readonlyBefore = state(readonly);
for (const method of [() => readonly.replace('x'), () => readonly.erase('left'), () => readonly.apply([{ from: 0, to: 1, insert: '' }]), () => readonly.undo(), () => readonly.redo()]) {
  assert.equal(method(), false); assert.deepEqual(state(readonly), readonlyBefore);
}

// Repeat actual model mutations against a plain-string oracle; preserve undo snapshots.
let seed = 71;
const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
const randomBuffer = new EditorBuffer('start\n한글😀'); let expected = randomBuffer.text;
const snapshots = [];
for (let i = 0; i < 90; i++) {
  const boundaries = [...Array(expected.length + 1).keys()].filter(pos => !(pos > 0 && pos < expected.length && /[\ud800-\udbff]/u.test(expected[pos - 1]) && /[\udc00-\udfff]/u.test(expected[pos])));
  const a = boundaries[random(boundaries.length)], b = boundaries[random(boundaries.length)];
  const from = Math.min(a, b), to = Math.max(a, b), insert = ['x', '\n', '한', '😀', 'e\u0301'][random(5)];
  randomBuffer.select(from, to); const before = expected;
  expected = expected.slice(0, from) + insert + expected.slice(to);
  randomBuffer.replace(insert);
  assert.equal(randomBuffer.text, expected);
  assert.equal(randomBuffer.head, from + insert.length);
  if (before !== expected) snapshots.push(before);
}
while (snapshots.length) { assert.equal(randomBuffer.undo(), true); assert.equal(randomBuffer.text, snapshots.pop()); }
assert.equal(randomBuffer.undo(), false);
assert.equal(vm.runInContext('typeof document + ":" + typeof window + ":" + typeof process + ":" + typeof require + ":" + typeof Intl', context), 'undefined:undefined:undefined:undefined:undefined');
console.log('PASS actual production EditorBuffer: UTF-16/CRLF, atomic multi-edits, selection mapping, Unicode17 graphemes, movement, readonly, revision, grouped/bounded undo-redo, randomized oracle; no DOM/Node/Intl globals');

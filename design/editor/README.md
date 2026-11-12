# DOM-free editor document model

The production mod imports `mods/codenav/editor-buffer.js` and its generated
`editor-state-vendor.js`. Neither file uses Node, DOM, browser workers, native
inputs, shared state, disk IO, or `Intl.Segmenter`. Build/test tooling runs under
Node separately.

```sh
cd design/editor
npm ci --ignore-scripts
npm run build
npm run check
npm test
npm run check:native
```

Versions are exact in package.json and package-lock.json. Production reuses
CodeMirror state 6.7.6 `Text`, `ChangeSet`, and `EditorSelection`; grapheme movement
uses unicode-segmenter 0.17.3 (Unicode 17.0.0/UAX #29). CodeMirror's dependency
`@marijn/find-cluster-break` is pinned to 1.0.4. esbuild 0.28.2 is build-only.
The generated bundle embeds full runtime MIT notices so deployed mods retain
them. `THIRD_PARTY_LICENSES.md` also contains the build-tool notice.

The state package is the data model rather than the DOM editor view. See the
[CodeMirror state reference](https://codemirror.net/docs/ref/#state) and
[unicode-segmenter source](https://github.com/cometkim/unicode-segmenter).
The latter is used for full grapheme rules, including Hangul Jamo, CRLF, Indic
conjuncts, combining marks, emoji modifiers/ZWJ, and regional-indicator flags.

## EditorBuffer contract

- `new EditorBuffer(text, {readOnly = false} = {})` owns one UTF-16 text buffer,
  one directional anchor/head selection, monotonic text revision, and history.
- Getters: `text`, `length`, `lineCount`, `revision`, `anchor`, `head`, `from`,
  `to`, `selectedText`, `readOnly`. Revision starts at zero and changes only for
  actual text edits, undo, and redo. Selection alone does not change revision.
- `line(number)` is zero-based and returns `{from,to,text}`. Its offsets and
  columns follow raw UTF-16 text. LF separates lines; a CR before LF remains
  present in line text so the original source round-trips exactly. `position`
  and `offset` use this same convention. Columns beyond EOL clamp to EOL;
  invalid line/offset/negative/fractional values are rejected.
- `select(anchor, head = anchor)` permits forward/reverse selection and returns
  whether it changed. `move(direction,{extend,word})` supports `left`, `right`,
  `up`, `down`, `home`, `end`, `doc-start`, `doc-end`. Home/end are current-line
  boundaries. Up/down retain a preferred UTF-16 column and align to a grapheme
  boundary. Left/right collapse a nonextended selection before moving.
- Word left skips whitespace then the preceding letter/number/underscore or
  punctuation run. Word right crosses the current run and trailing whitespace.
  This is a simple code-editor policy, not locale-aware linguistic segmentation.
- `replace(text,{group})` replaces the current selection and collapses after it.
  `apply(edits,{anchor,head,group})` takes `{from,to,insert}` coordinates in the
  **same pre-change document**, sorts edits, and rejects overlapping/ambiguous
  duplicate-start edits. Explicit anchor/head are **post-change** coordinates;
  anchor alone collapses selection. Omitted selection maps through ChangeSet.
- `erase(left|right,{word})` removes the selection or a whole grapheme/word run.
  `undo()`/`redo()` restore text and directional selection. All commands return
  change booleans. Readonly permits select/move/copy getters and refuses mutation.
- Ranges splitting surrogate pairs, unpaired-surrogate input, invalid edits and
  unknown directions throw. A failing transaction leaves buffer/history intact.
  Scalar boundaries inside a grapheme can be selected deliberately, but ordinary
  movement/deletion uses complete clusters.
- Only adjacent edits with the same **explicit** group are combined. Explicit
  selection (including no-op selection), movement, undo/redo break grouping.
  Callers must use separate groups for paste, newline, commands, and time breaks.
- History retains at most 100 transactions and 1,048,576 UTF-16 units of changed
  payload (inserted plus deleted units), excluding the active document. Oldest
  entries are discarded; an oversized individual edit remains applied but is
  deliberately not undoable. This is a retention budget, not an exact heap-byte
  guarantee. A new edit clears redo. Line grapheme caches retain at most 32 lines
  and are invalidated on text changes. Pathological long-line segmentation and
  full `text` extraction remain linear in their input size.

`npm test` exercises the actual generated production bundle and model in a VM
without DOM/Node/Intl globals. `check:native` copies just these files into a
temporary synthetic mod and invokes `herdr-app check`, then removes it on success.
Neither check installs anything. The native check confirms module execution, not
IME commit behavior or a visible editor; those belong to the input/UI tasks.

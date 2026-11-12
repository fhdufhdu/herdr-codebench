// node --experimental-vm-modules design/idea/check_editable_code.mjs
// Actual EditableCode, CodeView, EditorBuffer/vendor, EditorInput and Scroller.
// Native events, file CAS and the LSP transport are deterministic boundaries.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../../mods/codenav/', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let workspace = 'workspace-a', current, clock = 0, clipboard = '', effectiveBindings = [];
const nativeBindings = [];
const store = { layout: 'idea' }, files = new Map(), reads = [], writes = [], requests = [], commands = [], inputs = [], handles = [], scheduled = [], failures = [];
const never = () => new Promise(() => {});
const flush = async (delay = 0) => {
  clock += delay;
  for (let turn = 0; turn < 120; turn++) {
    await Promise.resolve();
    const due = scheduled.filter(item => item.at <= clock);
    for (const item of due) { scheduled.splice(scheduled.indexOf(item), 1); item.action(cx); }
  }
  if (failures.length) throw failures.shift();
};
const cx = {
  notify() {}, stop_propagation() {}, propagate() {}, bind_keys(bindings) { nativeBindings.push(...bindings); },
  write_to_clipboard(text) { clipboard = text; },
  focus_handle() { const handle = { focus() {}, release() { this.released = true; } }; handles.push(handle); return handle; },
  timer: { after(delay, action) { const job = { at: clock + delay, action }; scheduled.push(job); return job; } },
  sleep: never,
  spawn(action) { Promise.resolve(action(cx)).catch(error => failures.push(error)); },
};
const element = () => {
  const data = { nodes: [], handlers: {}, attributes: {} };
  const proxy = new Proxy(data, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      if (name === 'when') { if (args[0]) args[1](proxy); }
      else if (name === 'child') target.nodes.push(args[0]);
      else if (name === 'children') target.nodes.push(...args[0]);
      else if (name === 'on_action') target.handlers[args[0]] = args[1];
      else if (String(name).startsWith('on_')) target.handlers[name] = args.at(-1);
      else target.attributes[name] = args;
      return proxy;
    };
  } });
  return proxy;
};
const nativeState = { new(options = {}) {
  const state = { text: options.value ?? '', events: {}, released: false,
    value() { assert.equal(this.released, false); return this.text; },
    set_value(text) { this.text = text; this.events.change?.({}, cx); },
    on(name, handler) { this.events[name] = handler; }, set_rows() {}, set_auto_grow() {}, set_soft_wrap() {},
    focus() { this.focused = true; }, release() { this.released = true; },
    commit(text) { this.text = text; this.events.change({}, cx); },
  }; inputs.push(state); return state;
} };
let writeBoundary = async (path, text, expected) => {
  if (files.get(path) !== expected) throw new Error('stale snapshot');
  files.set(path, text);
};
let languageBoundary = async (method, args) => {
  if (method === 'document_sync' || method === 'document_close') return {};
  if (method === 'tokens') return null;
  if (method === 'info') return { installed: true, lang: 'fixture' };
  return { document_owner: args.document_owner, revision: args.revision, value: method === 'diagnostics' ? { items: [], version_confidence: 'exact' } : [] };
};
const common = {
  editorKey: () => workspace, editorSpec: () => current,
  setEditorSpec: (_key, spec) => { current = spec; },
  displayWidth: text => [...text].length,
  offsetAt: (text, column) => [...text].slice(0, Math.max(0, column)).join('').length,
  wordAt: (text, offset) => {
    const start = text.slice(0, offset).search(/[\p{L}\p{N}_]*$/u);
    const end = offset + (text.slice(offset).match(/^[\p{L}\p{N}_]*/u)?.[0].length ?? 0);
    return { start, end, word: text.slice(start, end) };
  },
  codeFont: () => ({ family: 'Fixture Mono', size: 14, row: 22 }),
  find: (_layout, id) => id === 'view-structure' ? {} : null,
  CHILD: { text: 'editor-text' }, STACK: 'editor-stack', hasArea: () => true,
  iconButton: element, button: element, measureFont: element, syntaxColors: () => ({}), expandTabs: text => text,
  tilde: text => text, sectionHeader: element, copyText: async text => { clipboard = text; }, emptyEditor: element, islandBottom: node => node,
};
const ui = {
  IDEA: { rowHeight: 30, editorBreadcrumbHeight: 32, editorGutterInset: 8, editorMarkerWidth: 4, editorTextInset: 8, editorChangeMarkerWidth: 2, editorChangeMarkerRadius: 1 },
  isIdea: () => true, uiSize: (value = 13) => value, ideaUI: node => node, uiColors: () => ({}), uiButton: element,
  MenuController: class {}, uiMenu: element, uiPopupSize: () => ({}), uiNotify() {},
  uiDiagnosticColors: () => ({}), uiDiagnosticUnderline: node => node, uiDiagnosticTooltip: (_id, node) => node, uiModeSwitch: element,
};
const mocks = {
  'gpui-kit': { div: element, PathBuilder: { fill: element } },
  'gpui-base': { h_flex: element, v_flex: element, v_virtual_list: element, Scrollbar: {}, TextView: { markdown: element },
    InputState: nativeState, Input: { new: element }, TextareaState: nativeState, Textarea: { new: element } },
  herdr: {
    readTextFile: async (path, options) => { reads.push({ path, options }); return files.get(path) ?? null; },
    writeTextFile: async (path, text, expected) => { writes.push({ path, text, expected }); return writeBoundary(path, text, expected); },
    watchFolder: never, nextCommand: never, theme: () => ({}), layout: () => ({}),
    window: () => ({ platform: 'macos' }), spaces: () => [{ id: workspace, active: true }],
    shared: name => store[name], setShared: (name, value) => { store[name] = plain(value); },
    run: (...args) => commands.push(args), exec: async () => ({ code: 1, stdout: '', stderr: '' }),
    openOverlay() {}, closeOverlay() {}, props: () => ({}), keys: () => effectiveBindings,
  },
  './common.js': common, './idea-design.js': ui, './i18n.js': { T: value => value },
  './lsp.js': {
    lsp: async (method, args) => { requests.push({ method, args: plain(args) }); return languageBoundary(method, args); },
    peek: async (method, args) => { requests.push({ method, args: plain(args), passive: true }); return languageBoundary(method, args); },
  },
  './lsp-setup.js': { openLspSetup() {} },
  './diagnostics.js': { diagnosticCardOptions: () => ({}), canAttachDiagnostics: () => false },
  './comments.js': { CommentBox: class { constructor() { this.typing = false; } close() {} panel() { return null; } }, commentCard: element, commentHeight: () => 22, commentsOf: () => [], repoKey: () => 'fixture' },
  './tabs.js': { tabBack() {}, tabForward() {} }, './everywhere.js': { openEverywhere() {} },
  './ideaicons.js': { toolImage: element },
  './http.js': { isHttp: () => false, httpRequests: () => [], httpEnvs: () => ({}), runHttp() {}, httpBar: element },
};
const context = vm.createContext({ console, window: { paint_path: element } });
const cache = new Map(), loaded = new Set();
async function load(id) {
  if (cache.has(id)) return cache.get(id);
  let module;
  if (mocks[id]) module = new vm.SyntheticModule(Object.keys(mocks[id]), function() {
    for (const [name, value] of Object.entries(mocks[id])) this.setExport(name, value);
  }, { context, identifier: id });
  else { module = new vm.SourceTextModule(await readFile(new URL(id), 'utf8'), { context, identifier: id }); loaded.add(id); }
  cache.set(id, module);
  if (module instanceof vm.SourceTextModule) await module.link(child => load(mocks[child] ? child : new URL(child, id).href));
  return module;
}
const production = await load(new URL('editable-code.js', root).href); await production.evaluate();
const EditableCode = production.namespace.default;
for (const file of ['editable-code.js', 'code.js', 'editor-buffer.js', 'editor-state-vendor.js', 'editor-input.js', 'scroller.js', 'editor-model.js', 'editor-surface.js']) assert.ok(loaded.has(new URL(file, root).href), `loads actual ${file}`);
const views = [];
const spec = (path, on = null) => ({ kind: 'file', path, root: '/fixture', on, line: 1, at: 1 });
async function open(path, text, options = {}) {
  files.set(path, text); current = spec(path, options.on);
  const view = new EditableCode(); views.push(view); view.init({ disableLsp: true }, cx);
  view.sync(cx); await flush();
  assert.equal(view.buffer.text, text); assert.equal(view.error, null); return view;
}

const view = await open('/fixture/a.txt', 'alpha\n한글😀');
assert.equal(view.dirty, false); assert.equal(view.documentSpace, workspace);
assert.equal(store['activity.editorState'][workspace].owner, 'codenav');
const input = view.input.state, buffer = view.buffer;
input.commit('X'); assert.equal(buffer.text, 'Xalpha\n한글😀'); assert.equal(input.text, '');
assert.equal(view.dirty, true); assert.equal(view.text, buffer.text); assert.deepEqual(plain(view.lines), buffer.text.split('\n'));
view.inputCommand('select-right', cx); assert.equal(buffer.selectedText, 'a');
input.commit('가'); assert.equal(buffer.text, 'X가lpha\n한글😀');
view.inputCommand('undo', cx); assert.equal(buffer.text, 'Xalpha\n한글😀');
view.inputCommand('redo', cx); assert.equal(buffer.text, 'X가lpha\n한글😀');
view.inputCommand('select-all', cx); view.inputCommand('copy', cx); assert.equal(clipboard, buffer.text);
view.inputCommand('cut', cx); assert.equal(buffer.text, ''); view.inputCommand('undo', cx); assert.equal(buffer.text, clipboard);
view.findQuery = '한글'; view.findNext(1); assert.equal(buffer.selectedText, '한글');
view.reveal(2, 2); assert.deepEqual(plain(buffer.position(buffer.head)), { line: 1, col: 2 });
view.press(0, { local_position: { x: view.textOrigin() + view.cw }, modifiers: {} }, cx);
view.dragTo(0, { local_position: { x: view.textOrigin() + view.cw * 4 } }, cx);
view.pointerRelease(0, cx);
assert.equal(buffer.selectedText, buffer.line(0).text.slice(1, 4), 'production pointer drag updates the owned selection');
const same = view.buffer; current = { ...current, line: 1, col: 0, at: 2 }; view.sync(cx); assert.equal(view.buffer, same, 'same-document navigation retains history/model');
const renderedInput = view.input.render(cx);
renderedInput.handlers['herdr-editor-input::move-doc-end']({}, cx);
assert.equal(buffer.head, buffer.length, 'native scoped command reaches document owner');
const revision = buffer.revision;
input.text = 'ㅎ'; renderedInput.handlers['herdr-editor-input::delete-backward']({}, cx);
assert.equal(buffer.revision, revision, 'pending native preedit never executes document command');
assert.equal(input.text, 'ㅎ'); input.commit('한'); assert.ok(buffer.text.endsWith('한'));

const saveText = buffer.text, original = view.document.original;
view.save(cx); await flush();
assert.deepEqual(writes.at(-1), { path: '/fixture/a.txt', text: saveText, expected: original });
assert.equal(files.get('/fixture/a.txt'), saveText); assert.equal(view.dirty, false);
const gate = deferred(); writeBoundary = async (path, text, expected) => { await gate.promise; if (files.get(path) !== expected) throw new Error('stale snapshot'); files.set(path, text); };
view.commit('later', cx); const savedSnapshot = buffer.text;
view.save(cx); assert.equal(view.document.saving, true); view.commit('+newer', cx);
gate.resolve(); await flush(); assert.equal(files.get('/fixture/a.txt'), savedSnapshot);
assert.equal(view.document.original, savedSnapshot); assert.equal(view.dirty, true, 'new input during save stays dirty');
files.set('/fixture/a.txt', 'external writer');
view.save(cx); await flush(); assert.equal(files.get('/fixture/a.txt'), 'external writer');
assert.equal(view.document.original, savedSnapshot); assert.equal(view.dirty, true); assert.match(view.document.note, /stale snapshot/);
writeBoundary = async (path, text, expected) => { if (files.get(path) !== expected) throw new Error('stale snapshot'); files.set(path, text); };

// Dirty navigation waits for an explicit decision; Cancel restores the old spec.
const originalSpec = view.shown; current = spec('/fixture/b.txt'); files.set(current.path, 'B');
view.sync(cx); assert.equal(view.buffer, buffer); assert.equal(view.hasPending, true);
view.cancelPending(cx); assert.equal(current, originalSpec); assert.equal(view.hasPending, false);
view.sync(cx); assert.equal(view.buffer, buffer);

// Semantic requests carry the same owner/revision as the unsaved memory snapshot.
view.lspEnabled = true;
const diskBeforeLsp = files.get('/fixture/a.txt');
const requestStart = requests.length;
await view.languageRequest('hover', { path: view.shown.path, line: 1, col: 0 });
const syncRequest = requests[requestStart], hoverRequest = requests[requestStart + 1];
assert.equal(syncRequest.method, 'document_sync'); assert.equal(syncRequest.args.text, buffer.text);
assert.equal(syncRequest.args.document_owner, view.document.owner); assert.equal(syncRequest.args.revision, buffer.revision);
assert.equal(hoverRequest.method, 'hover'); assert.equal(hoverRequest.args.revision, buffer.revision);
assert.equal(files.get('/fixture/a.txt'), diskBeforeLsp, 'language synchronization does not save');
assert.equal(JSON.stringify(store).includes(buffer.text), false, 'unsaved source is not persisted to shared state');
const syncWait = deferred(); languageBoundary = async (method, args) => method === 'document_sync' ? syncWait.promise : ({ document_owner: args.document_owner, revision: args.revision, value: [] });
const supersededSync = view.languageRequest('symbols', { path: view.shown.path });
view.commit('new revision', cx); syncWait.resolve({});
await assert.rejects(supersededSync, /changed|stale/i);
for (const mismatch of ['revision', 'owner']) {
  languageBoundary = async (method, args) => method === 'document_sync' ? {} : ({ document_owner: mismatch === 'owner' ? 'foreign' : args.document_owner, revision: mismatch === 'revision' ? args.revision - 1 : args.revision, value: [] });
  await assert.rejects(view.languageRequest('hover', { path: view.shown.path }), /stale/i);
}
const diagnosticWait = deferred();
languageBoundary = async (method, args) => method === 'document_sync' ? {} : method === 'diagnostics' ? diagnosticWait.promise : null;
view.info = { installed: true }; view.diags = [];
const diagnostics = view.loadDiagnostics(cx); await flush();
const diagRequest = requests.at(-1); assert.equal(diagRequest.method, 'diagnostics');
view.commit('supersedes diagnostic', cx);
diagnosticWait.resolve({ document_owner: diagRequest.args.document_owner, revision: diagRequest.args.revision, value: { items: [{ line: 0, col: 0, message: 'OLD' }], version_confidence: 'exact' } });
await diagnostics; assert.deepEqual(plain(view.diags), [], 'stale diagnostic never restores decoration');
languageBoundary = async (method, args) => method === 'document_sync' || method === 'document_close' ? {} : ({ document_owner: args.document_owner, revision: args.revision, value: { items: [{ line: 0, col: 0, message: 'CURRENT' }], version_confidence: 'exact' } });
await view.loadDiagnostics(cx); assert.equal(view.diags[0].message, 'CURRENT'); assert.equal(view.diagnosticConfidence, 'exact');

// A selection-only caret change must invalidate a delayed documentation result.
view.reveal(1, 1); view.info = { installed: true }; const delayedHover = deferred();
languageBoundary = async (method, args) => method === 'document_sync' ? {} : method === 'hover' ? delayedHover.promise : null;
view.hoverAt(cx, true); await flush();
const hover = requests.at(-1); assert.equal(hover.method, 'hover');
view.inputCommand('move-right', cx);
delayedHover.resolve({ document_owner: hover.args.document_owner, revision: hover.args.revision, value: { markdown: 'OLD CARET' } });
await flush(); assert.equal(view.hover, null, 'CodeView inherited semantic guard rejects prior-caret documentation');

const remote = await open('/fixture/remote.txt', 'remote', { on: 'other-machine' });
assert.equal(remote.buffer.readOnly, true); assert.equal(remote.commit('blocked', cx), false);
assert.ok(reads.some(read => read.path === '/fixture/remote.txt' && read.options.on === 'other-machine'), 'remote identity reaches the file boundary');
remote.inputCommand('select-all', cx); remote.inputCommand('copy', cx); assert.equal(clipboard, 'remote');
const beforeRemoteSave = writes.length; remote.save(cx); assert.equal(writes.length, beforeRemoteSave);
const markdown = await open('/fixture/note.md', '# Heading');
markdown.inputCommand('move-doc-end', cx); markdown.commit('\nunsaved', cx);
const markdownBuffer = markdown.buffer; markdown.toggleRich();
assert.equal(markdown.richView(), true); assert.equal(markdown.commit('blocked preview', cx), false);
markdown.toggleRich(); assert.equal(markdown.buffer, markdownBuffer); assert.equal(markdown.dirty, true);
markdown.inputCommand('undo', cx); assert.equal(markdown.buffer.text, '# Heading');

// Save/Preview belong to the entire focused document, not only its inline sink.
effectiveBindings = [{ section: 'layout:idea', keys: 'cmd-s', action: 'activity.save' },
  { section: 'layout:idea', keys: 'ctrl-shift-v', action: 'activity.preview' }];
const previewSave = await open('/fixture/preview-save.md', '# Disk');
previewSave.inputCommand('move-doc-end', cx); previewSave.input.state.commit('\nUnsaved preview');
const previewBuffer = previewSave.buffer;
previewSave.toggleRich(); assert.equal(previewSave.richView(), true);
let documentRoot = previewSave.render(cx);
const surfaceAction = (node, chord) => nativeBindings.findLast(binding => binding.keystroke === chord && binding.context === node.attributes.key_context?.[0])?.action;
assert.ok(surfaceAction(documentRoot, 'cmd-s'), 'preview root advertises the current keymap context');
assert.deepEqual(documentRoot.attributes.size_full, []); assert.deepEqual(documentRoot.attributes.flex_1, []);
documentRoot.handlers[surfaceAction(documentRoot, 'cmd-s')]({}, cx); await flush();
assert.equal(files.get('/fixture/preview-save.md'), '# Disk\nUnsaved preview');
assert.equal(previewSave.dirty, false); assert.equal(previewSave.richView(), true); assert.equal(previewSave.buffer, previewBuffer);
documentRoot.handlers[surfaceAction(documentRoot, 'ctrl-shift-v')]({}, cx);
assert.equal(previewSave.richView(), false); assert.equal(previewSave.buffer, previewBuffer);
assert.equal(previewSave.inlineCaret(previewSave.sel.line).element.attributes.key_context[0], 'HerdrEditorInput', 'inline input no longer owns the document command wrapper');
effectiveBindings = [{ section: 'layout:idea', keys: 'cmd-k cmd-s', action: 'activity.save' }];
documentRoot = previewSave.render(cx); await flush(); documentRoot = previewSave.render(cx);
assert.equal(surfaceAction(documentRoot, 'cmd-s'), undefined, 'old save binding is inactive throughout the document after reassignment');
assert.ok(surfaceAction(documentRoot, 'cmd-k cmd-s'));
effectiveBindings = [];

// A save completion belongs to its captured document, even after a workspace switch.
const isolated = await open('/fixture/workspace-a.txt', 'A');
isolated.commit('+save', cx); const aDocument = isolated.document, workspaceSave = deferred();
writeBoundary = async (path, text, expected) => { await workspaceSave.promise; if (files.get(path) !== expected) throw new Error('stale snapshot'); files.set(path, text); };
isolated.save(cx); assert.equal(aDocument.saving, true);
workspace = 'workspace-b'; current = spec('/fixture/workspace-b.txt'); files.set(current.path, 'B');
isolated.sync(cx); await flush(); assert.equal(isolated.buffer.text, 'B');
isolated.commit('+dirty', cx); const bDocument = isolated.document;
workspaceSave.resolve(); await flush();
assert.equal(isolated.document, bDocument); assert.equal(isolated.dirty, true);
assert.equal(bDocument.original, 'B'); assert.equal(bDocument.saving, false);
assert.equal(aDocument.original, '+saveA'); assert.equal(aDocument.saving, false);
assert.equal(store['activity.editorState']['workspace-b'].path, '/fixture/workspace-b.txt');
workspace = 'workspace-a'; current = spec('/fixture/workspace-a.txt'); isolated.sync(cx); await flush();
assert.equal(isolated.document, aDocument); assert.equal(isolated.dirty, false);

const closing = await open('/fixture/close.txt', 'before'); closing.commit('edited', cx);
const oldRequest = { status: 'pending', path: current.path, on: null, token: 'close-old' };
store['activity.closeRequest'] = { [workspace]: oldRequest };
const closeSave = deferred(); writeBoundary = async (path, text, expected) => { await closeSave.promise; if (files.get(path) !== expected) throw new Error('stale snapshot'); files.set(path, text); };
closing.save(cx, oldRequest);
store['activity.closeRequest'][workspace] = { ...oldRequest, token: 'close-new' };
const beforeCloseApproval = commands.length; closeSave.resolve(); await flush();
assert.equal(store['activity.closeRequest'][workspace].status, 'pending', 'late save cannot approve a replaced close token');
assert.equal(commands.length, beforeCloseApproval);
closing.finishClose(closing.closeRequest(), true);
assert.equal(store['activity.closeRequest'][workspace].status, 'approved');
assert.ok(commands.at(-1)[0].startsWith('codenav.close-approved:'));

const cached = await open('/fixture/cache-a.txt', 'disk A');
current = spec('/fixture/cache-b.txt'); files.set(current.path, 'disk B'); cached.sync(cx); await flush();
assert.equal(cached.buffer.text, 'disk B');
files.set('/fixture/cache-a.txt', 'external A while inactive');
current = spec('/fixture/cache-a.txt'); cached.sync(cx); await flush();
assert.equal(cached.buffer.text, 'external A while inactive', 'returning to a clean inactive document revalidates disk before editing');

const indented = await open('/fixture/indent.txt', 'f\n  g');
indented.inputCommand('select-all', cx); indented.inputCommand('indent', cx);
assert.equal(indented.buffer.text, '  f\n    g');
indented.inputCommand('undo', cx); assert.equal(indented.buffer.text, 'f\n  g', 'multiline indentation is one document transaction');
indented.inputCommand('outdent', cx); assert.equal(indented.buffer.text, 'f\ng');
const crlf = await open('/fixture/crlf.txt', 'first\r\nlast'); crlf.inputCommand('move-doc-end', cx); crlf.inputCommand('enter', cx);
assert.equal(crlf.buffer.text, 'first\r\nlast\r\n', 'Enter follows the document line-ending convention');
const longText = 'x'.repeat(3501), longLine = await open('/fixture/long.txt', longText);
assert.equal(longLine.lineLimit, Infinity);
const strings = node => typeof node === 'string' ? [node] : node && typeof node === 'object' ? (node.nodes ?? []).flatMap(strings) : [];
assert.ok(strings(longLine.row(0, {}, {})).includes(longText), 'actual source renderer does not truncate editable text at the legacy 2000-unit line limit');

// Drive the real debounced analysis path from document input, rather than only
// calling languageRequest directly. Transport fixtures inspect the memory text.
workspace = 'analysis-workspace';
const analyzed = await open('/fixture/analyzed.txt', 'disk version'); analyzed.lspEnabled = true;
languageBoundary = async (method, args) => {
  if (method === 'tokens') return [[args.text.length, 'variable']];
  if (method === 'info') return { installed: true, lang: 'fixture' };
  if (method === 'document_sync' || method === 'document_close') return {};
  return { document_owner: args.document_owner, revision: args.revision, value: method === 'symbols' ? [{ name: 'memory symbol' }] : { items: [] } };
};
analyzed.commit('unsaved ', cx); await flush(180);
const analyzedRequests = requests.filter(request => request.args.path === '/fixture/analyzed.txt');
assert.ok(analyzedRequests.some(request => request.method === 'tokens' && request.args.text === 'unsaved disk version'));
assert.ok(analyzedRequests.some(request => request.method === 'document_sync' && request.args.text === analyzed.buffer.text && request.args.revision === analyzed.buffer.revision));
assert.equal(analyzed.symbols[0].name, 'memory symbol');
assert.equal(files.get('/fixture/analyzed.txt'), 'disk version');
const tokenWait = deferred();
languageBoundary = async (method, args) => method === 'tokens' && args.path === '/fixture/analyzed.txt' ? tokenWait.promise : {};
analyzed.commit('A', cx); await flush(180);
analyzed.commit('B', cx); tokenWait.resolve([[99, 'STALE']]); await flush();
assert.equal(analyzed.toks, null, 'late token response from previous revision is not painted');

// The same local URI in another workspace keeps one document/lease owner.
workspace = 'shared-one'; const sharedView = await open('/fixture/shared.txt', 'shared');
sharedView.commit('dirty ', cx); const sharedDocument = sharedView.document;
workspace = 'shared-two'; current = spec('/fixture/shared.txt'); sharedView.sync(cx); await flush();
assert.equal(sharedView.document, sharedDocument); assert.equal(sharedView.documents.size, 1);
assert.equal(sharedView.buffer.text, 'dirty shared'); assert.equal(sharedView.dirty, true);

// Retire a clean lease before reopening the URI; a delayed close must complete
// before disk read/new owner creation, so the old lease cannot close the new one.
workspace = 'lease-workspace'; const leased = await open('/fixture/lease-a.txt', 'lease A'); leased.lspEnabled = true;
const closeGate = deferred();
languageBoundary = async (method, args) => {
  if (method === 'document_close' && args.path === '/fixture/lease-a.txt') return closeGate.promise;
  if (method === 'document_sync' || method === 'document_close') return {};
  if (method === 'tokens') return null;
  if (method === 'info') return { installed: false };
  return { document_owner: args.document_owner, revision: args.revision, value: [] };
};
await leased.languageRequest('symbols', { path: '/fixture/lease-a.txt' });
const oldLeaseOwner = leased.document.owner;
current = spec('/fixture/lease-b.txt'); files.set(current.path, 'lease B'); leased.sync(cx); await flush();
assert.equal(leased.buffer.text, 'lease B');
assert.ok(requests.some(request => request.method === 'document_close' && request.passive && request.args.document_owner === oldLeaseOwner));
files.set('/fixture/lease-a.txt', 'lease A updated externally');
const readsBeforeReopen = reads.filter(read => read.path === '/fixture/lease-a.txt').length;
current = spec('/fixture/lease-a.txt'); leased.sync(cx); await flush();
assert.equal(reads.filter(read => read.path === '/fixture/lease-a.txt').length, readsBeforeReopen, 'reopen waits for outstanding close before reading');
closeGate.resolve({}); await flush();
assert.equal(leased.buffer.text, 'lease A updated externally'); assert.notEqual(leased.document.owner, oldLeaseOwner);

languageBoundary = async () => ({});
const owners = [...requests.filter(request => request.method === 'document_sync').map(request => request.args.document_owner)];
await Promise.all(views.map(item => item.release()));
for (const owner of owners) assert.ok(requests.some(request => request.method === 'document_close' && request.args.document_owner === owner));
assert.ok(inputs.every(state => state.released)); assert.ok(handles.every(handle => handle.released));
assert.equal(view.currentRequest(view.requestContext()), false, 'released view rejects all publication');
assert.equal(failures.length, 0);
console.log('PASS actual EditableCode + CodeView + input/buffer: Unicode commit/selection/commands/history, save CAS/in-flight edits/conflict, pending cancel, unsaved LSP owner/revision/stale diagnostics, readonly remote, Markdown preview Save/Preview effective-keymap and buffer/undo, release');
console.log('UNVERIFIED OS IME/native key priority, clipping/paint/layout, actual engine/LSP server synchronization; separate native/UI and engine tests required');

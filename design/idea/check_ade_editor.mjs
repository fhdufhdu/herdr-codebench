import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({});
const pendingReads = [], pendingWrites = [], tasks = [], saved = new Map(), lspSessions = [], opened = [], menus = [];
let project = { id: 'a', root: '/a', machine: null, name: 'A' };
const sessions = new Map();
const session = p => {
  if (!sessions.has(p.id)) sessions.set(p.id, { tabs: [], active: null });
  return sessions.get(p.id);
};
const element = () => new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : () => element() });
let released = 0;
const native = value => ({
  text: value, revision: 0, value() { return this.text; }, release() { released++; },
  set_soft_wrap() {}, on(_event, handler) { this.change = handler; }, focus() {},
  selection() { return this.range ?? { head: 0, anchor: 0, start: 0, end: 0 }; },
  setSelection(range, eventCx) { this.range = range; this.callbacks?.onSelection?.(range, eventCx); }, render: element,
});
const nativeOwner = { nativeADEFrame: true };
const queueTimers = [];
let initTask, ownerTurns = 0, runningOwner = nativeOwner, notifications = 0;
const cx = { sleep: async () => { ownerTurns++; runningOwner = nativeOwner; }, focus_handle: () => ({ release() {}, focus() {} }), notify() { notifications++; }, timer: { every(ms, fn, options) {
  assert.equal(ms, 25); assert.equal(options.owner, nativeOwner);
  const timer = { cancelled: false, cancel() { this.cancelled = true; }, fire() { if (!this.cancelled) { runningOwner = nativeOwner; ownerTurns++; fn(cx); } } }; queueTimers.push(timer); return timer;
} }, spawn(fn, options) {
  assert.equal(options?.owner, nativeOwner, "every editor task belongs to the real native owner, not the helper or popup");
  assert.equal(runningOwner, nativeOwner, "runtime refuses cross-view child task creation");
  const task = Promise.resolve().then(() => fn(cx)); if (!initTask) initTask = task; else tasks.push(task);
} };
const stubs = {
  'gpui-kit': { View: class {}, div: element },
  'gpui-base': { h_flex: element, v_flex: element, TextareaState: { new: options => native(options.value) }, Textarea: { new: element }, TextView: { markdown: element, html: element } },
  'herdr': {
    readTextFile: path => new Promise((resolve, reject) => pendingReads.push({ path, resolve, reject })),
    writeTextFile: (path, text, expected) => new Promise((resolve, reject) => pendingWrites.push({ path, text, expected, resolve, reject })),
    window: () => ({ platform: 'macos' }), settings: () => ({}),
    shared: key => saved.get(key), setShared: (key, value) => saved.set(key, value),
  },
  './idea-design.js': { ADE: { rowHeight: 30, radius: 6 }, adeUI: value => value, adeColors: () => ({}), adeSize: value => value, adeButton: element, adeTab: element, adeNote: element, adeManagedList: element, adeCompletionPopup: element,
    MenuController: class { constructor() { this.focus = { release() {} }; } release() {} } },
  './idea-tokens.js': { IDEA_TOKENS: { 'herdr.ux': { syntax: { keyword: '#canonical', string: '#string' } } } },
  './lsp-session.js': { LspSession: class {
    init(_cx, callbacks) { this.callbacks = callbacks; this.syncs = []; lspSessions.push(this); }
    sync(snapshot) { this.syncs.push(snapshot); }
    async close() { this.closed = true; await this.closeGate; }
    async request(kind) { this.requestTurn = ownerTurns; this.requested = kind; (this.requests ??= []).push(kind); return this.response?.(kind); }
    async flush() {}
    async retry() { this.retries = (this.retries ?? 0) + 1; }
  } },
  './ui-icons.js': { uiIcon: element },
  './editor-menu.js': { openEditorMenu: (...args) => menus.push(args) },
  './code-input.js': { CodeInput: class { init(text, _cx, callbacks) { const state = native(text); state.callbacks = callbacks; return state; } } },
  './workspace.js': { currentProject: () => project, documentState: session,
    selectDocument: (path, p) => { session(p).active = path; },
    closeDocument: (path, p) => { const s = session(p); s.tabs = s.tabs.filter(item => item !== path); s.active = s.tabs[0] ?? null; },
    openDocument: (path, p) => { opened.push({ path, project: p }); if (!session(p).tabs.includes(path)) session(p).tabs.push(path); session(p).active = path; },
    projectKey: p => JSON.stringify([p?.machine ?? null, p?.root ?? '', p?.id ?? '']),
  },
};
stubs["./http-client.js"] = { isHttp: path => /\.(http|rest)$/i.test(path), httpEnvs: async () => ({ names: [] }), runHttp() {} };
stubs["./execution.js"] = { runConfiguration() {} };
Object.assign(stubs.herdr, { openOverlay() {}, run() {}, notify() {} });
const modules = new Map();
stubs['./sql-assist.js'] = { SQLAssist: class { release() {} } };
stubs['./gutter-navigation.js'] = { GutterNavigation: class { constructor() { this.markers = []; } sync() {} release() {} } };
const viewers = [];
stubs['./viewer.js'] = {
  viewerKind: path => /\.pdf$/i.test(path) ? 'pdf' : /\.(png|jpg|jpeg|svg|ico|webp|gif|bmp|tiff?|avif)$/i.test(path) ? 'image' : null,
  Viewer: class {
    constructor(kind, spec) { this.kind = kind; this.spec = spec; viewers.push(this); }
    async load(_cx, alive) { this.loaded = alive(); }
    dispose() { this.disposed = true; }
  },
};
for (const [name, exports] of Object.entries(stubs)) modules.set(name, new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context }));
const model = new vm.SourceTextModule(fs.readFileSync(new URL('../../mods/ade/editor-document.js', import.meta.url), 'utf8'), { context });
modules.set('./editor-document.js', model);
modules.set('./editor-completion.js', new vm.SourceTextModule(fs.readFileSync(new URL('../../mods/ade/editor-completion.js', import.meta.url), 'utf8'), { context }));
modules.set('./http-analysis.js', new vm.SourceTextModule(fs.readFileSync(new URL('../../mods/ade/http-analysis.js', import.meta.url), 'utf8'), { context }));
const source = new vm.SourceTextModule(fs.readFileSync(new URL('../../mods/ade/text-editor.js', import.meta.url), 'utf8'), { context });
await source.link(name => modules.get(name));
await source.evaluate();
const tick = async () => { for (let n = 0; n < 6; n++) { for (const timer of queueTimers) timer.fire(); await Promise.resolve(); } };
const Editor = source.namespace.default;
const editor = new Editor();
editor.init({ owner: nativeOwner }, cx);
const beforeIdle = notifications; await tick(); assert.equal(notifications, beforeIdle, "idle owner queue never redraws");
session(project).tabs = ['/a/test.ts']; session(project).active = '/a/test.ts';
const a = editor.ensure(project, '/a/test.ts');
assert.equal(pendingReads.length, 0, 'ensure must defer IO until after the synchronous render pass');
await tick();
project = { id: 'b', root: '/b', machine: null, name: 'B' };
session(project).tabs = ['/b/test.ts']; session(project).active = '/b/test.ts';
const b = editor.ensure(project, '/b/test.ts');
await tick();
pendingReads[1].resolve('B'); pendingReads[0].resolve('A');
await Promise.all(tasks.splice(0));
assert.equal(editor.active(), b); assert.equal(a.state.value(), 'A'); assert.equal(b.state.value(), 'B');
assert.equal(lspSessions.length, 1); assert.equal(a.lsp, undefined, 'inactive restored tabs do not acquire leases'); assert.equal(b.lsp.syncs[0].revision, 0);
assert.equal(source.namespace.textOffset('😀a\nsecond', 1, 2), 6);
assert.equal(source.namespace.syntaxSpans('😀a\ntext', [[[2, 'keyword'], [1, 'unknown']], [[4, 'string']]])[1].from, 4);
const bKey = stubs['./workspace.js'].projectKey(project);
b.lsp.callbacks.onUpdate({ revision: 0, tokensRevision: 0, diagnosticsRevision: 0, status: 'ready', tokens: [[[1, 'keyword']]], diagnostics: [{ line: 0, col: 0, end_line: 0, end_col: 1, severity: 1, message: 'actual diagnostic' }],
  symbolsStatus: 'ready', symbols: [{ name: 'Bsymbol', line: 0, col: 0 }], confidence: 'unversioned' }, cx);
assert.equal(b.state.tokens[0].color, '#canonical'); assert.equal(b.state.diagnostics[0].message, 'actual diagnostic');
assert.equal(saved.get('ade.outline')[bKey].items[0].name, 'Bsymbol');
const mappedTokens = [{ from: 1, to: 2, color: '#canonical' }], mappedDiagnostics = [{ from: 1, to: 2, severity: 1, message: 'mapped' }];
b.state.revision = 1; b.state.tokens = mappedTokens; b.state.diagnostics = mappedDiagnostics;
b.lsp.callbacks.onUpdate({ revision: 1, status: 'pending', tokensRevision: 0, diagnosticsRevision: 0, tokens: [[[1, 'keyword']]], diagnostics: [{ message: 'old raw positions' }] }, cx);
assert.equal(b.state.tokens, mappedTokens, 'pending must preserve CodeInput-mapped tokens');
assert.equal(b.state.diagnostics, mappedDiagnostics, 'pending must preserve CodeInput-mapped underlines');
b.lsp.callbacks.onUpdate({ revision: 1, status: 'syncing', tokensRevision: 1, diagnosticsRevision: 0, tokens: [], diagnostics: [{ message: 'old raw positions' }] }, cx);
assert.equal(b.state.tokens.length, 0, 'authoritative current empty tokens replace provisional spans');
assert.equal(b.state.diagnostics, mappedDiagnostics, 'tokens reply cannot clear independently pending diagnostics');
b.lsp.callbacks.onUpdate({ revision: 1, status: 'ready', tokensRevision: 1, diagnosticsRevision: 1, tokens: [], diagnostics: [], symbolsStatus: 'ready', symbols: [{ name: 'Bsymbol' }] }, cx);
assert.equal(b.state.diagnostics.length, 0, 'current empty diagnostics remove resolved underlines');
b.state.revision = 0;
const latestTokens = b.state.tokens;
b.state.revision = 1;
b.lsp.callbacks.onUpdate({ revision: 0, status: 'ready', tokens: [], diagnostics: [{ message: 'stale' }] }, cx);
assert.equal(b.state.tokens, latestTokens, 'stale revision cannot overwrite current input decorations');
b.state.revision = 0;
editor.updateLsp(a, { revision: 0, status: 'ready', tokens: [], diagnostics: [], symbols: [{ name: 'old project' }] }, cx);
assert.equal(saved.get('ade.outline')[bKey].items[0].name, 'Bsymbol', 'old project cannot overwrite current outline');
editor.navigate(a, { path: '/a/target', line: 2, col: 4 }, cx); assert.equal(opened.length, 0);
editor.embedded = true; saved.set('ade.editor-mode', { [bKey]: 'database' });
b.lsp.callbacks.onNavigate({ path: '/b/background', line: 0, col: 0 }, cx);
assert.equal(opened.length, 0, 'late semantics from the hidden file editor cannot navigate over a database document');
saved.set('ade.editor-mode', { [bKey]: 'file' });
saved.set('ade.navigation', { [bKey]: { path: b.path, line: 1, column: 2, at: 'search' } });
editor.consumeNavigation(b, cx); assert.equal(b.state.selection().head, 1);
editor.consumeNavigation(b, cx); assert.equal(b.navigationAt, 'search');
const beforeSemanticTurn = ownerTurns; runningOwner = { popup: true };
editor.semantic(b, 'references', cx); await tick(); await Promise.all(tasks.splice(0)); assert.equal(b.lsp.requested, 'references'); assert.equal(editor.taskOwner, nativeOwner); assert.ok(b.lsp.requestTurn > beforeSemanticTurn, "root worker resumes before nested semantic spawn");
b.lsp.response = kind => ({ kind, empty: kind === 'definition', locations: kind === 'definition' ? [] : [{ path: '/b/reference.ts', line: 2, col: 3 }] });
b.state.callbacks.onNavigate({ kind: 'definition', offset: 0, revision: 0 }, cx);
await tick(); await Promise.all(tasks.splice(0));
assert.deepEqual(b.lsp.requests.slice(-2), ['definition', 'references'], 'primary click falls back only after successful empty definitions');
assert.equal(menus.at(-1)[2].locations[0].path, '/b/reference.ts');
const beforeStaleNavigation = b.lsp.requests.length;
assert.equal(editor.queueSemantic(b, { kind: 'definition', offset: 0, revision: -1 }, cx), false);
await tick(); assert.equal(b.lsp.requests.length, beforeStaleNavigation);
b.lsp.response = () => undefined;
b.state.callbacks.onNavigate({ kind: 'definition', offset: 0, revision: 0 }, cx);
await tick(); await Promise.all(tasks.splice(0));
assert.equal(b.lsp.requests.length, beforeStaleNavigation + 1, 'failed definitions never trigger fallback references');
saved.set('ade.analysis-request', { [bKey]: { path: b.path, at: 1 } }); editor.scheduleAnalysis(b);
saved.set('ade.analysis-request', { [bKey]: { path: b.path, at: 2 } }); editor.scheduleAnalysis(b);
assert.equal(b.lsp.retries, undefined, 'render descriptors do not execute analysis inline');
await tick(); await Promise.all(tasks.splice(0));
assert.equal(b.lsp.retries, 1); assert.equal(b.analysisAt, 2, 'rapid refresh requests coalesce to the latest request');
editor.scheduleAnalysis(b); await tick(); await Promise.all(tasks.splice(0)); assert.equal(b.lsp.retries, 1, 'one request is consumed once');
saved.set('ade.analysis-request', { [bKey]: { path: b.path, at: 3 } }); editor.scheduleAnalysis(b);
const currentB = project; project = { id: 'a', root: '/a', machine: null, name: 'A' };
await tick(); await Promise.all(tasks.splice(0)); assert.equal(b.lsp.retries, 1, 'a queued request cannot retry after the active project changes');
project = currentB;
saved.set('ade.analysis-request', { [bKey]: { path: '/b/different.ts', at: 4 } }); editor.scheduleAnalysis(b);
await tick(); await Promise.all(tasks.splice(0)); assert.equal(b.lsp.retries, 1, 'a request for another path is ignored');
let survivedWorkerJob = false;
editor.enqueue(() => { throw new Error('fixture native task owner error'); });
editor.enqueue(() => { survivedWorkerJob = true; });
await tick();
assert.equal(survivedWorkerJob, true, 'one synchronous job error cannot terminate the retained worker');
assert.match(b.lspState.error, /fixture native task owner error/);
assert.equal(saved.get('ade.outline')[bKey].analysis.phase, 'worker-error');
editor.workerError = null;
b.state.text = 'B edited'; editor.save(b); await tick();
assert.equal(pendingWrites[0].expected, 'B'); assert.equal(pendingWrites[0].text, 'B edited');
b.state.text = 'B edited again'; pendingWrites[0].resolve(null); await Promise.all(tasks.splice(0));
assert.equal(b.saved, 'B edited'); assert.equal(model.namespace.isDirty(b), true);
editor.request(b, 'close', cx); assert.equal(editor.pending.doc, b); assert.equal(session(project).tabs.length, 1);
editor.pending = null; editor.save(b); await tick();
pendingWrites[1].reject(new Error('stale snapshot')); await Promise.all(tasks.splice(0));
assert.match(b.error, /stale snapshot/); assert.equal(model.namespace.isDirty(b), true);
const remote = editor.ensure({ ...project, id: 'remote', machine: 'host' }, '/b/test.ts'); await tick();
pendingReads[2].resolve('remote'); await Promise.all(tasks.splice(0));
remote.state.text = 'changed'; editor.save(remote); assert.equal(pendingWrites.length, 2);
const beforeMarkdownSessions = lspSessions.length;
const markdown = editor.ensure(project, '/b/guide.md'); session(project).tabs.push('/b/guide.md'); session(project).active = '/b/guide.md'; await tick();
pendingReads[3].resolve('# Heading\n```\n# ignored\n```\nSubheading\n---'); await Promise.all(tasks.splice(0));
await tick(); await Promise.all(tasks.splice(0));
assert.equal(lspSessions.length, beforeMarkdownSessions + 1, 'Markdown uses the installed language server while retaining a local heading outline');
assert.ok(markdown.lsp);
assert.equal(markdown.lspState.symbols.length, 2); assert.equal(markdown.lspState.symbols[1].name, 'Subheading');
markdown.state.text = '# Changed'; markdown.state.revision = 1; markdown.state.callbacks.onChange(markdown.state.text, 1, cx);
assert.equal(saved.get('ade.outline')[bKey].items[0].name, 'Changed');
markdown.lspState.symbols = [];
saved.set('ade.analysis-request', { [bKey]: { path: markdown.path, at: 5 } }); editor.scheduleAnalysis(markdown);
await tick(); await Promise.all(tasks.splice(0));
assert.equal(markdown.lspState.symbols[0].name, 'Changed', 'Markdown refresh republishes live headings and reuses the LSP lease');
assert.equal(lspSessions.length, beforeMarkdownSessions + 1);
session(project).active = '/b/test.ts'; editor.refresh(cx, project); await tick(); await Promise.all(tasks.splice(0));
const late = editor.ensure(project, '/b/late'); await tick();
let finishClose;
b.lsp.closeGate = new Promise(resolve => { finishClose = resolve; });
let cleanupDone = false;
const cleanup = editor.release().then(() => { cleanupDone = true; });
assert.ok(queueTimers.every(timer => timer.cancelled), "release cancels every queue pump");
await tick(); assert.equal(cleanupDone, false, 'argumentless lifecycle directly awaits cleanup using its task-owned context');
finishClose(); await cleanup;
pendingReads[4].resolve('too late'); await Promise.all(tasks.splice(0));
await initTask; await tick(); await Promise.all(tasks.splice(0));
assert.ok(lspSessions.every(item => item.closed));
assert.equal(late.state, null); assert.equal(released, 4); editor.release(); assert.equal(released, 4);
assert.equal(model.namespace.sourceHTML('<script>&'), '<pre>&lt;script&gt;&amp;</pre>');
// External file locations and materialized archive locations remain navigable, never writable.
assert.equal(model.namespace.externalSource('/b/node_modules/pkg/index.d.ts', '/b'), true);
assert.equal(model.namespace.externalSource('/b-other/index.ts', '/b'), true);
assert.equal(model.namespace.externalSource('/b/src/index.ts', '/b/'), false);
assert.equal(model.namespace.externalSource('C:\\work\\node_modules\\pkg\\index.d.ts', 'C:\\work'), true);
const libraryEditor = new Editor(); libraryEditor.init({ owner: nativeOwner }, cx);
session(project).active = '/b/test.ts';
const origin = libraryEditor.ensure(project, '/b/test.ts'); await tick(); pendingReads.at(-1).resolve('const value = 1;'); await Promise.all(tasks.splice(0));
const originCaret = origin.state.selection().head;
libraryEditor.navigate(origin, { path: '/cache/sources/dependency.java', external: true, line: 4, col: 2 }, cx);
assert.equal(opened.at(-1).path, '/cache/sources/dependency.java');
const library = libraryEditor.ensure(project, '/cache/sources/dependency.java');
libraryEditor.observeNavigation(library); // The render happens before asynchronous loading.
await tick(); pendingReads.at(-1).resolve('class Dependency {}'); await Promise.all(tasks.splice(0));
assert.equal(libraryEditor.history(project).entries.length, 2, 'loading adds no phantom first-line stop');
assert.equal(library.sourceOnly, true); assert.equal(library.external, true);
assert.equal(library.state.callbacks.readOnly, true);
assert.equal(library.state.selection().head, 2, 'external target line is bounded and target column is consumed');
assert.equal(library.lsp.syncs[0].library, true, 'materialized source uses immutable original-server analysis, not a writable lease');
const writesBeforeLibrarySave = pendingWrites.length;
library.state.text = 'programmatic change'; libraryEditor.save(library, undefined, cx);
assert.equal(pendingWrites.length, writesBeforeLibrarySave, 'external saves rejected even if the UI is bypassed');
libraryEditor.observeNavigation(library);
libraryEditor.travel(-1, cx);
assert.equal(session(project).active, origin.path, 'back reopens the source file');
libraryEditor.consumeNavigation(origin, cx);
assert.equal(origin.state.selection().head, originCaret, 'back restores the source caret');
libraryEditor.travel(1, cx);
assert.equal(session(project).active, library.path, 'forward restores external file too');
libraryEditor.consumeNavigation(library, cx);
assert.equal(library.state.selection().head, 2);
libraryEditor.navigate(library, { path: library.path, line: 0, col: 8 }, cx);
libraryEditor.travel(-1, cx);
assert.equal(library.state.selection().head, 2, 'same-file definition jumps preserve the origin');
libraryEditor.navigate(library, { path: library.path, line: 0, col: 5 }, cx);
const history = libraryEditor.history(project);
assert.equal(history.index, history.entries.length - 1, 'new navigation discards the forward branch');
assert.equal(libraryEditor.history({ ...project, id: 'other' }).entries.length, 0, 'projects never share history');
for (let index = 0; index < 150; index++) libraryEditor.remember(history, { path: `/bounded/${index}`, line: 1, column: 1 });
assert.equal(history.entries.length, 100, 'history is bounded');
await libraryEditor.release(cx);
const httpEditor = new Editor(); httpEditor.init({ owner: nativeOwner }, cx);
session(project).tabs.push('/b/request.http'); session(project).active = '/b/request.http';
const httpDoc = httpEditor.ensure(project, '/b/request.http'); await tick(); pendingReads.at(-1).resolve('GET http://127.0.0.1/'); await Promise.all(tasks.splice(0));
assert.equal(httpDoc.lsp, undefined, 'HTTP files execute with ijhttp and do not start an unsupported language server');
assert.equal(httpDoc.lspState.status, 'unsupported'); await httpEditor.release(cx);
session(project).active = '/cache/sources/dependency.java';
const restoredEditor = new Editor(); restoredEditor.init({ owner: nativeOwner }, cx);
assert.equal(restoredEditor.ensure(project, '/cache/sources/dependency.java').sourceOnly, true, 'readonly provenance survives editor restoration');
await tick(); pendingReads.at(-1).resolve('class Dependency {}'); await Promise.all(tasks.splice(0)); await restoredEditor.release(cx);
const viewerEditor = new Editor(); viewerEditor.init({ owner: nativeOwner }, cx);
const sourceReads = pendingReads.length, servers = lspSessions.length;
for (const path of ['/b/design.PDF', '/b/picture.png', '/b/favicon.ico', '/b/vector.svg']) {
  session(project).tabs.push(path); session(project).active = path;
  const doc = viewerEditor.ensure(project, path); await tick(); await Promise.all(tasks.splice(0));
  assert.ok(doc.viewer.loaded); assert.equal(doc.state, null);
  assert.equal(doc.lspState.status, 'preview');
  assert.equal(pendingReads.length, sourceReads, 'binary previews never pass through UTF-8 source reads');
  assert.equal(lspSessions.length, servers, 'binary previews never start a language server');
  const previous = doc.viewer;
  viewerEditor.load(doc, cx); await Promise.all(tasks.splice(0));
  assert.equal(previous.disposed, true, 'reload releases the old PDF timer');
  viewerEditor.history(project).pending = 'preview-back';
  saved.set('ade.navigation', { [stubs['./workspace.js'].projectKey(project)]: { path, history: true, at: 'preview-back' } });
  viewerEditor.consumeNavigation(doc, cx);
  assert.equal(viewerEditor.history(project).pending, null, 'back/forward navigation completes for previews');
  viewerEditor.closePath(path, cx, project); assert.equal(doc.viewer.disposed, true);
}
session(project).tabs.push('/b/archive.zip'); session(project).active = '/b/archive.zip';
const binaryDoc = viewerEditor.ensure(project, '/b/archive.zip'); await tick(); pendingReads.at(-1).resolve('PK\0binary'); await Promise.all(tasks.splice(0));
assert.equal(binaryDoc.viewer.kind, 'binary'); assert.equal(binaryDoc.state, null);
await viewerEditor.release(cx);
assert.ok(viewers.every(viewer => viewer.disposed), 'closing the editor releases all viewer resources');
console.log('ADE editor: identity, stale reads/revisions/projects, CAS edits/conflict, canonical syntax/diagnostics, navigation, remote readonly and awaited lease release passed');

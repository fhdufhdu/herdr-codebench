import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile), store = new Map(), tasks = [], opened = [], overlays = [], commands = [];
let current = { id: 's', root: '/repo', machine: null, name: 'Repo' }, handler = async () => { throw new Error('unexpected git call'); };
const projectKey = value => JSON.stringify([value.machine ?? null, value.root, value.id]);
const element = () => { let proxy; proxy = new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : key === 'when' ? (condition, fn) => condition ? fn(proxy) : proxy : () => proxy }); return proxy; };
class MenuController { constructor() { this.at = 0; this.focus = { focus() {}, release() {} }; } release() {} ensureVisible() {} }
class State { static new({ value = '' } = {}) { return new State(value); } constructor(value) { this.text = value; } value() { return this.text; } set_value(value) { this.text = value; } on() {} focus() {} release() {} }
const context = vm.createContext({ console });
const managedLists = new Map(), reviewCommands = [];
const bindings = {
  './review-analysis.js': { ReviewAnalysis: class { init() { this.state = {}; } close() { return Promise.resolve(); } release() { return this.close(); } tokens() { return []; } diagnostics() { return []; } }, reviewSegments: text => [{ text }] },
  './idea-tokens.js': { IDEA_TOKENS: { 'herdr.ux': { syntax: {} } } },
  'gpui-kit': { div: element }, 'gpui-base': { h_flex: element, v_flex: element, h_resizable: element, resizable_panel: element, InputState: State, Input: { new: element }, TextareaState: State, Textarea: { new: element }, TextView: { html: element, markdown: element } },
  herdr: { shared: key => store.get(key), setShared: (key, value) => store.set(key, value), exec: async (...args) => { commands.push(args); return handler(...args); }, readTextFile: async file => fs.readFile(file, 'utf8'),
    agents: () => [{ address: 'agent-1', space: 's' }, { address: 'foreign', space: 'other' }], openOverlay: value => overlays.push(value), run: value => reviewCommands.push(value) },
  './idea-design.js': { adeUI: value => value, adeColors: () => ({ success: '#00ff00', error: '#ff0000' }), adeButton: element, adeInputBox: value => value, adeManagedList: (id, rows, _menu, _cx, options) => { managedLists.set(id, { rows, options }); return element(); }, adeNote: element, MenuController },
  './ui-icons.js': { uiIcon: element }, './workspace.js': { currentProject: () => current, projectKey, openDocument: (file, scope) => { opened.push({ file, scope }); store.set('ade.editor-mode', { ...store.get('ade.editor-mode'), [projectKey(scope)]: 'file' }); } },
};
const model = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/review-model.js', import.meta.url), 'utf8'), { context }); await model.link(() => {}); await model.evaluate();
bindings['./gutter-navigation.js'] = { gutterIcon: () => 'arrow-up' };
bindings['./idea-design.js'].adeGutterAction = element;
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/review.js', import.meta.url), 'utf8'), { context });
await module.link(async name => name === './review-model.js' ? model : new vm.SyntheticModule(Object.keys(bindings[name]), function () { for (const [key, value] of Object.entries(bindings[name])) this.setExport(key, value); }, { context }));
await module.evaluate(); const api = module.namespace, pure = model.namespace, plain = value => JSON.parse(JSON.stringify(value));
const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n tail\n@@ -20 +20 @@\n-before\n+after\n';
const rows = pure.reviewRows(patch);
assert.deepEqual(plain(rows).map(row => [row.kind, row.a, row.b]), [['@', undefined, undefined], [' ', 1, 1], ['-', 2, undefined], ['+', undefined, 2], [' ', 3, 3], ['@', undefined, undefined], ['-', 20, undefined], ['+', undefined, 20]]);
assert.equal(pure.differenceIndex(rows, null, 1), 2); assert.equal(pure.differenceIndex(rows, 2, 1), 6); assert.equal(pure.differenceIndex(rows, 2, -1), 6);
assert.equal(pure.sourceLine(rows, 2), 2); assert.equal(pure.reviewRange(rows, 2, 2, 'x').side, 'old'); assert.equal(pure.reviewRange(rows, 2, 3, 'x').side, 'new');
const oddPath = "tab\tname '$(echo nope)'.txt";
assert.equal(pure.reviewFiles(`M\0${oddPath}\0`, `3\t2\t${oddPath}\0`)[0].path, oddPath); assert.equal(pure.reviewFiles('', '', '-new\nfile\0')[0].untracked, true);
const legacy = { comments: [{ id: 'legacy', path: 'x.txt', side: 'new', start: 1, end: 1, body: 'Existing note', code: [' context'] }], base: 'main', mode: 'worktree', future: 7 };
store.set('codenav.reviews', { ':/repo': legacy });
const fake = { repository: async scope => ({ context: scope, branch: 'feature', origin: 'origin/main', refs: [{ id: 'refs/heads/main', label: 'main' }, { id: 'refs/heads/feature', label: 'feature' }] }),
  files: async () => ({ mergeBase: 'base-sha', files: [{ id: 'x.txt', path: 'x.txt', status: 'M', add: 2, remove: 2 }, { id: 'gone.txt', path: 'gone.txt', status: 'D' }] }),
  diff: async () => ({ rows, binary: false }), fetch: async () => {} };
const reviewTimers = [];
const cx = { timer: { every(_ms, fn) { reviewTimers.push(fn); return { cancel() {} }; } }, focus_handle: () => ({ focus() {}, release() {} }), notify() {}, stop_propagation() {}, spawn(fn) { tasks.push(fn(cx)); }, write_to_clipboard(text) { store.set('clipboard', text); } };
api.openReview(); assert.equal(store.get('ade.review-open')[projectKey(current)], true); assert.equal(store.get('ade.editor-mode')[projectKey(current)], 'review');
const view = new api.ReviewView(); view.init({ context: current, service: fake }, cx); await tasks.at(-1);
assert.equal(view.loading, false); assert.equal(view.base, 'refs/heads/main'); assert.equal(view.comments()[0].body, 'Existing note');
assert.equal(store.get('ade.reviews')['[null,"/repo"]'].future, 7, 'legacy data/unknown properties migrate without editing legacy backing');
view.selectRange(2, 3, cx); view.comment.set_value('Check this replacement'); assert.equal(view.dirty(), true); view.saveComment(cx);
assert.equal(view.comments().length, 2); assert.equal(view.dirty(), false); assert.equal(legacy.comments.length, 1);
const newId = view.comments().at(-1).id; view.editComment(newId, cx); view.comment.set_value('Updated'); view.saveComment(cx); assert.equal(view.comments().find(item => item.id === newId).body, 'Updated');
view.selectRange(2, 2, cx); view.comment.set_value('Removed line note'); view.saveComment(cx); assert.match(view.message(), /삭제된 줄/);
view.removeComment(newId, cx); assert.equal(view.comments().some(item => item.id === newId), false);
view.cursor = 3; view.openSelectedSource(); assert.equal(opened.at(-1).file, '/repo/x.txt'); assert.equal(store.get('ade.navigation')[projectKey(current)].line, 2); assert.equal(store.get('ade.editor-mode')[projectKey(current)], 'file');
view.attach(); assert.equal(overlays.at(-1).props.address, 'agent-1'); assert.equal(overlays.at(-1).props.text, view.message()); assert.equal(overlays.at(-1).props.view, 'attachment');
const freshCx = { ...cx, event: 'fresh-confirmation' }; let closedWith = null;
view.selectRange(2, 3, cx); view.comment.set_value('Pending close note'); view.requestClose(eventCx => { closedWith = eventCx; }, cx);
assert(view.pendingClose); view.closeDraft('cancel', freshCx); assert.equal(closedWith, null); assert.equal(view.comment.value(), 'Pending close note');
view.requestClose(eventCx => { closedWith = eventCx; }, cx); view.closeDraft('save', freshCx);
assert.equal(closedWith, freshCx, 'close callback receives the confirmation event context, not an earlier context'); assert(view.comments().some(item => item.body === 'Pending close note'));
view.selectRange(2, 2, cx); view.comment.set_value('Discard this draft'); const savedCount = view.comments().length;
view.requestClose(eventCx => { closedWith = eventCx; }, cx); view.closeDraft('discard', freshCx); assert.equal(view.draft, null); assert.equal(view.comments().length, savedCount);
view.editComment('legacy', cx); view.comment.set_value(''); view.requestClose(() => {}, cx); assert.equal(view.canSaveComment(), false); view.closeDraft('save', freshCx); assert(view.pendingClose, 'invalid draft cannot be saved-and-closed'); view.closeDraft('discard', freshCx);
const pending = []; fake.diff = async (_repo, file) => new Promise(resolve => pending.push({ file, resolve }));
view.selectFile('x.txt', cx); const older = tasks.at(-1); view.selectFile('gone.txt', cx); const newer = tasks.at(-1);
await new Promise(setImmediate);
pending[1].resolve({ rows: [{ kind: '-', a: 7, text: 'deleted' }], binary: false }); await newer; pending[0].resolve({ rows, binary: false }); await older;
assert.equal(view.rows[0].a, 7); const beforeDeletedOpen = opened.length; view.openSelectedSource(); assert.equal(opened.length, beforeDeletedOpen, 'deleted source cannot open');
fake.diff = async () => ({ rows, binary: false }); view.selectFile('x.txt', cx); await tasks.at(-1);
view.selectRange(2, 2, cx); view.comment.set_value('Unsaved original project');
const original = current; current = { ...current, id: 'other', root: '/other' };
view.render({ spawn() { throw new Error('render must enqueue only'); } }); reviewTimers[0](cx); await Promise.resolve(); await tasks.at(-1);
view.saveComment(cx); assert.match(view.note, /원래 프로젝트/); assert.equal(view.comments().length, 0, 'draft cannot save into another repo');
current = original; view.refresh(cx, current); await tasks.at(-1); view.saveComment(cx); assert(view.comments().some(item => item.body === 'Unsaved original project'));
let fetches = 0; fake.fetch = async () => { fetches++; }; view.fetch(cx); await tasks.at(-1); await Promise.resolve(); await tasks.at(-1); assert.equal(fetches, 1);
view.release();
const again = new api.ReviewView(); const key = '[null,"/repo"]'; store.set('ade.reviews', { ...store.get('ade.reviews'), [key]: { ...store.get('ade.reviews')[key], base: 'HEAD', head: 'HEAD', mode: 'head' } });
again.init({ context: current, service: fake }, cx); await tasks.at(-1); assert.equal(again.base, 'HEAD'); assert.equal(again.head, null); again.pick('head', cx); assert.equal(again.picking, undefined, 'comparison target cannot be selected'); again.chooseRef('refs/heads/other', cx); assert.equal(again.head, null); assert(again.comments().some(item => item.body === 'Pending close note'), 'saved comments survive view recreation'); again.removeComment('legacy', cx); assert.equal(again.comments().some(item => item.id === 'legacy'), false, 'existing migrated comments can be removed'); assert.equal(legacy.comments.length, 1, 'legacy backing remains unchanged'); assert.equal(store.get('ade.reviews')[key].comments.some(item => item.id === 'legacy'), false, 'removal persists in canonical state'); again.release();
// The tool window renders navigation only. Actions reach the central owner.
bindings['./workspace.js'].documentState = () => ({ tabs: [], active: null });
bindings['./idea-design.js'].adeTab = element;
bindings['./idea-design.js'].TabViewport = class {};
bindings['./idea-design.js'].uiTabStrip = element;
bindings['./text-editor.js'] = { default: class {} };
bindings['./database-editor.js'] = { DatabaseEditor: class {} };
bindings['./database-model.js'] = { databaseDocumentState: () => ({ tabs: [], active: null }) };
const hostModule = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/editor-host.js', import.meta.url), 'utf8'), { context });
await hostModule.link(async name => name === './review.js' ? module : new vm.SyntheticModule(Object.keys(bindings[name]), function () { for (const [key, value] of Object.entries(bindings[name])) this.setExport(key, value); }, { context }));
await hostModule.evaluate();
const central = new api.ReviewView(); central.init({ context: current, service: fake }, cx); await tasks.at(-1);
managedLists.clear(); central.render(cx); assert.equal(managedLists.has('review-files'), false, 'central editor has no embedded file navigator');
const sidebar = new api.ReviewSidebar(); sidebar.init({ context: current }, cx); sidebar.render(cx);
const sideFiles = managedLists.get('review-files'); assert.ok(sideFiles.rows.some(row => row.id === 'x.txt'));
sideFiles.options.onSelect('x.txt', null, cx);
const request = JSON.parse(reviewCommands.at(-1).slice('ade.review-action:'.length));
assert.equal(request.action, 'select'); assert.equal(request.project, projectKey(current));
const host = new hostModule.namespace.EditorHost(); Object.assign(host, { context: current, review: central, database: { context: current }, orders: new Map() });
host.reviewAction(request, cx); await tasks.at(-1); assert.equal(central.selected, 'x.txt');
assert.equal(host.entries().find(entry => entry.kind === 'review').title, 'x.txt');
const beforeForeign = central.selected; host.reviewAction({ ...request, project: 'foreign', path: 'gone.txt' }, cx); assert.equal(central.selected, beforeForeign);
sidebar.section = 'comments'; sidebar.render(cx);
assert.ok(managedLists.get('review-comments').options.rowActions()[1].label.includes('삭제'));
const snapshotKey = projectKey(current), snapshot = store.get('ade.review-files')[snapshotKey];
store.set('ade.review-files', { ...store.get('ade.review-files'), [snapshotKey]: { ...snapshot, files: [{ path: 'src/a.kt', status: 'M' }, { path: 'src/b.kt', status: 'A' }], version: snapshot.version + 1 } });
sidebar.section = 'files'; sidebar.fileView = 'tree'; sidebar.render(cx);
const treeRows = managedLists.get('review-files'); assert.equal(treeRows.rows[0].id, 'src/'); treeRows.options.onActivate('src/', null, cx); sidebar.render(cx);
assert.equal(managedLists.get('review-files').rows.length, 1, 'folder collapse belongs to the tool window');
sidebar.release(); central.release();
console.log('PASS separated review: tool file/tree/comment navigation, central diff-only rendering, selected-file tab title and scoped owner routing');
assert.match(pure.reviewMessage({ base: 'other', mode: 'head' }, [{ path: 'x', start: 1, end: 1, body: 'note', base: 'main', head: null, mode: 'worktree' }]), /이전 비교 범위/);
// Actual Git fixture exercises merge-base, committed/staged/unstaged/untracked,
// binary/deletion, literal odd paths and full-context command boundaries.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-review-'));
const git = async args => execute('git', args, { cwd: directory, maxBuffer: 8 * 1024 * 1024 });
try {
  await git(['init', '-b', 'main']); await git(['config', 'user.email', 'fixture@example.test']); await git(['config', 'user.name', 'ADE Fixture']);
  await fs.writeFile(path.join(directory, oddPath), 'one\ntwo\n'); await fs.writeFile(path.join(directory, 'gone.txt'), 'delete me\n'); await fs.writeFile(path.join(directory, 'binary.bin'), Buffer.from([0, 1]));
  await git(['add', '--all']); await git(['commit', '-m', 'base']); await git(['switch', '-c', 'feature']);
  await fs.writeFile(path.join(directory, oddPath), 'one\ncommitted\n'); await git(['add', '--all']); await git(['commit', '-m', 'feature']);
  await fs.appendFile(path.join(directory, oddPath), 'working\n'); await fs.writeFile(path.join(directory, 'staged.txt'), 'staged\n'); await git(['add', '--', 'staged.txt']); await fs.writeFile(path.join(directory, "-untracked 'x'.txt"), 'untracked\n'); await fs.rm(path.join(directory, 'gone.txt')); await fs.writeFile(path.join(directory, 'binary.bin'), Buffer.from([0, 2]));
  handler = async (program, args, options) => { try { const result = await execute(program, args, { cwd: options.cwd, maxBuffer: 8 * 1024 * 1024 }); return { code: 0, ...result }; } catch (error) { return { code: Number(error.code) || 1, stdout: error.stdout || '', stderr: error.stderr || error.message }; } };
  const service = new api.ReviewService(), scope = { ...original, root: directory }, repo = await service.repository(scope);
  assert.equal(repo.branch, 'feature'); assert(repo.refs.some(ref => ref.id === 'refs/heads/main'));
  const worktree = await service.files(scope, 'refs/heads/main', null, 'worktree'); assert.equal(worktree.files.length, 5); assert(worktree.files.some(file => file.status === 'D')); assert(worktree.files.some(file => file.untracked));
  const committed = await service.files(scope, 'refs/heads/main', null, 'head'); assert.deepEqual(Array.from(committed.files, file => file.path), [oddPath]);
  const diff = await service.diff(scope, worktree.files.find(file => file.path === oddPath), worktree.mergeBase, null, 'worktree', true); assert(diff.rows.some(row => row.text === 'working' && row.kind === '+'));
  const binary = await service.diff(scope, worktree.files.find(file => file.path === 'binary.bin'), worktree.mergeBase, null, 'worktree', false); assert.equal(binary.binary, true);
  const untracked = await service.diff(scope, worktree.files.find(file => file.untracked), worktree.mergeBase, null, 'worktree', false); assert.equal(untracked.rows[0].b, 1);
  const diffCall = commands.find(call => call[1].includes(oddPath)); assert.equal(diffCall[1].at(-2), '--'); assert(diffCall[1].includes('--no-textconv')); assert(diffCall[1].includes('--literal-pathspecs'));
  const treeId = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim(), orphan = (await git(['commit-tree', treeId, '-m', 'unrelated fixture'])).stdout.trim();
  await assert.rejects(service.files(scope, 'refs/heads/main', orphan, 'head'), /공통 커밋/);
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('PASS ADE review: actual merge-base Git fixtures/modes/literal paths, hunk/source navigation, old/new ranges, legacy-preserving comment CRUD/persistence, stale diff/project guards, unsent AI draft and explicit fetch');

const treeFiles = [{ path: 'src/b/index.ts' }, { path: 'README.md' }, { path: 'src/a/index.ts' }, { path: 'src', status: 'D' }];
const tree = model.namespace.reviewFileTree(treeFiles);
assert.deepEqual(Array.from(tree, row => row.name), ['src', 'a', 'index.ts', 'b', 'index.ts', 'README.md', 'src']);
assert.equal(tree[2].file.path, 'src/a/index.ts'); assert.equal(tree[2].depth, 2);
const folded = model.namespace.reviewFileTree(treeFiles, new Set(['src']));
assert.equal(folded.length, 3); assert.equal(folded[0].expanded, false);
assert.equal(treeFiles[0].path, 'src/b/index.ts', 'tree projection preserves input order and original paths');
const directoryEntries = 'nested-repo/\0src/deep/\0src/deep/real.ts\0';
assert.deepEqual(Array.from(pure.reviewFiles('', '', directoryEntries), file => file.path), ['src/deep/real.ts']);
const safeTree = model.namespace.reviewFileTree([...treeFiles, { path: 'src/' }, { path: 'src/a/' }, { path: 'nested-repo/' }]);
assert.equal(new Set(Array.from(safeTree, row => row.id)).size, safeTree.length, 'directory placeholders cannot duplicate virtual-list identities');
assert.equal(safeTree.some(row => !row.folder && row.name === ''), false);

console.log('PASS review file tree: directory ordering, duplicate basenames, collapse, deleted-file/directory collision and unchanged paths');

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const saved = new Map();
let liveSpaces = [{ id: "a", name: "Alpha", folder: "/alpha", machine: null, active: true, branch: "main", tabs: [{ id: "tab-a" }], index: 0 }];
let livePanes = [], pending = [], runs = [], picked = null, closed = [];
const element = () => new Proxy({}, { get: (_target, key) => key === "then" ? undefined : () => element() });
class MenuController {
  constructor() { this.at = 0; this.focus = { focus() {}, release() {} }; this.scroll = {}; }
  release() {} ensureVisible() {} normalize() {} select(index) { this.at = index; }
}
const context = vm.createContext({ console });
const statuses = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/file-status.js", import.meta.url), "utf8"), { context });
await statuses.link(() => {}); await statuses.evaluate();
const bindings = {
  "./file-status.js": { ...statuses.namespace },
  "gpui-kit": { div: element },
  "gpui-base": { h_flex: element, v_flex: element, v_virtual_list: element, Scrollbar: { vertical: element }, Input: { new: element }, InputState: { new: () => ({ text: "", value() { return this.text; }, set_value(value) { this.text = value; }, on() {}, focus() {}, release() {} }) } },
  herdr: { spaces: () => liveSpaces, panes: () => livePanes, shared: key => saved.get(key), setShared: (key, value) => saved.set(key, value),
    exec: (...args) => args[1]?.[1] === statuses.namespace.GIT_STATUS ? Promise.resolve({ code: 0, stdout: "{}" }) : new Promise(resolve => pending.push({ args, resolve })), run: (...args) => runs.push(args),
    pickFolder: async () => picked, closeOverlay: id => closed.push(id) },
  "./idea-design.js": { ADE: { rowHeight: 28 }, adeUI: value => value, adeSize: value => value ?? 13,
    adeColors: () => ({}), adeRow: element, adeButton: element, adeNote: element, adePanel: element, adeInputBox: element, MenuController, adeManagedList: element },
  "./ui-icons.js": { uiIcon: element },
};
const module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/workspace.js", import.meta.url), "utf8"), { context });
await module.link(async name => {
  const values = bindings[name];
  const dependency = new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
  return dependency;
});
await module.evaluate();
const api = module.namespace;
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(api.currentProject()), { id: "a", name: "Alpha", root: "/alpha", machine: null, branch: "main" });
const alpha = api.currentProject(), beta = { ...plain(alpha), id: "b", root: "/beta" };
saved.set('ade.editor-mode', { [api.projectKey(alpha)]: 'database', [api.projectKey(beta)]: 'database' });
api.openDocument('relative.js', alpha); assert.equal(saved.get('ade.editor-mode')[api.projectKey(alpha)], 'database');
assert.notEqual(api.projectKey({ machine: "a", root: "b/c", id: "d" }), api.projectKey({ machine: "a/b", root: "c", id: "d" }));
api.openDocument("/alpha/one.js", alpha); api.openDocument("/alpha/two.js", alpha); api.openDocument("/alpha/one.js", alpha);
assert.equal(saved.get('ade.editor-mode')[api.projectKey(alpha)], 'file'); assert.equal(saved.get('ade.editor-mode')[api.projectKey(beta)], 'database', 'file activation remains project scoped');
api.openDocument("/beta/one.js", beta); api.openDocument("relative.js", alpha);
assert.deepEqual(plain(api.documentState(alpha)), { tabs: ["/alpha/one.js", "/alpha/two.js"], active: "/alpha/one.js" });
api.closeDocument("/alpha/one.js", alpha);
assert.deepEqual(plain(api.documentState(alpha)), { tabs: ["/alpha/two.js"], active: "/alpha/two.js" });
api.closeDocument("/alpha/two.js", alpha);
assert.deepEqual(plain(api.documentState(alpha)), { tabs: [], active: null });
assert.equal(api.documentState(beta).active, "/beta/one.js");
liveSpaces[0].folder = ""; livePanes = [{ tab: "unrelated", cwd: "/wrong" }, { tab: "tab-a", cwd: "/fallback", branch: "work" }];
assert.equal(api.currentProject().root, "/fallback");
liveSpaces[0].folder = "/alpha";
let tasks = [];
const cx = { timer: { every: () => ({ cancel() {} }) }, notify() {}, spawn(fn) { const promise = fn(cx); tasks.push(promise); }, focus_handle() { return { focus() {}, release() {} }; } };
const tree = new api.ProjectTree(); tree.init({ onOpen: (path, project) => runs.push([path, project]) }, cx);
assert.equal(pending.length, 1);
assert.equal(pending[0].args[0], "python3");
assert.equal(pending[0].args[1].at(-1), "/alpha");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-tree-scan-'));
try {
  await fs.mkdir(path.join(fixture, '.git')); await fs.mkdir(path.join(fixture, 'src')); await fs.writeFile(path.join(fixture, '.visible-config'), '');
  const scanned = JSON.parse(execFileSync('python3', ['-c', pending[0].args[1][1], fixture], { encoding: 'utf8' }));
  assert.deepEqual(scanned.map(entry => entry.name), ['src', '.visible-config'], 'tree hides Git internals while preserving other project dotfiles');
} finally { await fs.rm(fixture, { recursive: true, force: true }); }
const first = pending.shift();
tree.refresh(cx); const second = pending.shift();
second.resolve({ code: 0, stdout: JSON.stringify([{ name: "src", path: "/alpha/src", directory: true }, { name: "readme", path: "/alpha/readme", directory: false }]) });
await tasks.at(-1);
first.resolve({ code: 0, stdout: JSON.stringify([{ name: "stale", path: "/alpha/stale", directory: false }]) });
await tasks[0];
assert.deepEqual(plain(tree.rows()).map(row => row.name), ["Alpha", "src", "readme"]);
tree.activate(tree.rows()[1], cx);
assert.equal(pending.length, 1, "directory reads are lazy");
pending.shift().resolve({ code: 1, stderr: "Permission denied" }); await tasks.at(-1);
assert.equal(tree.rows().find(row => row.retry)?.retry, true);
tree.activate(tree.rows().find(row => row.retry), cx);
pending.shift().resolve({ code: 0, stdout: "[]" }); await tasks.at(-1);
assert.equal(tree.rows().find(row => row.label === "빈 폴더")?.label, "빈 폴더");
tree.nodes.set('/alpha/src', { children: [{ name: 'only', path: '/alpha/src/only', directory: true }] });
tree.expand('/alpha/src', cx); assert(tree.expanded.has('/alpha/src/only'));
pending.shift().resolve({ code: 0, stdout: JSON.stringify([{ name: 'file.ts', path: '/alpha/src/only/file.ts', directory: false }]) }); await tasks.at(-1);
assert.equal(tree.expanded.has('/alpha/src/only/file.ts'), false, 'single-child expansion stops at a file');
tree.expanded.delete('/alpha/src'); tree.expand('/alpha/src', cx); assert(tree.expanded.has('/alpha/src/only'), 'cached chains reopen together');
tree.refresh(cx); const staleProject = pending.shift();
liveSpaces[0] = { ...liveSpaces[0], id: "changed", folder: "/changed" };
staleProject.resolve({ code: 0, stdout: "[]" }); await tasks.at(-1);
assert.equal(tree.nodes.get("/alpha").loading, true, "project switch rejects outstanding response");
tree.release();
liveSpaces = [{ ...liveSpaces[0], id: "remote", machine: "server", folder: "/remote", name: "Remote" }, { id: "local", name: "Local", folder: "/local", machine: null, tabs: [], index: 1 }];
const picker = new api.ProjectPicker(); picker.init({ overlay: "dialog" }, cx);
picker.sortOpen = true; picker.chooseSort('manual', cx);
assert.equal(picker.sortOpen, false); assert.equal(Array.isArray(picker.draft), true, 'manual sort immediately opens managed ordering draft'); assert.equal(saved.has('ade.projectOrder'), false, 'choosing manual mode does not save an order');
picker.selected = picker.draft[0];
const before = [...picker.draft]; picker.move(1, cx);
assert.equal(picker.draft[1], before[0]);
assert.equal(runs.length, 0, "staged reorder does not modify core spaces");
picked = "/picked local/with 'quotes'";
picker.pick(cx); for (let i=0;i<8;i++) await Promise.resolve();
const creation = pending.pop(); assert.equal(creation.args[0], 'herdr-app');
assert.deepEqual(plain(creation.args[1].slice(0, 2)), ['do', 'space.new']);
assert.deepEqual(JSON.parse(creation.args[1][2]), { name: "with 'quotes'", folder: picked, machine: '' });
creation.resolve({ code: 0, stdout: '{"ok":true}' }); await tasks.at(-1);
assert.equal(saved.has('ade.projectRoots'), false, 'adding a project never replaces the current root');
assert.equal(liveSpaces[0].folder, "/remote", "adding a local project preserves the remote project");
assert.deepEqual(closed, ["dialog"]);
const reopen = new api.ProjectPicker(); reopen.init({ overlay: 'existing' }, cx); picked = '/local/';
const localKey = reopen.projects().find(item => item.id === 'local').key;
reopen.edit(localKey, 'rename', cx); reopen.nameInput.set_value('   '); reopen.rename(cx);
assert.equal(pending.length, 0, 'blank names cannot rename a space');
reopen.nameInput.set_value('New "local" name'); reopen.rename(cx);
const renameRequest = pending.pop();
assert.deepEqual(plain(renameRequest.args[1].slice(0, 2)), ['do', 'space.rename']);
assert.deepEqual(JSON.parse(renameRequest.args[1][2]), { id: 'local', name: 'New "local" name' });
renameRequest.resolve({ code: 1, stderr: 'rename failed' }); await tasks.at(-1);
assert.equal(reopen.editing.kind, 'rename', 'failed rename keeps the draft for retry');
reopen.rename(cx); pending.pop().resolve({ code: 0 }); await tasks.at(-1);
assert.equal(reopen.editing, null);
const beforeRemove = runs.length;
reopen.edit(localKey, 'remove', cx); reopen.remove(cx);
assert.equal(reopen.projects().some(item => item.id === 'local'), false);
assert.equal(liveSpaces.length, 2, 'removal does not destroy core workspaces or terminals');
assert.equal(runs.length, beforeRemove, 'removal must never call space.close');
assert.equal(new api.ProjectPicker().projects().some(item => item.id === 'local'), false, 'removed list survives picker recreation');
const pendingCount = pending.length; reopen.pick(cx); await tasks.at(-1);
assert.equal(reopen.projects().some(item => item.id === 'local'), true, 'opening the folder restores a removed project');
assert.equal(pending.length, pendingCount, 'existing local root is reused without creating a duplicate');
assert.deepEqual(plain(runs.at(-1)), ['space.select', { id: 'local' }]); reopen.release();
picker.release();
console.log("ADE workspace checks passed (identity/scoped file mode, lazy reads, retry/stale responses, manual order, separate project creation and existing-root reuse)");

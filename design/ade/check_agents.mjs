import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
let current = { id: 'one' }, rendered;
const opened = [], commands = [];
const agents = ['working', 'blocked', 'done', 'idle'].map((status, index) => ({ address: `t${index}`, space: index ? 'two' : 'one', status, title: `Agent ${index}`, program: index === 0 ? { name: 'Claude Code', icon: 'icons/claude.svg', tint: false } : index === 1 ? { name: 'Codex', icon: 'icons/codex.svg', tint: true } : null }));
class MenuController { constructor() { this.focus = { release() {} }; } release() {} }
const element = () => new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : () => element() });
const context = vm.createContext({});
const mocks = {
  'gpui-kit': { div: element, svg: element, image: element },
  'gpui-base': { h_flex: element, v_flex: element, Textarea: {}, TextareaState: {} },
  herdr: { agents: () => agents, spaces: () => [{ id: 'one', name: 'First' }, { id: 'two', name: 'Second' }], knownAgents() {}, readTextFile() {}, openOverlay() {}, closeOverlay() {}, exec() {}, props() {}, run(command, args) { commands.push([command, args]); if (command === 'space.select') current = { id: args.id }; } },
  './idea-design.js': { adeUI: element, adeButton: element, adeNote: element, adePanel: element, adeColors: () => ({}), MenuController, adeManagedList(_id, rows, _controller, _cx, options) { rendered = { rows, options }; return element(); } },
  './ui-icons.js': { uiIcon: element },
  './workspace.js': { currentProject: () => current, projectKey: item => item.id, documentState: () => ({}) },
  './terminal.js': { showTerminal: (address, project) => opened.push([address, project.id]) },
};
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/agents.js', import.meta.url), 'utf8'), { context });
await module.link(name => { const values = mocks[name]; return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
await module.evaluate();
const view = new module.namespace.AgentPanel(), cx = { notify() {}, timer: { after(_delay, callback) { callback(cx); } } };
view.init({}, cx); view.render(cx);
assert.equal(rendered.options.activateOnClick, true);
assert.equal(rendered.options.actions, undefined); assert.equal(rendered.options.rowActions, undefined);
assert.deepEqual(Array.from(rendered.rows.filter(row => row.heading), row => [row.label, row.detail]), [['진행 중', '1'], ['입력 대기', '1'], ['완료', '1'], ['대기', '1']]);
assert.deepEqual(Array.from(rendered.rows.filter(row => !row.heading), row => row.detail), ['First', 'Second', 'Second', 'Second']);
assert.equal(rendered.options.selectedId, 't0');
assert.equal(module.namespace.agentKind(agents[0]), 'Claude Code');
assert.equal(module.namespace.agentKind({ app: 'pi' }), 'pi');
for (const row of rendered.rows.filter(row => !row.heading)) { assert.equal(typeof row.icon, 'function'); row.icon(); assert.ok(row.tip.includes(row.id)); }
rendered.options.onActivate('t0', null, cx); assert.deepEqual(opened.at(-1), ['t0', 'one']);
rendered.options.onActivate('t1', null, cx); assert.deepEqual(opened.at(-1), ['t1', 'two']);
assert.equal(commands[0][0], 'space.select');
agents[0].status = 'blocked'; view.render(cx);
assert.deepEqual(Array.from(rendered.rows.filter(row => row.heading), row => [row.label, row.detail]), [['입력 대기', '2'], ['완료', '1'], ['대기', '1']]);
assert.equal(rendered.options.caption, '4개 에이전트 · 모든 프로젝트');
view.release();
console.log('PASS agent rows: single-click navigation, cross-project focus, native status labels and no clipboard actions');

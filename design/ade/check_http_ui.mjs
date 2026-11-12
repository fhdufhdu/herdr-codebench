import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { readableOutput } from '../../mods/ade/execution-output.js';
import { analyzeHttp, httpCompletions } from '../../mods/ade/http-analysis.js';
import { completionEdits } from '../../mods/ade/editor-completion.js';

const raw = 'HTTP/1.1 200\n{"items":[{"name":"한글","active":true}]}\nnot JSON {\n';
const readable = readableOutput(raw);
assert.match(readable, /\n  "items": \[\n/);
assert.match(readable, /not JSON \{\n$/);
assert.equal(readableOutput(readable), readable);
assert.equal(analyzeHttp('GET https://example.test\nAccept: application/json\n\n{"ok":true}').diagnostics.length, 0);
assert.equal(analyzeHttp('GET\nBroken header').diagnostics.length, 2);
assert.equal(analyzeHttp('### one\n< {%\nconst x = 1;\n%}\nGET {{baseUrl}}/\n\nbody\n### two\nPOST /relative\nContent-Type: application/json').symbols.length, 2);
assert.equal(analyzeHttp('GET /\n\nline without colon').diagnostics.length, 0, 'body text is not a malformed header');
assert.equal(httpCompletions('GET /\n\nCont', 13).length, 0);
for (const [text, expected] of [['GE', 'GET '], ['GET /\nContent-T', 'Content-Type: '], ['GET /\nAccept: app', 'application/json'], ['@baseUrl = https://example.test\nGET {{base', 'baseUrl}}']]) {
  const item = httpCompletions(text, text.length)[0];
  assert.ok(item, text);
  assert.equal(item.insert_text, expected);
  const { edits } = completionEdits(text, item, text.length);
  assert.equal(text.slice(0, edits[0].from) + edits[0].insert, text.slice(0, text.length - (edits[0].to - edits[0].from)) + expected);
}
const states = [], buttons = new Map(), shared = new Map();
const element = () => new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : (...args) => {
  if (name === 'when' && args[0]) return args[1](element());
  return element();
} });
const state = options => {
  const item = { options, text: options?.value ?? '', updates: 0, released: false,
    value() { return this.text; }, set_value(value) { this.text = value; this.updates++; }, release() { this.released = true; }, on() {} };
  states.push(item); return item;
};
class MenuController { constructor() { this.focus = { release() {}, focus() {} }; } release() {} }
const project = { id: 'fixture', root: '/fixture' }, key = context => context.id;
const bindings = {
  'gpui-kit': { div: element },
  'gpui-base': { h_flex: element, v_flex: element, InputState: { new: state }, Input: { new: element }, EditorState: { new: state }, Editor: { new: item => { assert.equal(item.options.readonly, true); assert.equal(item.options.soft_wrap, true); return element(); } } },
  herdr: { hc() { throw Error('No live process allowed'); }, shared: name => shared.get(name), setShared: (name, value) => shared.set(name, value), closeOverlay() {} },
  './workspace.js': { projectKey: key, currentProject: () => project, openDocument() {} },
  './idea-design.js': { adeUI: value => value, adeColors: () => ({}), adeSize: value => value, adeButton: (id, _label, action) => { buttons.set(id, action); return element(); }, adeTab: element, adeNote: element, MenuController, adeInputBox: element, adeManagedList: element, TabViewport: class {}, uiTabStrip: element, adePanel: element },
  './ui-icons.js': { uiIcon: element }, './execution-output.js': { readableOutput },
  './backend.js': { backend() {} }, './http-client.js': { httpRequests: () => [{ start: 0, end: 2, line: 0 }], httpEnvs: async () => ({ names: [] }), chosenEnv: () => null },
};
async function load(name) {
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(await fs.readFile(new URL(`../../mods/ade/${name}`, import.meta.url), 'utf8'), { context });
  await module.link(name => { const values = bindings[name]; return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
  await module.evaluate(); return module.namespace;
}
const cx = { spawn() {}, notify() {} };
const { ExecutionResults } = await load('execution.js');
const record = { id: 'one', output: raw, cwd: '/fixture', status: 'completed' };
shared.set('ade.execution', { fixture: { records: [record] } });
const results = new ExecutionResults(); results.init({ context: project, embedded: true }, cx); results.render(cx);
const output = states.at(-1); assert.equal(output.value(), readable);
results.render(cx); assert.equal(states.at(-1), output); assert.equal(output.updates, 1, 'unchanged render preserves scroll and selection');
let clipboard;
buttons.get('ade-execution-copy')(null, { write_to_clipboard: value => clipboard = value }); assert.equal(clipboard, readable);
buttons.get('ade-execution-copy-raw')(null, { write_to_clipboard: value => clipboard = value }); assert.equal(clipboard, raw);
record.output += 'tail'; results.render(cx); assert.equal(output.updates, 2);
results.release(); assert.equal(output.released, true);
const { HttpRequests } = await load('project-services.js');
const requests = new HttpRequests(); requests.init({ context: project, text: 'GET /\nAccept: text/plain', path: '/fixture/example.http' }, cx); requests.render(cx);
assert.equal(requests.preview.value(), 'GET /\nAccept: text/plain');
requests.release(); assert.equal(requests.preview.released, true);
console.log('PASS HTTP preview/result retained readonly scroll/copy surfaces, formatted/raw copies, JSON formatting and buffer lint/completion');

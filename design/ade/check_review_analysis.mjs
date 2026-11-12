import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const calls = [], sessions = []; let beforeResolve;
class Session {
 init(_cx, options) { this.options = options; sessions.push(this); }
 setActive() {}
 sync(snapshot) { this.snapshot = snapshot; }
 async request(kind) { this.kind = kind; }
 async close() { this.closed = true; }
}
const context = vm.createContext({ console });
const values = { './backend.js': { backend: async (kind, body) => { calls.push({ kind, body }); if (kind === 'info') return { lang: 'typescript' }; return [[[body.text.length, 'keyword']]]; } }, './lsp-session.js': { LspSession: Session } };
values['./gutter-navigation.js'] = { GutterNavigation: class { sync() {} release() {} at() { return null; } } };
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/review-analysis.js', import.meta.url), 'utf8'), { context });
await module.link(name => new vm.SyntheticModule(Object.keys(values[name]), function () { for (const [key, value] of Object.entries(values[name])) this.setExport(key, value); }, { context })); await module.evaluate();
const { ReviewAnalysis, reviewPosition, reviewSegments } = module.namespace;
assert.equal(reviewPosition({ kind: '+', b: 2, text: '😀name' }, 2, 'first\n😀name\n'), 8);
assert.equal(reviewPosition({ kind: '-', a: 2, text: 'old' }, 0, 'old'), null);
assert.equal(reviewPosition({ kind: '+', b: 1, text: 'old' }, 0, 'new'), null, 'mismatched historical/current text cannot query current LSP');
assert.equal(reviewSegments('const 😀name', [[5, 'keyword'], [7, 'property']]).map(span => span.text).join(''), 'const 😀name');
const analysis = new ReviewAnalysis(); analysis.init({ owner: {}, beforeOpen: () => new Promise(resolve => { beforeResolve = resolve; }), onUpdate() {}, onNavigate() {} });
const load = analysis.load({ context: { root: '/repo' }, path: '/repo/file.ts', text: 'const name = 1;', oldText: 'let before = 0;' }, {});
await new Promise(setImmediate); assert.equal(sessions.length, 0, 'source editor lease handoff must complete first');
beforeResolve(); await load; assert.equal(sessions.length, 1); assert.equal(sessions[0].snapshot.text, 'const name = 1;');
assert(analysis.select({ kind: '+', b: 1, text: 'const name = 1;' }, 6, {})); await analysis.request('references', {}); assert.equal(sessions[0].kind, 'references');
assert.equal(analysis.select({ kind: '-', a: 1, text: 'let before = 0;' }, 4, {}), false);
await analysis.close({}); assert(sessions[0].closed); assert.equal(analysis.session, null); assert.equal(analysis.target, null);
await analysis.load({ context: { root: '/repo' }, path: '/repo/file.ts', text: 'old source', oldText: 'older source', historical: true }, {});
assert.equal(sessions.length, 1, 'historical snapshots never become the current server document');
let released = false;
analysis.beforeOpen = async () => released;
await analysis.load({ context: { root: '/repo' }, path: '/repo/file.ts', text: 'const latest = 2;' }, {});
assert.equal(sessions.length, 1, 'failed source lease cleanup must not create a competing review owner');
assert.equal(analysis.state.status, 'error');
assert.match(analysis.state.error, /이전 분석 세션/);
released = true;
await analysis.load({ context: { root: '/repo' }, path: '/repo/file.ts', text: 'const latest = 2;' }, {});
assert.equal(sessions.length, 2, 'later successful exact-owner handoff can open review analysis');
assert.equal(sessions.at(-1).snapshot.text, 'const latest = 2;');
assert(calls.some(call => call.body.text === 'let before = 0;'), 'old source syntax uses its own explicit text');
await analysis.release({});
console.log('PASS review analysis: UTF16 matching-row navigation, old/current snapshot isolation, lease handoff, semantic routing and release');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const context = vm.createContext({}), pending = [], timers = [], tasks = [], updates = [], owner = {};
const values = {
  './backend.js': { backend: (method, body) => new Promise(resolve => pending.push({ method, body, resolve })) },
  herdr: { shared() {}, setShared() {}, readTextFile() {}, writeTextFile() {}, exec() {} },
};
const modules = new Map();
for (const [name, exports] of Object.entries(values)) modules.set(name, new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context }));
for (const name of ['navigation-markers', 'http-client', 'gutter-navigation']) modules.set(`./${name}.js`, new vm.SourceTextModule(await fs.readFile(new URL(`../../mods/ade/${name}.js`, import.meta.url), 'utf8'), { context }));
const module = modules.get('./gutter-navigation.js'); await module.link(name => modules.get(name)); await module.evaluate();
const { GutterNavigation, sourceGutterMarkers } = module.namespace;
const text = 'interface Greeting { fun greet(): String }\nclass Service : Greeting {\n override fun greet() = "hi"\n}';
assert.equal(sourceGutterMarkers('/a.kt', text).find(marker => marker.kind === 'super').line, 2);
assert.equal(sourceGutterMarkers('/a.kt', text).find(marker => marker.kind === 'implementation').line, 0);
const requests = sourceGutterMarkers('/a.http', '### first\nGET http://127.0.0.1/a\n### next\nPOST http://127.0.0.1/b');
assert.deepEqual(JSON.parse(JSON.stringify(requests.map(marker => [marker.line, marker.requestIndex]))), [[1, 0], [3, 1]]);
const cx = { notify() {}, timer: { after(ms, fn, options) { assert.equal(ms, 300); assert.equal(options.owner, owner); const timer = { fn, cancel() { this.cancelled = true; } }; timers.push(timer); return timer; } },
  spawn(fn, options) { assert.equal(options.owner, owner); tasks.push(Promise.resolve().then(() => fn(cx))); } };
const nav = new GutterNavigation({ path: '/a.kt', context: { root: '/' }, owner, onUpdate: markers => updates.push(markers) });
nav.sync(text, 0, cx); timers.at(-1).fn(cx); await Promise.resolve();
assert.equal(pending[0].body.text, text);
nav.sync('\n' + text, 1, cx);
pending.shift().resolve([{ kind: 'spring', line: 1, col: 0 }]); await tasks.at(-1);
assert.equal(nav.markers.some(marker => marker.kind === 'spring'), false, 'late scan cannot attach an old marker to a new line');
assert.equal(nav.at(3).kind, 'super');
timers.at(-1).fn(cx); await Promise.resolve(); pending.shift().resolve([{ kind: 'spring', line: 2, col: 3, name: 'service' }]); await tasks.at(-1);
assert.equal(nav.at(2).kind, 'spring');
const target = nav.resolve(nav.at(2), cx); assert.equal(pending[0].method, 'related');
nav.sync(text, 2, cx); pending.shift().resolve([{ path: '/target.kt', line: 8 }]); assert.equal(await target, null, 'typing invalidates in-flight gutter navigation');
const beforeRelease = updates.length; nav.release(); nav.sync(text, 3, cx); assert.equal(updates.length, beforeRelease);
const repo = new GutterNavigation({ path: '/Repo.kt', context: { root: '/' }, owner, onUpdate() {} });
repo.sync('interface Repo : JpaRepository<Item, Long>', 0, cx);
timers.at(-1).fn(cx); await Promise.resolve();
pending.shift().resolve([{ kind: 'spring-bean', line: 0, col: 10, name: 'repo', title: 'Spring Data repository · dynamic proxy source candidate' }]);
await tasks.at(-1);
assert.equal(repo.at(0).kind, 'spring-bean', 'generated repositories expose injection uses instead of a nonexistent implementation class');
assert.match(repo.at(0).title, /실행 시 구현 생성/);
repo.release();
console.log('PASS ADE gutter navigation: shared override markers, interface implementation, HTTP blocks, unsaved Spring scan, owner lifecycle and stale revision/target guards');

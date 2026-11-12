// Owned localhost fixture: exercises the real ijhttp executable, no external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile), requests = [], saved = new Map();
const server = http.createServer((request, response) => { requests.push(request.url); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ owned: true })); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-http-owned-'));
try {
  const file = path.join(root, 'requests.http');
  const text = `### Selected fixture\nGET {{baseUrl}}/selected?item={{item}}\n\n> {%\nclient.test("owned response", function () { client.assert(response.body.owned === true); });\nclient.global.set("ownedGlobal", "fixture");\n%}\n\n### Must not execute\nGET {{baseUrl}}/unselected\n`;
  await fs.writeFile(file, text);
  await fs.writeFile(path.join(root, 'http-client.env.json'), JSON.stringify({ local: { baseUrl: `http://127.0.0.1:${server.address().port}`, item: 'fixture' } }));
  const values = {
    shared: key => saved.get(key), setShared: (key, value) => saved.set(key, value),
    readTextFile: async file => { try { return await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    writeTextFile: async (file, text, expected) => { if (expected === null) await fs.writeFile(file, text, { flag: 'wx' }); else await fs.writeFile(file, text); },
    exec: async (command, args) => { try { const result = await execute(command, args, { timeout: 30000 }); return { code: 0, ...result }; } catch (error) { return { code: error.code || 1, stdout: error.stdout || '', stderr: error.stderr || '' }; } },
  };
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(await fs.readFile(new URL('../idea/http-client.js', import.meta.url), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(values), function () { for (const [name, value] of Object.entries(values)) this.setExport(name, value); }, { context }));
  await module.evaluate(); const api = module.namespace, lines = text.split('\n');
  for (const [platform, custom, expected] of [['Darwin', '', 'KeychainStore'], ['Linux', '', ''], ['Darwin', '-Djavax.net.ssl.trustStore=fixture', 'fixture']]) {
    const script = `uname() { printf '%s' '${platform}'; }; ` + api.HTTP_TLS_SETUP + '\nprintf "%s" "$IJHTTP_JAVA_OPTS"';
    const result = await execute('/bin/sh', ['-c', script], { env: { ...process.env, IJHTTP_JAVA_OPTS: custom, JAVA_TOOL_OPTIONS: '', _JAVA_OPTIONS: '' } });
    if (expected) assert.ok(result.stdout.includes(expected)); else assert.equal(result.stdout, '');
    if (custom) assert.equal(result.stdout, custom, 'explicit JVM configuration is preserved');
    assert.equal(result.stdout.includes('--insecure'), false);
  }
  const envs = await api.httpEnvs(file, root); assert.equal(envs.names[0], 'local');
  const blocks = api.httpRequests(lines); assert.equal(blocks.length, 2);
  let launches = 0;
  const hooks = { environment: 'local', notify: () => assert.fail('fixture should launch'), launch: async config => {
    launches++;
    const copies = (await fs.readdir(root)).filter(name => name.endsWith('.http') && name !== 'requests.http');
    assert.equal(copies.length, 1); assert.equal((await fs.stat(path.join(root, copies[0]))).mode & 0o777, 0o600);
    await execute('/bin/sh', ['-lc', config.command], { cwd: config.folder, timeout: 30000 });
  } };
  await api.runHttp(file, lines, envs, blocks[0], null, hooks);
  assert.equal(launches, 1); assert.deepEqual(requests, ['/selected?item=fixture']);
  assert.deepEqual((await fs.readdir(root)).sort(), ['http-client.env.json', 'requests.http'], 'temporary request and report removed');
  assert.equal(saved.has('codenav.httpGlobals'), false, 'response globals never persisted into shared state');
  console.log('PASS shared HTTP client: real localhost response/test scripts, selected block only, environment resolution, 0600 snapshot and cleanup');
} finally { await fs.rm(root, { recursive: true, force: true }); await new Promise(resolve => server.close(resolve)); }

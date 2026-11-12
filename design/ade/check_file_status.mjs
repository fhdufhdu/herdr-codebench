import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const module = new vm.SourceTextModule(await fs.readFile(new URL('../../mods/ade/file-status.js', import.meta.url), 'utf8'));
await module.link(() => {}); await module.evaluate();
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-file-status-'));
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  git('init', '-b', 'main'); git('config', 'user.name', 'ADE Fixture'); git('config', 'user.email', 'fixture@example.test');
  for (const file of ['modified.txt', 'deleted.txt', "old 'name'.txt"]) await fs.writeFile(path.join(fixture, file), 'original\n');
  await fs.writeFile(path.join(fixture, '.gitignore'), 'excluded/\n');
  git('add', '.'); git('commit', '-m', 'fixture');
  await fs.appendFile(path.join(fixture, 'modified.txt'), 'changed\n'); await fs.rm(path.join(fixture, 'deleted.txt'));
  git('mv', "old 'name'.txt", 'renamed\nname.txt');
  await fs.writeFile(path.join(fixture, 'added.txt'), 'new\n'); git('add', 'added.txt');
  await fs.mkdir(path.join(fixture, 'nested')); await fs.writeFile(path.join(fixture, 'nested', 'unknown.txt'), 'new');
  await fs.mkdir(path.join(fixture, 'excluded')); await fs.writeFile(path.join(fixture, 'excluded', 'cache.txt'), 'cache');
  const result = JSON.parse(execFileSync('python3', ['-c', module.namespace.GIT_STATUS, fixture], { encoding: 'utf8' }));
  for (const [file, status] of Object.entries({ 'modified.txt': 'modified', 'deleted.txt': 'deleted', 'renamed\nname.txt': 'renamed', 'added.txt': 'added', nested: 'untracked', excluded: 'ignored' })) assert.equal(result[path.join(fixture, file)], status);
  assert.equal(result[path.join(fixture, "old 'name'.txt")], undefined, 'rename source NUL record is not a second file');
  const nonGit = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-no-git-'));
  try { assert.deepEqual(JSON.parse(execFileSync('python3', ['-c', module.namespace.GIT_STATUS, nonGit], { encoding: 'utf8' })), {}); } finally { await fs.rm(nonGit, { recursive: true }); }
} finally { await fs.rm(fixture, { recursive: true }); }
console.log('PASS Git file status: actual staged/unstaged/deleted/rename NUL paths, untracked/ignored directories and non-Git fallback');

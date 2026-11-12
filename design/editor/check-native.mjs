// CLI-only test harness. The deployed EditorBuffer/vendor have no Node imports.
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fixture = await mkdtemp(join(tmpdir(), 'codebench-editor-buffer-'));
for (const file of ['editor-buffer.js', 'editor-state-vendor.js']) {
  await copyFile(new URL(`../../mods/codenav/${file}`, import.meta.url), join(fixture, file));
}
await writeFile(join(fixture, 'mod.json'), JSON.stringify({ place: 'none' }));
await writeFile(join(fixture, 'main.js'), `
import { View, div } from 'gpui-kit';
import { EditorBuffer } from './editor-buffer.js';
export default class BufferProbe extends View {
  init() {
    const b = new EditorBuffer('한글👩🏽‍💻\\r\\n끝');
    b.select(2); b.move('right');
    if (b.head !== 9) throw new Error('Native grapheme movement failed');
    b.erase('left');
    if (b.text !== '한글\\r\\n끝') throw new Error('Native edit failed');
    b.undo(); b.redo();
    if (b.revision !== 3) throw new Error('Native undo/revision failed');
    this.result = b.text;
  }
  render() { return div().child(this.result); }
}
`);
const result = spawnSync('herdr-app', ['check', fixture], { encoding: 'utf8' });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
if (result.error || result.status !== 0) {
  console.error(`Native fixture retained at ${fixture}`);
  throw result.error ?? new Error(`Native buffer check failed: ${result.status}`);
}
await rm(fixture, { recursive: true });

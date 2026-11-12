// Isolated bounded native source probe. Reads only public mod sources; no install.
import { mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'ade-source-probe-'));
for (const name of ['code-input.js', 'code-document.js', 'editor-state-vendor.js', 'idea-design.js', 'idea-tokens.js']) {
  await copyFile(new URL(`../../mods/ade/${name}`, import.meta.url), join(directory, name));
}
await writeFile(join(directory, 'mod.json'), JSON.stringify({ place: 'none', title: 'ADE bounded source probe', focusable: true, overlay: { width: 760, height: 500 } }));
const sample = process.argv.includes('--interactions') || process.argv.includes('--find') ? 'const customerName = "안녕하세요";\n  customerName;'
  : Array.from({ length: 300 }, (_value, index) => `const value${index + 1} = "안녕하세요 ${index + 1}";`).join('\n');
await writeFile(join(directory, 'main.js'), `import {View} from "gpui-kit";
import {CodeInput} from "./code-input.js";
export default class extends View {
  init(_props,cx) {
    this.input = new CodeInput().init(${JSON.stringify(sample)},cx);
    this.input.focus();
    ${process.argv.includes('--find') ? 'this.input.openFind(true,cx);this.input.findText.set_value("customerName");this.input.replaceText.set_value("clientName");' : ''}
  }
  close() { this.input.release(); }
  render(cx) { return this.input.render(cx); }
}
`);
console.log(directory);

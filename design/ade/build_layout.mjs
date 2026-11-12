// node design/ade/build_layout.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises';
import { createFrameLayout } from '../../mods/ade/frame-layout.js';

if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Usage: node design/ade/build_layout.mjs [--check]');
const tokens = JSON.parse(await readFile(new URL('../idea/tokens.json', import.meta.url), 'utf8'));
const metrics = tokens['herdr.ade']?.metrics;
if (!metrics) throw new Error('Missing canonical herdr.ade.metrics');
const ux = tokens['herdr.ux'].colors;
const frame = createFrameLayout(metrics);
frame.colors = {
  canvas: ux.canvas, background: ux.editor, surface: ux.surface, chrome: ux.editor,
  popover: ux.popup, border: ux.separator, foreground: ux.foreground, muted: ux.secondary,
  dim: ux.disabled, accent: ux.accent, selected: ux.selection, hover: ux.hover,
};
const output = new URL('../../layouts/ade.json', import.meta.url), text = JSON.stringify(frame, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== text) throw new Error('ADE layout differs; run node design/ade/build_layout.mjs');
  console.log('PASS canonical ADE layout generation');
} else {
  await writeFile(output, text);
  console.log('Generated layouts/ade.json');
}

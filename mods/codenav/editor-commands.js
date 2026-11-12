// The focused document surface gets these aliases, including its preview and
// descendant controls. No global command relay or
// second document/command queue is created; user keymaps remain authoritative.
import { div } from 'gpui-kit';
import { keys } from 'herdr';
import { effectiveShortcuts, normalizeChord } from './actions.js';

const COMMANDS = [['activity.save', 'save'], ['activity.preview', 'preview']];
// Exact encoding, not a hash: distinct keymaps cannot reuse a stale context.
const encode = text => [...text].map(char => char.codePointAt(0).toString(16).padStart(6, '0')).join('');
const plan = () => {
  const bindings = keys(), context = { layout: 'idea', mod: 'codenav' };
  const entries = COMMANDS.flatMap(([id, command]) => [...new Set(effectiveShortcuts(id, bindings, context).map(normalizeChord))]
    .filter(Boolean).map(chord => ({ command, chord, action: `herdr-editor-command::${command}:${encode(chord)}` })))
    .sort((a, b) => a.command.localeCompare(b.command) || a.chord.localeCompare(b.chord));
  const signature = JSON.stringify(entries.map(({ command, chord }) => [command, chord]));
  return { entries, signature, context: `HerdrEditorCommands_${encode(signature)}` };
};

export class EditorCommands {
  init(cx, { onCommand, pending } = {}) {
    if (typeof onCommand !== 'function' || typeof pending !== 'function') throw new TypeError('EditorCommands requires command and pending callbacks');
    this.alive = true; this.onCommand = onCommand; this.pending = pending;
    this.installed = new Set(); this.ticket = 0; this.error = null;
    this.current = plan(); this.install(this.current, cx);
  }
  install(next, cx) {
    if (!this.alive || this.installed.has(next.signature)) return;
    try {
      if (next.entries.length) cx.bind_keys(next.entries.flatMap(entry => [
        { keystroke: entry.chord, action: entry.action, context: next.context },
        // Native Input/global bindings rank at the deepest context. Keep the
        // document alias for preview, and match that depth inside text inputs.
        { keystroke: entry.chord, action: entry.action, context: `${next.context} > Input` },
      ]));
      this.installed.add(next.signature); this.error = null;
    } catch (error) { this.error = String(error.message ?? error); }
  }
  refresh(next, cx) {
    this.current = next;
    const ticket = ++this.ticket;
    if (this.installed.has(next.signature)) return;
    // bind_keys is forbidden while rendering. A new context deactivates the
    // old keyset immediately; the deferred install only enables the new one.
    cx.timer.after(0, eventCx => {
      if (!this.alive || ticket !== this.ticket) return;
      this.install(next, eventCx); eventCx.notify();
    });
  }
  render(child, cx) {
    const next = plan();
    if (next.signature !== this.current.signature) this.refresh(next, cx);
    const current = this.current;
    let root = div().flex().flex_1().size_full().min_w(0).min_h(0).key_context(current.context).child(child);
    for (const entry of current.entries) root = root.on_action(entry.action, (event, eventCx) => {
      if (!this.alive || this.pending()) { eventCx.propagate(); return; }
      const latest = plan();
      if (latest.signature !== current.signature) {
        this.refresh(latest, eventCx); eventCx.notify(); eventCx.propagate(); return;
      }
      if (this.onCommand(entry.command, event, eventCx) === false) eventCx.propagate();
      else { eventCx.notify(); eventCx.stop_propagation(); }
    });
    return root;
  }
  release() {
    this.alive = false; ++this.ticket; this.onCommand = null; this.pending = null;
    // Old application bindings cannot be unregistered through the public SDK.
    // No focused wrapper advertises their obsolete keymap context after release.
  }
}

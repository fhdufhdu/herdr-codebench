// Experimental OS text/IME boundary. The document, selection and history belong
// to the caller; this native textarea normally contains no committed text.
import { div } from "gpui-kit";
import { Textarea, TextareaState } from "gpui-base";
import { window as appWindow } from "herdr";

const CONTEXT = "HerdrEditorInput";
const PREFIX = "herdr-editor-input::";
const bindings = [];
for (const key of ["left", "right", "up", "down", "home", "end", "pageup", "pagedown"]) {
  bindings.push([key, `move-${key}`], [`shift-${key}`, `select-${key}`]);
}
bindings.push(["backspace", "delete-backward"], ["delete", "delete-forward"], ["enter", "enter"], ["shift-enter", "enter"], ["tab", "indent"], ["shift-tab", "outdent"]);
const keyBindings = entries => Object.freeze(entries.map(([keystroke, command]) => Object.freeze({ keystroke, action: PREFIX + command, context: `${CONTEXT} > Input` })));
export const EDITOR_INPUT_BINDINGS = keyBindings(bindings);
export function editorInputBindings(platform) {
  if (!["macos", "windows", "linux"].includes(platform)) return EDITOR_INPUT_BINDINGS;
  const mac = platform === "macos", modifier = mac ? "cmd" : "ctrl", word = mac ? "alt" : "ctrl";
  const entries = [...bindings,
    [`${modifier}-z`, "undo"], [`${modifier}-shift-z`, "redo"], [`${modifier}-a`, "select-all"],
    [`${modifier}-c`, "copy"], [`${modifier}-x`, "cut"],
    [`${word}-left`, "word-left"], [`${word}-right`, "word-right"], [`${word}-shift-left`, "select-word-left"], [`${word}-shift-right`, "select-word-right"],
    [`${word}-backspace`, "delete-word-backward"], [`${word}-delete`, "delete-word-forward"],
    [mac ? "cmd-up" : "ctrl-home", "move-doc-start"], [mac ? "cmd-down" : "ctrl-end", "move-doc-end"],
    [mac ? "cmd-shift-up" : "ctrl-shift-home", "select-doc-start"], [mac ? "cmd-shift-down" : "ctrl-shift-end", "select-doc-end"],
  ];
  if (mac) entries.push(["cmd-left", "move-home"], ["cmd-right", "move-end"], ["cmd-shift-left", "select-home"], ["cmd-shift-right", "select-end"], ["ctrl-a", "move-home"], ["ctrl-e", "move-end"]);
  else entries.push(["ctrl-y", "redo"]);
  return keyBindings(entries);
}
const installed = new Set();

export class EditorInput {
  init(cx, { onCommit, onCommand } = {}) {
    if (typeof onCommit !== "function" || typeof onCommand !== "function") throw new TypeError("EditorInput requires document commit and command callbacks.");
    this.alive = true; this.resetting = false; this.onCommit = onCommit; this.onCommand = onCommand;
    const platform = appWindow()?.platform;
    this.bindings = editorInputBindings(platform);
    this.focusHandle = cx.focus_handle();
    this.state = TextareaState.new({ value: "", rows: 1 });
    this.state.set_rows(1); this.state.set_auto_grow(1, 1); this.state.set_soft_wrap(false);
    this.state.on("change", (_event, eventCx) => {
      if (!this.alive || this.resetting) return;
      const text = this.state.value();
      if (!text) return;
      // The public native API has no marked-range getter. This relies only on
      // Change being a commit event; preedit must never be reset by a key hook.
      if (this.onCommit?.(text, eventCx) === false || !this.alive) return;
      this.resetting = true;
      try { this.state.set_value(""); }
      finally { this.resetting = false; }
      eventCx.notify();
    });
    if (!installed.has(platform)) { cx.bind_keys(this.bindings); installed.add(platform); }
  }
  pendingText() { return this.alive ? this.state.value() : ""; }
  pending() { return this.pendingText().length > 0; }
  focus() { if (this.alive) this.state.focus(); }
  release() { if (!this.alive) return; this.alive = false; this.state.release(); this.focusHandle.release(); this.onCommit = null; this.onCommand = null; }
  render(_cx, { id = "editor-input", font = "monospace", size = 13, width = 2, height = 24, inline = false, viewportWidth = 0 } = {}) {
    const pending = this.pendingText(), measurementKey = JSON.stringify([font, size, height, pending]);
    if (inline) {
      this.measurementKey = measurementKey;
      width = !pending ? 2 : this.measurement?.key === measurementKey ? this.measurement.width + 2 : Math.max(width, size * Array.from(pending).length + 2);
    } else this.measurementKey = null;
    // A key-up redraw lets the wrapper stop advertising the document context
    // while native marked text is visible. pending() remains conservative.
    let root = div().id(id).w(width).h(height).flex_none().min_w(0).min_h(0).p(0).border(0).rounded(0).bg("#00000000").font_family(font).text_size(size).line_height(`${height}px`)
      .track_focus(this.focusHandle).key_context(pending ? "HerdrEditorPreedit" : CONTEXT)
      .on_key_up((_event, eventCx) => eventCx.notify());
    for (const command of new Set(this.bindings.map(binding => binding.action))) root = root.on_action(command, (_event, eventCx) => {
      if (!this.alive || this.pending()) { eventCx.propagate(); return; }
      eventCx.stop_propagation(); this.onCommand?.(command.slice(PREFIX.length), eventCx);
    });
    // Native TextElement reserves 10px to the right of the IME caret. Give
    // that viewport its clearance without inserting a gap into the document.
    // Otherwise cursor-follow scrolls part of the marked Hangul out of view.
    // Reserve the native viewport before the first marked-text event. Native
    // IME paints before the script's next render; growing a 2px viewport only
    // afterward visibly clips the first jamo even when the final width fits.
    const nativeWidth = inline ? Math.max(width + 12, viewportWidth, size * 16) : width + 12;
    root = root.child(Textarea.new(this.state).w(nativeWidth).h_full().flex_none().min_w(0).min_h(0).p(0).border(0).rounded(0).bg("#00000000").font_family(font).text_size(size).line_height(`${height}px`));
    if (inline && pending) root = root.relative().child(div().id(`${id}-measure`).absolute().left(-10000).top(0).w_auto().h(height).flex_none().p(0).border(0).opacity(0)
      .font_family(font).text_size(size).line_height(`${height}px`).whitespace_nowrap().child(pending)
      .on_size_change((measured, eventCx) => {
        if (!this.alive || this.measurementKey !== measurementKey || this.pendingText() !== pending || !Number.isFinite(measured.width) || measured.width <= 0) return;
        if (this.measurement?.key === measurementKey && this.measurement.width === measured.width) return;
        this.measurement = { key: measurementKey, width: measured.width };
        if (width !== measured.width + 2) eventCx.notify();
      }));
    return root;
  }
}

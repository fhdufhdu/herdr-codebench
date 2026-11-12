// Run: node --experimental-vm-modules design/idea/check_editor_input.mjs
// Executes the component unchanged. These tests model native event boundaries;
// they do not claim to synthesize OS IME/key dispatch in the native host.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const states = [], bindings = [], handles = [];
const element = () => {
  const node = { handlers: {}, styles: {}, children: [] };
  return new Proxy(node, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      if (name === "child") target.children.push(args[0]);
      else if (name.startsWith("on_")) {
        if (name === "on_action") target.handlers[args[0]] = args[1];
        else target.handlers[name] = args.at(-1);
      } else target.styles[name] = args;
      return node.proxy;
    };
  } });
};
const makeElement = () => { const node = element(); node.proxy = node; return node; };
const cx = {
  notices: 0, stopped: 0, propagated: 0,
  notify() { this.notices++; }, stop_propagation() { this.stopped++; }, propagate() { this.propagated++; },
  bind_keys(list) { bindings.push(...list); return list.length; },
  focus_handle() { const handle = { released: false, release() { this.released = true; } }; handles.push(handle); return handle; },
};
const native = {
  new(options) {
    const state = { text: options.value, events: {}, resets: 0, released: false, focused: false,
      value() { assert.equal(this.released, false); return this.text; },
      set_value(value) { assert.equal(this.released, false); this.text = value; this.resets++; this.events.change?.({}, cx); },
      set_rows(rows) { this.rows = rows; }, set_auto_grow(min, max) { this.grow = [min, max]; }, set_soft_wrap(wrap) { this.wrap = wrap; },
      on(name, handler) { this.events[name] = handler; }, focus() { this.focused = true; }, release() { this.released = true; },
      preedit(text) { this.text = text; }, // Source evidence: marked text emits no Change.
      commit(text) { this.text = text; this.events.change({}, cx); },
    }; states.push(state); return state;
  },
};
const context = vm.createContext({ console });
const module = new vm.SourceTextModule(await readFile(new URL("../../mods/codenav/editor-input.js", import.meta.url), "utf8"), { context });
await module.link(id => {
  if (id === "gpui-kit") return new vm.SyntheticModule(["div"], function() { this.setExport("div", makeElement); }, { context });
  if (id === "herdr") return new vm.SyntheticModule(["window"], function() { this.setExport("window", () => ({ platform: "macos" })); }, { context });
  return new vm.SyntheticModule(["Textarea", "TextareaState"], function() { this.setExport("TextareaState", native); this.setExport("Textarea", { new: state => { const node = makeElement(); node.state = state; return node; } }); }, { context });
});
await module.evaluate();
const { EditorInput, EDITOR_INPUT_BINDINGS, editorInputBindings } = module.namespace;
const commandsFor = platform => new Map(editorInputBindings(platform).map(binding => [binding.keystroke, binding.action.replace("herdr-editor-input::", "")]));
const mac = commandsFor("macos"), windows = commandsFor("windows"), linux = commandsFor("linux");
assert.deepEqual([...commandsFor(undefined).keys()].sort(), [...EDITOR_INPUT_BINDINGS.map(binding => binding.keystroke)].sort(), "a headless window never guesses platform modifier semantics");
assert.equal(mac.get("cmd-a"), "select-all"); assert.equal(mac.get("ctrl-a"), "move-home"); assert.equal(mac.get("ctrl-e"), "move-end");
for (const chord of ["ctrl-k", "ctrl-c", "ctrl-x", "ctrl-s", "ctrl-z", "ctrl-y", "ctrl-left"]) assert.equal(mac.has(chord), false, `macOS ${chord} keeps its OS meaning`);
assert.equal(mac.get("cmd-left"), "move-home"); assert.equal(mac.get("cmd-right"), "move-end");
assert.equal(mac.get("cmd-up"), "move-doc-start"); assert.equal(mac.get("cmd-shift-down"), "select-doc-end"); assert.equal(mac.get("alt-left"), "word-left");
for (const bindings of [windows, linux]) {
  assert.equal(bindings.get("ctrl-a"), "select-all"); assert.equal(bindings.get("ctrl-z"), "undo"); assert.equal(bindings.get("ctrl-y"), "redo");
  assert.equal(bindings.get("ctrl-left"), "word-left"); assert.equal(bindings.get("ctrl-home"), "move-doc-start"); assert.equal(bindings.get("ctrl-shift-end"), "select-doc-end");
  assert.equal(bindings.has("cmd-a"), false); assert.equal(bindings.has("alt-left"), false);
}
assert.throws(() => new EditorInput().init(cx), /document commit and command callbacks/);
const commits = [], commands = [];
const input = new EditorInput(); input.init(cx, { onCommit: text => { commits.push(text); }, onCommand: command => commands.push(command) });
const state = states.at(-1);
assert.equal(state.rows, 1); assert.deepEqual(state.grow, [1, 1]); assert.equal(state.wrap, false);
assert.equal(input.pending(), false); input.focus(); assert.equal(state.focused, true);
assert.ok(bindings.length > 30); assert.equal(bindings.some(binding => !binding.context), false);
assert.equal(bindings.some(binding => /(?:^|-)v$/.test(binding.keystroke)), false, "paste stays native and commits as text");
assert.ok(bindings.every(binding => binding.context === "HerdrEditorInput > Input"));
assert.ok(Object.isFrozen(EDITOR_INPUT_BINDINGS));

let rendered = input.render(cx, { id: "one", font: "Fixture Mono", size: 16, width: 220, height: 28 });
assert.deepEqual(rendered.styles.key_context, ["HerdrEditorInput"]);
assert.deepEqual(rendered.styles.track_focus, [handles[0]]);
assert.deepEqual(rendered.styles.font_family, ["Fixture Mono"]);
for (const node of [rendered, rendered.children[0]]) {
  assert.deepEqual(node.styles.p, [0]); assert.deepEqual(node.styles.border, [0]); assert.deepEqual(node.styles.bg, ["#00000000"]);
  assert.deepEqual(node.styles.min_w, [0]); assert.deepEqual(node.styles.min_h, [0]); assert.deepEqual(node.styles.line_height, ["28px"], "a numeric line height is a font multiplier, not pixels");
}
assert.deepEqual(input.render(cx).styles.w, [2], "empty inline sink permits a two-pixel caret region");
assert.deepEqual(input.render(cx).children[0].styles.w, [14], "native caret clearance never clips the marked text or expands document spacing");
assert.equal(Object.hasOwn(rendered.handlers, "on_mouse_down"), false, "the sink never owns document pointer selection");
state.preedit("ㅎ"); assert.equal(input.pendingText(), "ㅎ"); assert.equal(commits.length, 0); assert.equal(state.resets, 0);
state.preedit("한"); state.preedit("한글"); assert.equal(commits.length, 0); assert.equal(state.resets, 0);
rendered.handlers["herdr-editor-input::move-left"]({}, cx);
assert.equal(cx.propagated, 1); assert.equal(commands.length, 0); assert.equal(state.text, "한글", "an action never resets marked native text");
rendered = input.render(cx, { width: 52 }); assert.deepEqual(rendered.styles.key_context, ["HerdrEditorPreedit"]); assert.deepEqual(rendered.styles.w, [52]); assert.equal(input.pendingText(), "한글");
let inline = input.render(cx, { inline: true, width: 2, font: "Fixture Mono", size: 16, height: 28 });
assert.deepEqual(inline.styles.w, [34], "before measuring, Hangul reserves a conservative size-based width");
assert.deepEqual(inline.children[0].styles.w, [256], "the native viewport is reserved before IME starts");
let measure = inline.children[1];
assert.deepEqual(measure.styles.font_family, ["Fixture Mono"]); assert.deepEqual(measure.styles.text_size, [16]); assert.deepEqual(measure.styles.line_height, ["28px"]);
assert.deepEqual(measure.styles.left, [-10000]); assert.deepEqual(measure.styles.opacity, [0]); assert.equal(measure.children[0], "한글");
const beforeMeasure = cx.notices; measure.handlers.on_size_change({ width: 31.5 }, cx); assert.equal(cx.notices, beforeMeasure + 1);
inline = input.render(cx, { inline: true, width: 2, font: "Fixture Mono", size: 16, height: 28 });
assert.deepEqual(inline.styles.w, [33.5]); assert.deepEqual(inline.children[0].styles.w, [256], "measuring the inline advance never shrinks the native IME viewport");
measure.handlers.on_size_change({ width: 31.5 }, cx); inline.children[1].handlers.on_size_change({ width: 31.5 }, cx);
assert.equal(cx.notices, beforeMeasure + 1, "unchanged glyph measurements never request another redraw");
const changedFont = input.render(cx, { inline: true, width: 2, font: "Other Font", size: 16, height: 28 });
assert.deepEqual(changedFont.styles.w, [34], "a different font never reuses the previous glyph width");
measure.handlers.on_size_change({ width: 90 }, cx); assert.equal(cx.notices, beforeMeasure + 1, "late measurements from an old font are ignored");
changedFont.children[1].handlers.on_size_change({ width: 46 }, cx);
assert.deepEqual(input.render(cx, { inline: true, width: 2, font: "Other Font", size: 16, height: 28 }).styles.w, [48]);
state.preedit("한글🙂");
changedFont.children[1].handlers.on_size_change({ width: 99 }, cx);
inline = input.render(cx, { inline: true, width: 2, font: "Other Font", size: 20, height: 30 });
assert.deepEqual(inline.styles.w, [62], "font size and pending text both invalidate the measurement");
measure = inline.children[1]; const beforeInvalid = cx.notices;
measure.handlers.on_size_change({ width: 0 }, cx); measure.handlers.on_size_change({ width: NaN }, cx); assert.equal(cx.notices, beforeInvalid);
measure.handlers.on_size_change({ width: 64 }, cx);
assert.deepEqual(input.render(cx, { inline: true, width: 2, font: "Other Font", size: 20, height: 30 }).styles.w, [66]);
const fixed = input.render(cx, { width: 52 }); assert.deepEqual(fixed.styles.w, [52]); assert.equal(fixed.children.length, 1, "fixed-width probes do not create an inline measuring node");
const beforeLate = cx.notices; measure.handlers.on_size_change({ width: 80 }, cx); assert.equal(cx.notices, beforeLate, "switching out of inline mode invalidates its pending callbacks");
state.commit("한글"); assert.deepEqual(commits, ["한글"]); assert.equal(state.text, ""); assert.equal(state.resets, 1);
const emptyInline = input.render(cx, { inline: true, width: 120 }); assert.deepEqual(emptyInline.styles.w, [2]); assert.equal(emptyInline.children.length, 1);
assert.deepEqual(input.render(cx, { inline: true, size: 16, viewportWidth: 900 }).children[0].styles.w, [900], "even an empty caret has its full native viewport before the first composition frame");
state.commit("🙂👨‍👩‍👧‍👦\r\n둘째 줄\t끝"); assert.equal(commits[1], "🙂👨‍👩‍👧‍👦\r\n둘째 줄\t끝", "committed Unicode and multiline paste are forwarded without normalization");
assert.equal(state.resets, 2); assert.equal(input.pending(), false);
rendered = input.render(cx);
for (const command of ["move-left", "select-right", "delete-backward", "delete-forward", "enter", "undo", "redo", "select-all", "copy", "cut", "word-left"])
  rendered.handlers["herdr-editor-input::" + command]({}, cx);
assert.deepEqual(commands, ["move-left", "select-right", "delete-backward", "delete-forward", "enter", "undo", "redo", "select-all", "copy", "cut", "word-left"]);
assert.equal(mac.has("cmd-s"), false, "Save follows the configured app keymap rather than an unconditional native binding");
assert.equal(state.resets, 2, "document commands do not mutate the native text buffer");
assert.equal(state.text, "");
const redraws = cx.notices; rendered.handlers.on_key_up({}, cx); assert.equal(cx.notices, redraws + 1);
const second = new EditorInput(); second.init(cx, { onCommit() {}, onCommand() {} });
assert.equal(bindings.length, editorInputBindings("macos").length, "same-module instances do not repeatedly bind application keys");
second.release();

const declined = new EditorInput(); declined.init(cx, { onCommit: () => false, onCommand() {} });
const declinedState = states.at(-1); declinedState.commit("보존"); assert.equal(declined.pendingText(), "보존"); assert.equal(declinedState.resets, 0); declined.release();
const failed = new EditorInput(); failed.init(cx, { onCommit: () => { throw new Error("document rejected mutation"); }, onCommand() {} });
const failedState = states.at(-1); assert.throws(() => failedState.commit("유실 금지"), /document rejected/); assert.equal(failedState.text, "유실 금지"); assert.equal(failedState.resets, 0); failed.release();
const closeOnCommit = new EditorInput(); closeOnCommit.init(cx, { onCommit: () => closeOnCommit.release(), onCommand() {} });
states.at(-1).commit("닫기"); assert.equal(closeOnCommit.pendingText(), "");
input.release(); input.release(); assert.equal(input.pending(), false); assert.equal(state.released, true);
assert.ok(handles.every(handle => handle.released));
console.log("PASS editor input Unicode/multiline commits, native preedit preservation, guarded reset, scoped commands, pointer ownership and handle cleanup");
console.log("UNVERIFIED native OS marked-text events, command-vs-Input precedence, pending native fallback, IME candidate positioning and unmark-only commits; parent UI probe required");

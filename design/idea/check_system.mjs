// Contract checks for the shared system. GPUI layout still needs an app check.
// node --experimental-vm-modules design/idea/check_system.mjs
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const canonicalTokens = JSON.parse(await readFile(new URL("design/idea/tokens.json", root), "utf8"));
const store = { layout: "idea" };
const context = vm.createContext({ console });
let inItemRenderer = false;
const builtElements = [];
class Element {
  constructor() {
    this.calls = [];
    const proxy = new Proxy(this, { get: (object, name) => name in object ? object[name] : (...args) => {
      assert.ok(!inItemRenderer || !String(name).startsWith("on_"), `handler ${String(name)} registered inside virtual renderer`);
      object.calls.push([name, ...args]); return proxy;
    } });
    builtElements.push(proxy);
    return proxy;
  }
}
const element = () => new Element();
const virtualList = (id, count, sizes, getKey, render) => {
  const list = element();
  assert.equal(Array.isArray(sizes) ? sizes.length : count, count);
  inItemRenderer = true;
  try { render({ start: 0, end: count }); } finally { inItemRenderer = false; }
  list.calls.push(["virtual_list", id, count, getKey]);
  return list;
};
const scrolls = [];
const synthetic = (id, values) => new vm.SyntheticModule(Object.keys(values), function () {
  for (const [key, value] of Object.entries(values)) this.setExport(key, value);
}, { context, identifier: id });
const mocks = {
  "gpui-kit": synthetic("gpui-kit", { div: element, image: element, PathBuilder: { stroke: width => element().stroke(width) } }),
  "gpui-base": synthetic("gpui-base", { h_flex: element, v_flex: element, v_virtual_list: virtualList,
    Button: { new: id => element().id(id).native_button() },
    Scrollbar: { vertical: element }, HoverCard: { new: id => element().id(id) },
    TextView: { html: (id, html) => element().id(id).html(html) },
    VirtualListScrollHandle: { new: () => ({ scroll_to_item: (...args) => scrolls.push(args), release() {} }) } }),
  herdr: synthetic("herdr", { shared: key => store[key], setShared: (key,value) => { store[key] = value; }, notify: () => {}, playSound: () => {}, openOverlay: () => "ghost", closeOverlay: () => {}, settings: () => ({}), theme: () => ({ foreground: "#fff", surface: "#111", ansi2: "#2", ansi4: "#4", ansi1: "#1" }) }),
  "./idea-tokens.js": synthetic("canonical-tokens", { IDEA_TOKENS: canonicalTokens }),
};
const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const module = new vm.SourceTextModule(await readFile(url, "utf8"), { context, identifier: url.href });
  modules.set(url.href, module);
  await module.link((id, parent) => mocks[id] ?? load(new URL(id === "./idea-tokens.js" && parent.identifier.endsWith("/ui.js") ? "../../mods/codenav/idea-tokens.js" : id, parent.identifier)));
  await module.evaluate();
  return module;
}
const ui = (await load(new URL("design/idea/ui.js", root))).namespace;
context.window = { paint_path: (path, color) => element().paint_path(path, color) };
const ux = canonicalTokens['herdr.ux'];
const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
for (const background of ['canvas', 'editor', 'surface', 'popup', 'hover', 'selection', 'selectionInactive', 'tabSelected']) {
  for (const text of ['foreground', 'secondary']) assert.ok(contrast(ux.colors[text], ux.colors[background]) >= 4.5, `${text} on ${background} needs text contrast`);
}
for (const background of ['editor', 'surface', 'popup']) {
  for (const control of ['border', 'focus']) assert.ok(contrast(ux.colors[control], ux.colors[background]) >= 3, `${control} on ${background} needs control contrast`);
}
for (const color of Object.values(ux.syntax)) assert.ok(contrast(color, ux.colors.editor) >= 4.5, `syntax ${color} needs text contrast`);
assert.ok(contrast(ux.colors.onPrimary, ux.colors.primary) >= 4.5, 'primary button label needs text contrast');
assert.ok(contrast(ux.colors.selectionForeground, ux.colors.selection) >= 4.5, 'selected label needs text contrast');
const applicationTheme = JSON.parse(await readFile(new URL('themes/idea.json', root), 'utf8'));
assert.equal(applicationTheme.colors.solid, ux.colors.primary);
assert.equal(applicationTheme.colors.accent, ux.colors.accent);
const nativeButton = ui.uiButton('contract-button', 'Activate', () => {});
assert.ok(nativeButton.calls.some(([name]) => name === 'native_button'));
assert.equal(nativeButton.calls.find(([name]) => name === 'accessibility_label')[1], 'Activate');
assert.equal(nativeButton.calls.find(([name]) => name === 'disabled')[1], false);
const focusStyle = element();
nativeButton.calls.find(([name]) => name === 'focus')[1](focusStyle);
assert.equal(focusStyle.calls.find(([name]) => name === 'border_color')[1], ux.colors.focus);
assert.ok(!focusStyle.calls.some(([name]) => ['border', 'border_1', 'w', 'h', 'size'].includes(name)), 'focus changes color inside reserved border space');
for (const control of [ui.uiButton('disabled-button', 'Unavailable', () => assert.fail(), { disabled: true }),
  ui.uiIconButton('disabled-icon', element(), () => assert.fail(), { tip: 'Unavailable icon', disabled: true, size: 18 }),
  ui.uiStripeButton('disabled-stripe', element(), () => assert.fail(), { tip: 'Unavailable tool', disabled: true })]) {
  assert.ok(control.calls.some(([name]) => name === 'native_button'));
  assert.equal(control.calls.find(([name]) => name === 'disabled')[1], true);
  assert.ok(control.calls.some(([name]) => name === 'accessibility_label'));
  assert.ok(!control.calls.some(([name]) => name === 'on_click'), 'disabled native buttons register no activation callback');
}
const iconTarget = ui.uiIconButton('small-icon', element(), () => {}, { size: 18, tip: 'Close' });
assert.equal(iconTarget.calls.find(([name]) => name === 'size')[1], 24, 'small glyphs keep a minimum 24px hit area');
for (const focused of [false, true]) assert.equal(ui.uiInputBox(element(), { focused }).calls.find(([name]) => name === 'border')[1], 2, 'input reserves focus border width');
const primaryButton = ui.uiButton('primary', 'Apply', () => {}, { primary: true });
assert.equal(primaryButton.calls.find(([name]) => name === 'bg')[1], ux.colors.primary);
assert.equal(primaryButton.calls.find(([name]) => name === 'text_color')[1], ux.colors.onPrimary);
const modeChanges = [];
const modeControl = ui.uiModeSwitch('contract-mode', [{ id: 'source', label: 'Source' }, { id: 'preview', label: 'Preview' }], 'source',
  (value, event, eventCx) => modeChanges.push([value, event, eventCx]));
const modeButtons = modeControl.calls.find(([name]) => name === 'children')[1];
let modePropagation = 0;
const modeCx = { stop_propagation() { modePropagation++; } };
const modeEvent = {};
for (const [index, button] of modeButtons.entries()) {
  assert.ok(button.calls.some(([name]) => name === 'native_button'), 'mode choices use native keyboard activation');
  assert.equal(button.calls.find(([name]) => name === 'selected')[1], index === 0);
  assert.equal(button.calls.find(([name]) => name === 'accessibility_label')[1], index === 0 ? 'Source' : 'Preview');
  assert.ok(button.calls.find(([name]) => name === 'h')[1] >= 24);
  assert.ok(button.calls.find(([name]) => name === 'min_w')[1] >= 24);
  assert.ok(!button.calls.some(([name]) => ['role', 'aria_selected', 'on_key_down'].includes(name)), 'native mode buttons do not claim tab semantics or add a second keyboard handler');
  const focusedStyle = element(); button.calls.find(([name]) => name === 'focus')[1](focusedStyle);
  assert.deepEqual(focusedStyle.calls.map(([name]) => name), ['border_color'], 'mode focus stays inside the reserved border');
  button.calls.find(([name]) => name === 'on_click')[1](modeEvent, modeCx);
}
assert.equal(modeChanges.length, 1, 'activating the current mode is a no-op');
assert.equal(modeChanges[0][0], 'preview'); assert.equal(modeChanges[0][1], modeEvent); assert.equal(modeChanges[0][2], modeCx);
assert.equal(modePropagation, 2);
assert.equal(modeButtons[0].calls.find(([name]) => name === 'border_color')[1], ux.colors.accent, 'selection uses a visible outline in addition to fill');
assert.equal(modeButtons[0].calls.find(([name]) => name === 'bg')[1], ux.colors.selection);
const sourceTranslations = (await load(new URL('mods/codenav/i18n.js', root))).namespace;
const editorTranslations = (await load(new URL('mods/activity/i18n.js', root))).namespace;
store['codenav.lang'] = 'ko';
assert.deepEqual(['Source', 'Preview'].map(sourceTranslations.T), ['원문', '미리보기']);
assert.deepEqual(['Edit', 'Preview'].map(editorTranslations.T), ['편집', '미리보기']);
delete store['codenav.lang'];
assert.equal(ui.IDEA.rowHeight, ux.metrics.rowHeight.compact);
assert.equal(ui.IDEA.islandRadius, ux.metrics.islandRadius);
assert.equal(ui.uiColors().surface, ux.colors.surface);
assert.equal(ui.IDEA.editorChangeMarkerWidth, 4);
assert.equal(ui.IDEA.editorChangeMarkerRadius, 2);
assert.equal(ui.uiColors().lineAdded, ux.colors.lineAdded);
assert.equal(ui.uiColors().lineModified, ux.colors.lineModified);
assert.equal(ui.uiColors().lineDeleted, ux.colors.lineDeleted);
assert.equal(ui.uiDiagnosticColors(1).effect, ux.colors.error);
assert.equal(ui.uiDiagnosticColors(2).stripe, ux.colors.warning);
assert.equal(ui.uiDiagnosticColors(3).stripe, null, "informational messages do not invent a warning stripe");
assert.notEqual(ui.uiDiagnosticColors(1).stripe, canonicalTokens['editor.attributes'].BREAKPOINT_ATTRIBUTES.ERROR_STRIPE_COLOR);
const decorated = ui.uiDiagnosticUnderline(element().text_color("#syntax"), { width: 17, offset: 1.5, severity: 2 });
assert.equal(decorated.calls.find(([name]) => name === "text_color")[1], "#syntax", "diagnostic decoration preserves syntax text colors");
assert.ok(!decorated.calls.some(([name]) => name === "border_b" || name === "h" || name === "w"), "wave does not change text layout");
const wave = decorated.calls.find(([name]) => name === "child")[1];
assert.equal(wave.calls.find(([name]) => name === "paint_path")[2], ui.uiDiagnosticColors(2).effect);
assert.equal(wave.calls.find(([name]) => name === "w")[1], 17);
const compositeButton = ui.uiButton("composite", element(), () => {}, { accessibilityLabel: "Run" });
assert.equal(compositeButton.calls.find(([name]) => name === "accessibility_label")[1], "Run", "composite content has a plain accessible label");
const diagnosticCard = ui.uiDiagnosticCard("diagnostic-card", [{ source: "ts", code: "2322", message: "Type mismatch" }], { path: "sample.ts" });
const overload = { source: "typescript", code: 2769, message: "\r\nNo overload matches this call.\r\n  Overload 1: <T>\n    Expected 'string'.\u2028  Overload 2: Detail" };
assert.equal(ui.uiDiagnosticLabel(overload, { summary: true }), "typescript - 2769: No overload matches this call.");
assert.ok(ui.uiDiagnosticLabel(overload).endsWith(overload.message), "full hover/copy content retains every original diagnostic line");
assert.equal(ui.uiDiagnosticLabel({ source: "ts\nserver", code: 0, message: "Type\tmessage" }, { summary: true }), "ts server - 0: Type message");
const selectable = ui.uiSelectableText("selectable-diagnostic", "<T> & 'string'\nline 2");
assert.equal(selectable.calls.find(([name]) => name === "child")[1].calls.find(([name]) => name === "html")[1], "&lt;T&gt; &amp; &#39;string&#39;<br>line 2", "type syntax is rendered literally, never as markup");
assert.equal(selectable.calls.find(([name]) => name === "child")[1].calls.find(([name]) => name === "selectable")[1], true, "native text selection enables drag/copy");
let selectionEventsStopped = 0;
const selectionCx = { stop_propagation() { selectionEventsStopped++; } };
selectable.calls.find(([name]) => name === "on_mouse_down")[2]({}, selectionCx);
selectable.calls.find(([name]) => name === "on_click")[1]({ click_count: 2 }, selectionCx);
assert.equal(selectionEventsStopped, 2, "text selection keeps its native focus and cannot activate an ancestor Problems row");
assert.equal(diagnosticCard.calls.find(([name]) => name === "bg")[1], ux.colors.popup);
assert.equal(diagnosticCard.calls.find(([name]) => name === "border_color")[1], ux.colors.border);
assert.ok(diagnosticCard.calls.find(([name]) => name === "h")[1] > 38, "card reserves definite space for both message and path");
assert.equal(ui.uiDiagnosticCard("long-diagnostic", [{ message: "Long diagnostic ".repeat(300) }]).calls.find(([name]) => name === "h")[1], 320, "long cards are bounded and scroll their message body");
const diagnosticHover = ui.uiDiagnosticTooltip("diagnostic-hover", element(), [{ message: "Type mismatch" }]);
assert.equal(diagnosticHover.calls.find(([name]) => name === "open_delay")[1], 500);
assert.ok(!diagnosticHover.calls.some(([name]) => name === "on_click" || name === "track_focus"), "hover card does not take selection or focus");
store["codenav.appearance"] = { compact: false, uiSize: 16 };
assert.equal(ui.IDEA.rowHeight, ux.metrics.rowHeight.normal);
assert.equal(ui.IDEA.islandRadius, ux.metrics.islandRadius);
assert.equal(ui.uiSize(), 16);
store.layout = "codebench";
assert.equal(ui.isCompact(), false);
assert.equal(ui.uiSize(), 13);
assert.equal(ui.uiColors().surface, "#111");
assert.deepEqual([ui.uiColors().lineAdded, ui.uiColors().lineModified, ui.uiColors().lineDeleted], ['#2', '#4', '#1']);
assert.ok(!ui.uiButton('codebench-button', 'Action', () => {}).calls.some(([name]) => name === 'native_button'), 'codebench retains its existing activation primitive');
store.layout = "idea";
delete store["codenav.appearance"];

const viewport = new ui.TabViewport();
viewport.width = 350;
for (const id of ["a", "b", "c", "d"]) viewport.widths.set(id, 180);
assert.equal(viewport.place(["a", "b", "c", "d"], "d"), 370, "the last active tab is fully revealed");
assert.equal(viewport.place(["a", "b", "c", "d"], "a"), 0, "switching back reveals the first tab");
viewport.scroll(-150);
assert.equal(viewport.place(["a", "b", "c", "d"], "a"), 150, "ordinary redraw preserves manual scrolling");
viewport.width = 200;
assert.equal(viewport.place(["a", "b", "c", "d"], "d"), 520, "resizing keeps the active tab visible");
assert.equal(viewport.place(["a"], "a"), 0, "closing tabs clamps the offset");

let chosen = 0, closed = 0, notifications = 0;
const cx = { focus_handle: () => ({ focus() {} }), notify: () => notifications++, stop_propagation() {} };
const menu = new ui.MenuController(cx);
const rows = [{ disabled: true }, { separator: true }, { id: "a", shortcut: "1", action: () => chosen++ }, { disabled: true }, { id: "b", shortcut: "2", action: () => chosen += 10 }];
const key = k => menu.key({ key: k }, cx, rows, { onClose: () => closed++ });
key("down"); assert.equal(menu.at, 4);
key("up"); assert.equal(menu.at, 2);
key("end"); assert.equal(menu.at, 4);
key("home"); assert.equal(menu.at, 2);
key("2"); assert.equal(chosen, 10); assert.equal(closed, 1);
key("escape"); assert.equal(closed, 2);
assert.ok(scrolls.length >= 4);
const grouped = new ui.MenuController(cx);
const groupedRows = [{ id: "heading-a", heading: true }, { id: "one" }, { id: "heading-b", heading: true }, { id: "two" }];
grouped.normalize(groupedRows); assert.equal(grouped.at, 1);
grouped.key({ key: "down" }, cx, groupedRows); assert.equal(grouped.at, 3);
grouped.key({ key: "home" }, cx, groupedRows); assert.equal(grouped.at, 1);
grouped.select(0, groupedRows, cx); assert.equal(grouped.at, 1);
grouped.release();
const empty = new ui.MenuController(cx);
empty.key({ key: "down" }, cx, [], {});
assert.equal(empty.at, -1);
empty.key({ key: "enter" }, cx, [], {});
// The GPUI bridge executes item renderers in layout, where handlers throw.
rows[4].icon = () => { assert.ok(inItemRenderer, "native icons must be created inside the deferred row renderer"); return element(); };
assert.throws(() => ui.uiMenu("invalid-icon", [{ icon: element() }], menu, cx), /icons must be factories/);
const standaloneMenu = ui.uiMenu("contract-menu", rows, menu, cx, { onClose: () => closed++ });
assert.ok(standaloneMenu.calls.some(([name]) => name === "border_1"), "standalone menu owns its popup frame");
const embeddedMenu = ui.uiMenu("embedded-contract", [{ id: "current", label: "Current project", current: true, tip: "remote:/long/path" }, ...rows], menu, cx,
  { embedded: true, width: 398, maxHeight: 200, onClose: () => closed++ });
assert.ok(!embeddedMenu.calls.some(([name]) => ["border_1", "rounded", "bg"].includes(name)), "embedded menu leaves surface ownership to its parent");
assert.equal(embeddedMenu.calls.find(([name]) => name === "w")[1], 398);
assert.ok(embeddedMenu.calls.find(([name]) => name === "h")[1] <= 200);
const menuList = builtElements.find(el => el.calls.some(call => call[0] === "virtual_list" && call[1] === "contract-menu-list"));
const itemClick = menuList.calls.find(call => call[0] === "on_item_click")[1];
const beforeClick = chosen;
itemClick("b", cx);
assert.equal(chosen, beforeClick + 10, "item click activates the stable row identity");
itemClick("contract-menu-separator-1", cx);
assert.equal(chosen, beforeClick + 10, "separator is not actionable");
menu.release(); menu.release(); empty.release();

// Geometry migrations must preserve user arrangement and terminal payloads.
const { find } = (await load(new URL("mods/codenav/layout-tree.js", root))).namespace;
const first = { id: "duplicate" }, second = { id: "duplicate" };
const lookupTree = { id: "root", children: [{ id: "branch", children: [first] }, second] };
assert.equal(find(lookupTree, "root"), lookupTree, "the current node wins before its children");
assert.equal(find(lookupTree, "duplicate"), first, "depth-first lookup returns the first match, not a later sibling");
assert.equal(find(lookupTree, "missing"), null);
assert.equal(find(null, "missing"), null);
assert.equal(find({ id: "leaf" }, "missing"), null, "leaves need no children array");
const shortCircuit = { id: "root", children: [first, { get id() { assert.fail("a later branch must not be visited after a match"); } }] };
assert.equal(find(shortCircuit, "duplicate"), first);
const islands = (await load(new URL("mods/codenav/islands.js", root))).namespace;
const tree = JSON.parse(await readFile(new URL("layouts/idea.json", root), "utf8"));
const collect = (node, map = new Map()) => { map.set(node.id, node); for (const child of node.children ?? []) collect(child, map); return map; };
const before = collect(structuredClone(tree));
assert.ok(islands.ensureIdeaIslands(tree) || before.get("root").gap === 0);
assert.equal(islands.ensureIdeaIslands(tree), false, "migration is idempotent");
const closedSlots = structuredClone(tree);
for (const id of ["left-main", "left-aux", "right-main", "right-aux"]) find(closedSlots, id).hidden = true;
for (const id of ["sidebar", "tool-right"]) find(closedSlots, id).hidden = false;
const expectedClosed = structuredClone(closedSlots);
for (const id of ["sidebar", "tool-right"]) find(expectedClosed, id).hidden = true;
assert.equal(islands.ensureIdeaIslands(closedSlots), true, "island migration repairs stale empty side columns");
assert.deepEqual(closedSlots, expectedClosed, "closing empty sides preserves all sizes, children, active state and payloads");
assert.equal(islands.ensureIdeaIslands(closedSlots), false, "empty-side repair is idempotent");
const after = collect(tree);
for (const [id, previous] of before) {
  const next = after.get(id); assert.ok(next, id);
  for (const key of ["active", "hidden", "type"]) assert.deepEqual(next[key], previous[key], `${id}.${key}`);
  if (!id.startsWith("island-") && !["editor-tabs", "left-bar", "left2-bar", "right-bar", "right2-bar", "bottom-bar", "main-toolbar", "status-row", "stripe", "stripe-right"].includes(id)) assert.deepEqual(next.size, previous.size, `${id}.size`);
  if (previous.children) {
    const mainId = id === "sidebar" ? "left-main" : "right-main";
    const holder = ["sidebar", "tool-right"].includes(id) && !previous.children.some(child=>child.id===mainId) ? after.get(mainId) : next;
    assert.deepEqual(holder.children.filter(n => !n.id.startsWith("island-")).map(n => n.id), previous.children.filter(n => !n.id.startsWith("island-")).map(n => n.id), `${id}.children`);
  }
}
for (const id of ["root", "body", "idea-content", "idea-upper", "work-body"]) assert.equal(after.get(id).gap, 0);
for (const id of ["idea-upper", "idea-content", "sidebar", "tool-right"]) {
  assert.equal(after.get(id).resizable, true, `${id}: tool split permits native resizing`);
  assert.ok(after.get(id).divider.width >= ui.IDEA.splitterWidth, `${id}: a real rail contains the native drag handle`);
}
for (const id of ["root", "body", "work-body"]) assert.deepEqual(after.get(id).divider, before.get(id).divider, `${id}: no stripe/status/header gutter is introduced`);
const customRail = structuredClone(tree);
find(customRail, "sidebar").resizable = false;
find(customRail, "sidebar").divider = { width: 9, color: "custom", future: true };
const retainedSizes = new Map([...collect(customRail)].map(([id, node]) => [id, JSON.stringify([node.size, node.min, node.max, node.active, node.hidden, node.content])]));
assert.equal(islands.ensureIdeaIslands(customRail), true);
assert.deepEqual(find(customRail, "sidebar").divider, { width: 9, color: "custom", future: true });
for (const [id, node] of collect(customRail)) assert.equal(JSON.stringify([node.size, node.min, node.max, node.active, node.hidden, node.content]), retainedSizes.get(id), `${id}: rail repair preserves panel state and terminal payload`);
assert.equal(islands.ensureIdeaIslands(customRail), false, "splitter repair is idempotent");
assert.deepEqual(Array.from(after.get('body').children,node=>node.id),['stripe','idea-content','stripe-right']);
assert.deepEqual(Array.from(after.get('idea-content').children,node=>node.id),['idea-upper','terminal-panel']);
assert.deepEqual(Array.from(after.get('idea-upper').children,node=>node.id),['sidebar','work-body','tool-right']);
for (const id of ['idea-content','idea-upper']) assert.deepEqual(Array.from(after.get(id).padding),[0,0]);
for (const id of ["left-main", "left-aux", "right-main", "right-aux", "terminal-panel", "editor-area"]) assert.deepEqual(Array.from(after.get(id).padding), [ui.IDEA.islandGap / 2, ui.IDEA.islandGap / 2]);
for (const id of ["sidebar", "tool-right"]) assert.deepEqual(Array.from(after.get(id).padding), [0,0]);
for (const built of builtElements.filter(el => el.calls.some(([name]) => name === "virtual_list"))) {
  assert.ok(built.calls.some(([name]) => name === "size_full") || ["w", "h"].every(axis => built.calls.some(([name, value]) => name === axis && Number.isFinite(value) && value > 0)), "virtual lists need definite width and height");
}
const stripe = ui.uiStripeButton("stripe", element(), () => {}, { active: true });
let spinnerFactories = 0;
const makeSpinner = () => { spinnerFactories++; return element(); };
const progress = ui.uiSpinner(makeSpinner, { size: 12 });
assert.equal(spinnerFactories, 1, 'each spinner obtains its own native SVG');
assert.equal(progress.calls.find(([name]) => name === 'spin')[1], 1000, 'IDEA eight125ms frames share a1000ms native cycle');
assert.equal(progress.calls.find(([name]) => name === 'text_color')[1], ui.uiColors().secondary, 'working indicator uses neutral IDEA chrome color');
assert.equal(stripe.calls.find(([name]) => name === "w")[1], ux.metrics.stripeButtonWidth.compact);
const fill = stripe.calls.find(([name]) => name === "child")[1];
assert.equal(fill.calls.find(([name]) => name === "w")[1], ux.metrics.stripeButtonWidth.compact - 4, "selection remains inside the hit area");
for (const compact of [true, false]) {
  store['codenav.appearance'] = { compact };
  for (const [name, metric] of Object.entries(ux.metrics)) {
    assert.equal(ui.IDEA[name], typeof metric === 'number' ? metric : compact ? metric.compact : metric.normal, `${name} uses the current canonical density`);
  }
  for (const side of ['left', 'right']) {
    const button = ui.uiStripeButton(`stripe-${side}`, element(), () => {}, { active: true, side });
    const inside = button.calls.find(([name]) => name === 'child')[1];
    const width = button.calls.find(([name]) => name === 'w')[1], fillWidth = inside.calls.find(([name]) => name === 'w')[1];
    const offset = inside.calls.find(([name]) => name === 'left')[1];
    assert.equal(width, ui.IDEA.stripeButtonWidth, 'hit width remains the existing density size');
    assert.equal(offset, (side === 'left' ? 1 : -1) * ui.IDEA.islandGap / 4);
    const start = (ui.IDEA.stripeWidth - fillWidth) / 2 + offset;
    const end = ui.IDEA.stripeWidth - start - fillWidth;
    const outer = side === 'left' ? start : end;
    const inner = (side === 'left' ? end : start) + ui.IDEA.islandGap / 2;
    assert.equal(inner, outer, 'visible inner shell+stripe margin matches outer stripe margin');
    assert.ok(Math.abs(offset) <= (width - fillWidth) / 2, 'fill remains inside the unchanged hit target');
  }
  const footer = ui.uiEditorFooter([element()]);
  assert.equal(footer.calls.find(([name]) => name === 'h')[1], ui.IDEA.editorBreadcrumbHeight);
  assert.equal(footer.calls.find(([name]) => name === 'bg')[1], ui.uiColors().editor);
  assert.ok(footer.calls.some(([name]) => name === 'justify_end'));
}
delete store['codenav.appearance'];
const disabledCheckbox = ui.uiCheckbox("disabled", "Disabled", () => assert.fail("disabled"), { disabled: true });
assert.ok(!disabledCheckbox.calls.some(([name]) => name === "on_click"));
console.log("PASS shared density, semantic colors, deferred menu icons, keyboard/scroll, stripe inset, layout preservation/idempotence");

// Optional explicit migration uses the same function as the live shell.
// No flag means read-only. Pass source and installed idea.json together.
if (process.argv[2] === "--migrate-layout") {
  for (const path of process.argv.slice(3)) {
    const current = JSON.parse(await readFile(path, "utf8"));
    assert.equal(current.theme, "idea", "only the idea layout may be migrated");
    if (islands.ensureIdeaIslands(current)) await writeFile(path, JSON.stringify(current, null, 2) + "\n");
    console.log(`Migrated chrome: ${path}`);
  }
}

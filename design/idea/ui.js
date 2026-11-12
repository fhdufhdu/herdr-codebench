// Canonical Codebench components; generate deployable copies with sync_ui.py.
import { div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Button, v_virtual_list, VirtualListScrollHandle, Scrollbar, HoverCard, TextView } from "gpui-base";
import { shared, setShared, settings, theme, notify as nativeNotify, playSound, openOverlay, closeOverlay } from "herdr";
import { IDEA_TOKENS } from "./idea-tokens.js";

export const isIdea = () => shared("layout") === "idea";
export const isCompact = () => isIdea() && shared("codenav.appearance")?.compact !== false;
const density = (normal, compact) => isCompact() ? compact : normal;
const metric = (name, normal, compact = normal) => Number(isCompact()
  ? IDEA_TOKENS["ui.metrics"]?.[`${name}.compact`] ?? compact
  : IDEA_TOKENS["ui.metrics"]?.[name] ?? normal);
const ux = IDEA_TOKENS["herdr.ux"];
const uxMetric = (name, fallback) => {
  if (!isIdea()) return fallback;
  const value = ux.metrics[name];
  return typeof value === "number" ? value : density(value.normal, value.compact);
};
const editorMetrics = IDEA_TOKENS["herdr.editor.metrics"];
export const IDEA = Object.freeze({
  get islandRadius() { return uxMetric("islandRadius", metric("Island.arc", 20, 16) / 2); },
  get islandGap() { return uxMetric("islandGap", metric("Island.borderWidth", 6, 4)); },
  get splitterWidth() { return uxMetric("splitterWidth", 6); },
  get popupRadius() { return uxMetric("popupRadius", 8); }, get dialogRadius() { return uxMetric("dialogRadius", 12); },
  get controlRadius() { return uxMetric("controlRadius", metric("Component.arc", 8, 6) / 2); },
  get selectionRadius() { return uxMetric("selectionRadius", 4); },
  get rowHeight() { return uxMetric("rowHeight", metric("List.rowHeight", 24, 22)); },
  get inputHeight() { return uxMetric("inputHeight", density(28, 24)); },
  get tabHeight() { return uxMetric("tabHeight", density(40, 32)); },
  get tabFillHeight() { return uxMetric("tabFillHeight", density(28, 24)); },
  get toolHeaderHeight() { return uxMetric("toolHeaderHeight", metric("ToolWindow.Header.height", 32, 31)); },
  get toolbarHeight() { return uxMetric("toolbarHeight", density(40, 32)); },
  get toolbarButtonSize() { return uxMetric("toolbarButtonSize", density(30, 26)); },
  get iconSize() { return uxMetric("iconSize", 16); }, get stripeIconSize() { return uxMetric("stripeIconSize", 16); },
  get stripeWidth() { return uxMetric("stripeWidth", density(40, 32)); },
  get stripeButtonWidth() { return uxMetric("stripeButtonWidth", density(37, 32)); },
  get stripeButtonHeight() { return uxMetric("stripeButtonHeight", density(40, 32)); },
  get statusHeight() { return uxMetric("statusHeight", 24); },
  get progressCycle() { return IDEA_TOKENS["herdr.progress"].cycleMs; },
  get editorBreadcrumbHeight() { return uxMetric("editorBreadcrumbHeight", density(editorMetrics.breadcrumbHeight.normal, editorMetrics.breadcrumbHeight.compact)); },
  get editorTextInset() { return uxMetric("editorTextInset", density(editorMetrics.textInset.normal, editorMetrics.textInset.compact)); },
  get editorGutterInset() { return editorMetrics.gutterInset; },
  get editorMarkerWidth() { return editorMetrics.markerWidth; },
  get editorChangeMarkerWidth() { return editorMetrics.changeMarkerWidth; },
  get editorChangeMarkerRadius() { return editorMetrics.changeMarkerRadius; },
});
export const uiSize = (base = 13) => isIdea() ? base * (Number(shared("codenav.appearance")?.uiSize) || 13) / 13 : base;
export const ideaUI = el => isIdea() ? el.font_family(shared("codenav.appearance")?.uiFont ?? settings().ui_font_family ?? IDEA_TOKENS.fonts?.fontFace ?? ".AppleSystemUIFont").text_size(uiSize()) : el;
export function uiColors() {
  const t = theme(), c = IDEA_TOKENS["ui.colors"] ?? {}, e = IDEA_TOKENS["editor.colors"] ?? {};
  const color = (name, fallback) => isIdea() ? c[name] ?? fallback : fallback;
  return {
    canvas: color("MainWindow.background", t.canvas ?? t.chrome),
    surface: color("ToolWindow.background", t.surface), popup: color("Popup.background", t.popover ?? t.surface),
    foreground: color("*.foreground", t.foreground), secondary: color("*.infoForeground", t.muted),
    disabled: color("*.disabledText", t.dim), border: color("Component.borderColor", t.input ?? t.border),
    separator: color("Separator.separatorColor", t.border), hover: color("*.hoverBackground", t.hover),
    selection: color("*.selectionBackground", t.selected), selectionInactive: color("*.selectionInactiveBackground", t.raised),
    selectionForeground: color("*.selectionForeground", t.foreground), tabSelected: color("EditorTabs.underlinedTabBackground", t.selected),
    focus: color("*.focusColor", t.accent), accent: color("Button.default.startBackground", t.accent),
    accentForeground: color("Button.default.foreground", t.solid_foreground ?? t.foreground), error: color("Component.errorFocusColor", t.ansi1),
    editor: isIdea() ? e.BACKGROUND ?? t.surface : t.surface,
    lineNumber: isIdea() ? e.LINE_NUMBERS_COLOR ?? t.dim : t.dim,
    currentLine: isIdea() ? e.CARET_ROW_COLOR ?? t.hover : t.hover,
    guide: isIdea() ? e.INDENT_GUIDE ?? t.border : t.border,
    lineAdded: isIdea() ? e.ADDED_LINES_COLOR ?? t.ansi2 : t.ansi2,
    lineModified: isIdea() ? e.MODIFIED_LINES_COLOR ?? t.ansi4 : t.ansi4,
    lineDeleted: isIdea() ? e.DELETED_LINES_COLOR ?? t.ansi1 : t.ansi1,
    primary: t.accent, onPrimary: t.solid_foreground ?? t.foreground,
    warning: t.ansi3, success: t.ansi2,
    ...(isIdea() ? ux.colors : {}),
  };
}
// Source viewer, native editor and diff use the same category palette.
export function uiEditorSyntax() {
  const t = theme();
  return isIdea() ? { ...ux.syntax } : { keyword: t.ansi5, type: t.ansi3, constant: t.ansi6, builtin: t.ansi6, function: t.ansi4,
    decorator: t.ansi3, namespace: t.foreground, property: t.ansi6, escape: t.ansi3,
    string: t.ansi2, number: t.ansi3, comment: t.dim, operator: t.foreground, punctuation: t.foreground };
}
// Severity owns the underline and overview stripe, independently of breakpoints.
export function uiDiagnosticColors(severity = 1) {
  const t = theme(), c = uiColors();
  const fallback = severity === 1 ? t.ansi1 : severity === 2 ? t.ansi3 : t.ansi4;
  const effect = severity === 1 ? c.error : severity === 2 ? c.warning : c.accent;
  return isIdea() ? {
    effect, stripe: severity === 1 || severity === 2 ? effect : null,
    background: c.popup, border: c.border,
  } : { effect: fallback, stripe: fallback, background: uiColors().popup, border: uiColors().border };
}

// A separate native path preserves syntax colors, line height and hit testing.
// Offset keeps the wave continuous across syntax-token boundaries.
export function uiDiagnosticUnderline(element, { width, offset = 0, severity = 1 }) {
  const length = Math.max(3, width), y = x => 0.5 + Math.abs(((x + offset) % 4) - 2);
  const path = PathBuilder.stroke(1).move_to(0, y(0));
  for (let x = 2 - offset % 2; x < length; x += 2) path.line_to(x, y(x));
  path.line_to(length, y(length));
  return element.relative().child(window.paint_path(path.build(), uiDiagnosticColors(severity).effect)
    .absolute().left(0).bottom(0).w(length).h(3));
}

export function uiDiagnosticLabel(diagnostic, { summary = false } = {}) {
  const message = String(diagnostic.message ?? "");
  const body = summary ? message.split(/\r\n|[\n\r\u2028\u2029]/u).find(line => line.trim()) ?? "" : message;
  const label = `${diagnostic.source ? diagnostic.source + " - " : ""}${diagnostic.code !== undefined && diagnostic.code !== null && diagnostic.code !== "" ? diagnostic.code + ": " : ""}${body}`;
  return summary ? label.replace(/\s+/gu, " ").trim() : label;
}

// Plain diagnostic text can contain type syntax or Markdown; escape it before
// using the native selectable rich-text view rather than interpreting it.
export function uiSelectableText(id, text) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const html = String(text).replace(/[&<>"']/g, character => entities[character]).replace(/\r\n|[\n\r\u2028\u2029]/gu, "<br>");
  // Keep native text focus/selection inside the label. A Problems row also
  // handles mouse-down/click; letting those bubble can focus the list or open
  // a file while the user is selecting diagnostic text.
  return div().id(`${id}-selection`).min_w(0).child(TextView.html(id, html).selectable(true).scrollable(false))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click((_event, cx) => cx.stop_propagation());
}

export function uiDiagnosticCard(id, diagnostics, { path = "", actions = [] } = {}) {
  const c = uiColors(), hint = uiDiagnosticColors();
  const messages = diagnostics.map(d => uiDiagnosticLabel(d));
  const rows = messages.reduce((count, message) => count + message.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 65)), 0), 0);
  const footer = path || actions.length ? Math.max(32, IDEA.inputHeight + 8, uiSize(12) + 16) : 0;
  const height = Math.min(320, 20 + rows * Math.max(18, uiSize() + 5) + Math.max(0, messages.length - 1) * 8 + footer);
  return ideaUI(v_flex()).id(id).role("tooltip").w(560).h(Math.max(38, height)).overflow_hidden()
    .bg(hint.background).text_color(c.foreground).border_1().border_color(hint.border).rounded(6)
    .child(v_flex().flex_1().min_h(0).px(12).py(10).gap(8).overflow_y_scrollbar().children(messages.map((message, index) =>
      uiSelectableText(`${id}-message-${index}`, message).flex_none().w_full().whitespace_normal().text_size(uiSize()))))
    .when(Boolean(footer), el => el.child(h_flex().flex_none().h(footer).px(10).gap(6).items_center().border_t(1).border_color(hint.border)
      .child(div().flex_1().min_w(0).text_size(uiSize(12)).text_color(c.secondary).overflow_hidden()
        .child(uiSelectableText(`${id}-path`, path).w_full().truncate().whitespace_nowrap()))
      .children(actions.map(action => uiButton(`${id}-${action.id}`, action.label, (event, cx) => { cx.stop_propagation(); action.action?.(event, cx); }, { small: true, disabled: action.disabled })))));
}

export function uiDiagnosticTooltip(id, trigger, diagnostics, options = {}) {
  return HoverCard.new(id).open_delay(500).close_delay(150).anchor("bottom_left")
    .trigger(trigger).content(uiDiagnosticCard(`${id}-card`, diagnostics, options));
}
export function popupSurface(el, dialog = false) {
  if (!isIdea()) return el;
  const c = uiColors();
  return ideaUI(el).bg(dialog ? c.surface : c.popup).rounded(dialog ? IDEA.dialogRadius : IDEA.popupRadius)
    .overflow_hidden().border_1().border_color(c.border);
}
export function uiButton(id, label, action, { primary = false, disabled = false, small = false, accessibilityLabel } = {}) {
  const c = uiColors();
  let el = ideaUI(isIdea() ? Button.new(id) : h_flex().id(id)).h(Math.max(IDEA.inputHeight, uiSize() + 10, 24)).flex_none().px(small ? 8 : 12)
    .flex().items_center().justify_center().rounded(IDEA.controlRadius).border_1().border_color(primary ? c.primary : c.border)
    .bg(primary ? c.primary : c.surface).text_color(disabled ? c.disabled : primary ? c.onPrimary : c.foreground).child(label);
  if (isIdea()) el = el.disabled(disabled).accessibility_label(accessibilityLabel ?? (typeof label === "string" ? label : id)).focus(s => s.border_color(c.focus));
  if (!disabled) el = el.cursor_pointer().hover(s => s.bg(primary ? c.primary : c.hover)).on_click(action);
  return el;
}
export function uiIconButton(id, graphic, action, { tip = "", active = false, disabled = false, size = IDEA.toolbarButtonSize } = {}) {
  const c = uiColors();
  let el = (isIdea() ? Button.new(id) : h_flex().id(id)).size(isIdea() ? Math.max(24, size) : size).flex_none().flex().items_center().justify_center().rounded(IDEA.controlRadius)
    .text_color(disabled ? c.disabled : c.foreground).bg(active ? c.selection : "#00000000").child(graphic);
  if (isIdea()) el = el.disabled(disabled).selected(active).accessibility_label(tip || id)
    .border_1().border_color("#00000000").focus(s => s.border_color(c.focus));
  if (tip) el = el.tooltip(tip);
  if (!disabled) el = el.cursor_pointer().hover(s => s.bg(c.hover)).on_click((event, cx) => { cx.stop_propagation(); action?.(event, cx); });
  return el;
}
export function uiModeSwitch(id, items, current, onChange) {
  const c = uiColors();
  return ideaUI(h_flex()).id(id).flex_none().items_center().gap(2).p(1)
    .rounded(IDEA.controlRadius).border_1().border_color(c.separator).bg(c.editor)
    .children(items.map(item => {
      const selected = item.id === current;
      return Button.new(`${id}-${item.id}`).selected(selected).accessibility_label(item.label)
        .h(Math.max(24, IDEA.inputHeight - 4, uiSize() + 8)).min_w(24).flex_none().flex().items_center().justify_center().px(8)
        .rounded(IDEA.selectionRadius).border_1().border_color(selected ? c.accent : "#00000000")
        .bg(selected ? c.selection : "#00000000").text_color(selected ? c.selectionForeground : c.secondary)
        .focus(el => el.border_color(c.focus)).hover(el => el.bg(selected ? c.selection : c.hover)).cursor_pointer()
        .on_click((event, cx) => { cx.stop_propagation(); if (!selected) onChange(item.id, event, cx); }).child(item.label);
    }));
}
// A fresh SVG factory keeps native elements owned by their current row. GPUI
// rotates only while drawn; no JavaScript timers or redraw loop are needed.
export function uiSpinner(graphic, { size = 16, tip = "" } = {}) {
  let el = graphic().size(size).flex_none().text_color(uiColors().secondary).spin(IDEA.progressCycle);
  if (tip) el = el.tooltip(tip);
  return el;
}
export function uiInputBox(input, { focused = false, error = false, mono = false } = {}) {
  const c = uiColors();
  let el = ideaUI(h_flex()).min_h(Math.max(IDEA.inputHeight, uiSize() + 8)).items_center().px(6).rounded(IDEA.controlRadius)
    .bg(c.surface).border(isIdea() ? 2 : focused || error ? 2 : 1).border_color(error ? c.error : focused ? c.focus : c.border).child(input);
  if (mono) el = el.font_family(IDEA_TOKENS.fonts?.FONT_FAMILY ?? "monospace");
  return el;
}
export function uiListRow(id, children, { selected = false, focused = true, disabled = false, onClick, interactive = Boolean(onClick), indent = 0 } = {}) {
  const c = uiColors();
  let el = ideaUI(h_flex()).id(id).aria_selected(selected).h(Math.max(IDEA.rowHeight, uiSize() + 8)).flex_none().min_w(0).items_center().gap(6)
    .pl(8 + indent).pr(8).rounded(IDEA.selectionRadius).bg(selected ? focused ? c.selection : c.selectionInactive : "#00000000")
    .text_color(disabled ? c.disabled : selected ? c.selectionForeground : c.foreground).children(Array.isArray(children) ? children : [children]);
  if (!disabled && interactive) el = el.cursor_pointer().hover(s => s.bg(selected ? c.selection : c.hover));
  if (!disabled && onClick) el = el.on_click(onClick);
  return el;
}
export const uiSeparator = () => div().h(1).my(4).mx(6).flex_none().bg(uiColors().separator);
export const uiCaption = text => ideaUI(div()).px(8).py(4).flex_none().text_size(uiSize(11)).text_color(uiColors().secondary).child(text);

export const NOTIFICATION_GROUPS = [
  { id: "codenav.general", label: "General", defaults: { popup: true, log: true, sound: true } },
  { id: "codenav.files", label: "File Operations", defaults: { popup: true, log: true, sound: true } },
  { id: "codenav.run", label: "Run", defaults: { popup: true, log: true, sound: true } },
  { id: "codenav.review", label: "Version Control", defaults: { popup: true, log: true, sound: true } },
  { id: "codenav.http", label: "HTTP Client", defaults: { popup: true, log: true, sound: true } },
  { id: "herdr.agents", label: "Agents", defaults: { popup: false, log: true, sound: false } },
];
export function notificationPolicy(group) {
  const defaults = NOTIFICATION_GROUPS.find(item => item.id === group)?.defaults ?? NOTIFICATION_GROUPS[0].defaults;
  return { ...defaults, ...(shared("codenav.notificationPolicy")?.groups?.[group] ?? {}) };
}
export function uiNotify(note) {
  if (!isIdea()) return nativeNotify(note);
  const group = note.group ?? "codenav.general", policy = notificationPolicy(group), now = Date.now();
  const recent = [...(shared("codenav.notifications") ?? []), ...(shared("codenav.noticeQueue") ?? [])];
  if (note.dedupeKey) {
    const duplicate = recent.find(item => item.group === group && item.dedupeKey === note.dedupeKey && now - item.at < 2000);
    if (duplicate) return duplicate.id;
  }
  const item = { ...note, group, id: `${now}-${Math.random()}`, at: now };
  if (policy.sound && settings().sounds?.enabled !== false && note.silent !== true) playSound(note.level === "error" || note.level === "warning" || note.level === "blocked" ? "blocked" : "done");
  if (policy.log) setShared("codenav.notifications", [item, ...(shared("codenav.notifications") ?? [])].slice(0, 100));
  if (policy.popup) setShared("codenav.noticeQueue", [...(shared("codenav.noticeQueue") ?? []), item].slice(-3));
  return item.id;
}
export function uiNoticeCard(id, note, { graphic, trailing, onClick } = {}) {
  const c = uiColors();
  return ideaUI(h_flex()).id(id).min_h(42).p(10).gap(8).items_start().rounded(7)
    .bg(isIdea() ? "#212325" : c.popup).text_color(c.foreground)
    .when(Boolean(onClick), el => el.cursor_pointer().on_click(onClick))
    .child(graphic ?? div().mt(3).size(12).rounded_full().bg(c.accent))
    .child(v_flex().flex_1().min_w(0).gap(10)
      .child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).child(note.title ?? "")).child(trailing ?? div()))
      .when(Boolean(note.body), el => el.child(div().child(note.body)))) ;
}
export function uiEmptyEditor(hints, footer) {
  const c = uiColors();
  return ideaUI(h_flex()).size_full().items_center().justify_center().bg(c.editor)
    .child(v_flex().id("empty-editor-hints").flex_none().gap(12).text_size(uiSize()).text_color(c.secondary)
      .children(hints.map(([label, shortcut]) => h_flex().gap(24).items_center()
        .child(div().flex_1().child(label)).child(div().flex_none().child(shortcut))))
      .when(Boolean(footer), el => el.child(div().mt(8).text_size(uiSize(12)).text_color(c.disabled).child(footer))));
}
export const uiToolbar = (id, children) => ideaUI(h_flex()).id(id).h(Math.max(IDEA.toolbarHeight, uiSize() + 12)).flex_none().items_center().gap(4).px(4).children(children);
export function uiToolHeader(id, title, { actions = [], content } = {}) {
  return ideaUI(h_flex()).id(id).h(Math.max(IDEA.toolHeaderHeight, uiSize() + 12)).flex_none().items_center().px(8).gap(4)
    .bg(uiColors().surface).text_color(uiColors().foreground)
    .when(isIdea(), el => el.border_b(1).border_color(uiColors().separator))
    .child(content ?? div().flex_1().min_w(0).truncate().child(title)).children(actions);
}
export function uiTab(id, children, { selected = false, active = true, onSelect, onClose, closeIcon, tip } = {}) {
  const c = uiColors();
  let fill = h_flex().h(Math.max(IDEA.tabFillHeight, uiSize() + 8)).items_center().gap(6).px(8).rounded(IDEA.selectionRadius)
    .bg(selected ? active ? c.tabSelected : c.selectionInactive : "#00000000").hover(s => s.bg(selected ? c.tabSelected : c.hover))
    .when(isIdea(), el => el.border_b(2).border_color(selected ? active ? c.accent : c.secondary : "#00000000"))
    .children(Array.isArray(children) ? children : [children]);
  if (onClose && closeIcon) fill = fill.child(uiIconButton(`${id}-close`, closeIcon, onClose, { size: 18, tip: "Close" }));
  let el = ideaUI(h_flex()).id(id).aria_selected(selected).h(Math.max(IDEA.tabHeight, uiSize() + 16)).flex_none().px(2).items_center().text_color(c.foreground).child(fill);
  if (onSelect) el = el.cursor_pointer().on_click(onSelect);
  if (onClose) el = el.on_mouse_down("middle", (event, cx) => { cx.stop_propagation(); onClose(event, cx); });
  if (tip) el = el.tooltip(tip);
  return el;
}
// Normal elements retain close/context/middle-click handlers. Keep their
// measured widths so changing the active file also reveals its whole tab.
export class TabViewport {
  constructor() { this.widths = new Map(); this.width = 0; this.offset = 0; }
  place(ids, active) {
    const live = new Set(ids);
    for (const id of this.widths.keys()) if (!live.has(id)) this.widths.delete(id);
    const widths = ids.map(id => this.widths.get(id) ?? 184);
    this.total = widths.reduce((sum, width) => sum + width, 0);
    const signature = JSON.stringify([ids, widths, this.width, active]);
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, this.total - this.width)));
    if (signature !== this.signature && this.width > 0) {
      const at = ids.indexOf(active), left = widths.slice(0, at).reduce((sum, width) => sum + width, 0);
      if (at >= 0) {
        if (left < this.offset || widths[at] > this.width) this.offset = left;
        else if (left + widths[at] > this.offset + this.width) this.offset = left + widths[at] - this.width;
      }
    }
    this.signature = signature;
    return this.offset;
  }
  scroll(delta) {
    this.offset = Math.max(0, Math.min(this.offset - delta, Math.max(0, this.total - this.width)));
  }
}
export function uiTabStrip(id, items, active, viewport) {
  const offset = viewport.place(items.map(item => item.id), active);
  return h_flex().id(id).flex_1().min_w(0).h_full().overflow_hidden()
    .on_size_change((size, cx) => {
      if (Math.abs(size.width - viewport.width) > 0.5) { viewport.width = size.width; cx.notify(); }
    })
    .on_scroll_wheel((event, cx) => {
      const delta = Number(event.delta?.x) || Number(event.delta?.y) || 0;
      viewport.scroll(delta); cx.stop_propagation(); cx.notify();
    })
    .child(h_flex().w(viewport.total).flex_none().h_full().ml(-offset)
      .children(items.map(item => item.content.on_size_change((size, cx) => {
        if (Math.abs(size.width - (viewport.widths.get(item.id) ?? 0)) > 0.5) { viewport.widths.set(item.id, size.width); cx.notify(); }
      }))));
}
export function uiPopupSize(rowCount, { width = 320, maxHeight = 400, extraHeight = 14 } = {}) {
  return { width, height: Math.min(maxHeight, Math.max(0, rowCount) * Math.max(IDEA.rowHeight, uiSize() + 8) + extraHeight) };
}
const selectable = row => row && !row.separator && !row.heading && !row.disabled;
export class MenuController {
  constructor(cx, selected = 0) {
    this.focus = cx.focus_handle(); this.scroll = VirtualListScrollHandle.new(); this.at = selected; this.released = false;
    this.windowStart = 0; this.windowHeight = 0; this.windowCount = 0; this.windowSelection = undefined; this.windowIndex = -1; this.windowReveal = null; this.hoveredId = null;
    if (selected > 0) this.scroll.scroll_to_item(selected, "center");
  }
  release() { if (!this.released) { this.scroll.release(); this.released = true; } }
  ensureVisible(index = this.at) { if (index >= 0 && !this.released) { this.windowReveal = index; this.scroll.scroll_to_item(index, "center"); } }
  normalize(rows) {
    if (!selectable(rows[this.at])) {
      const after = rows.findIndex((r, i) => i >= this.at && selectable(r));
      this.at = after >= 0 ? after : rows.findIndex(selectable);
    }
    return this.at;
  }
  select(index, rows, cx) {
    if (!selectable(rows[index])) return;
    this.at = index; this.ensureVisible(index); cx.notify();
  }
  activate(rows, event, cx, onClose) {
    const row = rows[this.at];
    if (!selectable(row)) return;
    onClose?.(event, cx); row.action?.(event, cx);
  }
  key(event, cx, rows, { onClose, pageSize = 10, closeOnActivate = true } = {}) {
    this.normalize(rows);
    const key = event.keystroke ?? event.key;
    const choices = rows.map((r, i) => selectable(r) ? i : -1).filter(i => i >= 0);
    const current = choices.indexOf(this.at);
    let next;
    if (key === "escape") { cx.stop_propagation(); onClose?.(event, cx); return true; }
    const dismiss = closeOnActivate ? onClose : undefined;
    if (key === "enter") { cx.stop_propagation(); this.activate(rows, event, cx, dismiss); return true; }
    if (/^[1-9]$/.test(key)) {
      const explicit = rows.findIndex(row => selectable(row) && row.shortcut === key);
      const index = explicit >= 0 ? explicit : rows.some(row => /^[1-9]$/.test(row.shortcut ?? "")) ? undefined : choices[Number(key) - 1];
      if (index !== undefined) { this.at = index; cx.stop_propagation(); this.activate(rows, event, cx, dismiss); return true; }
      return false;
    }
    if (key === "down") next = Math.min(choices.length - 1, current + 1);
    else if (key === "up") next = Math.max(0, current - 1);
    else if (key === "home") next = 0;
    else if (key === "end") next = choices.length - 1;
    else if (key === "pageup") next = Math.max(0, current - pageSize);
    else if (key === "pagedown") next = Math.min(choices.length - 1, current + pageSize);
    else return false;
    cx.stop_propagation();
    if (choices[next] !== undefined) this.select(choices[next], rows, cx);
    return true;
  }
}
// Embedded lists keep the same rows, focus and scroll behavior; their parent
// owns the popup frame. A standalone menu continues to own its own surface.
export function uiMenu(id, rows, controller, cx, { width = 320, maxHeight = 400, onClose, closeOnActivate = true, embedded = false } = {}) {
  if (rows.some(row => row.icon && typeof row.icon !== "function")) throw new Error("uiMenu icons must be factories: icon: () => graphic()");
  controller.normalize(rows);
  const rowHeight = Math.max(IDEA.rowHeight, uiSize() + 8), heights = rows.map(r => r.separator ? 9 : rowHeight);
  const inset = embedded ? 12 : 14; // padding 6 plus the standalone border
  const listHeight = Math.min(Math.max(rowHeight, maxHeight - inset), Math.max(rowHeight, heights.reduce((a, b) => a + b, 0)));
  const listWidth = Math.max(1, width - inset);
  const listId = `${id}-list`;
  const rowKey = i => String(rows[i].id ?? `${id}-separator-${i}`);
  return (embedded ? ideaUI(v_flex()) : popupSurface(v_flex())).id(id).w(width).h(listHeight + inset).items_stretch().flex_none().p(6).track_focus(controller.focus)
    .on_key_down((event, eventCx) => controller.key(event, eventCx, rows, { onClose, closeOnActivate, pageSize: Math.max(1, Math.floor(listHeight / rowHeight)) }))
    .child(v_flex().w(listWidth).h(listHeight).flex_none().relative()
      .child(v_virtual_list(listId, rows.length, heights, rowKey,
        range => rows.slice(range.start, range.end).map((r, n) => {
          const index = range.start + n;
          if (r.separator) return div().h(9).flex_none().child(uiSeparator());
          return uiListRow(`${id}-${r.id ?? index}`, [
            ...(r.icon ? [r.icon()] : []), div().flex_1().min_w(0).truncate().when(Boolean(r.current), el => el.font_semibold()).child(r.label),
            ...(r.shortcut ? [div().flex_none().max_w(180).truncate().text_size(uiSize(11)).text_color(uiColors().secondary).child(r.shortcut)] : []),
          ], { selected: index === controller.at, disabled: r.disabled, interactive: true }).w(listWidth)
            .when(Boolean(r.tip), el => el.tooltip(r.tip));
        })).size_full().track_scroll(controller.scroll).on_item_click((key, eventCx) => {
          const index = rows.findIndex((_row, i) => rowKey(i) === key);
          if (!selectable(rows[index])) return;
          eventCx.stop_propagation();
          controller.at = index;
          // Virtual-list clicks supply a stable key and context, no ClickEvent.
          controller.activate(rows, undefined, eventCx, closeOnActivate ? onClose : undefined);
        }))
      .child(Scrollbar.vertical(listId).absolute().inset_0()));
}
// Selection lists share menu focus/scroll ownership, but navigation selects rather
// than activating an item. Callers retain draft state and all mutation handlers.
export function uiManagedList(id, rows, controller, cx, {
  selectedId, onSelect, onActivate, onClose, actions = [], search, caption,
} = {}) {
  if (rows.some(row => row.icon && typeof row.icon !== "function") || actions.some(action => action.icon && typeof action.icon !== "function")) {
    throw new Error("uiManagedList icons must be factories");
  }
  controller.at = rows.findIndex(row => row.id === selectedId);
  const rowHeight = Math.max(IDEA.rowHeight, uiSize() + 8), listId = `${id}-list`;
  const choose = (index, event, eventCx) => {
    if (!selectable(rows[index])) return;
    controller.at = index; controller.ensureVisible();
    if (rows[index].id !== selectedId) onSelect?.(rows[index].id, event, eventCx);
    eventCx.notify();
  };
  return ideaUI(v_flex()).id(id).h_full().min_h(0).min_w(0)
    .when(actions.length > 0, el => el.child(uiToolbar(`${id}-toolbar`, actions.map(action => uiIconButton(`${id}-${action.id}`,
      action.icon ? action.icon() : div().child(action.label), action.action,
      { tip: action.label + (action.shortcut ? ` (${action.shortcut})` : ""), disabled: Boolean(action.disabled) })))))
    .when(Boolean(search), el => el.child(div().flex_none().px(6).py(4).child(search)))
    .when(Boolean(caption), el => el.child(uiCaption(caption)))
    .child(v_flex().flex_1().min_h(0).relative().track_focus(controller.focus)
      .on_key_down((event, eventCx) => {
        const key = event.keystroke ?? event.key;
        if (key === "alt-up" || key === "alt-down") {
          eventCx.stop_propagation();
          const action = actions.find(item => item.id === (key === "alt-up" ? "move-up" : "move-down"));
          if (action && !action.disabled) action.action?.(event, eventCx);
          return;
        }
        if (key === "escape") { eventCx.stop_propagation(); onClose?.(event, eventCx); return; }
        if (key === "enter") {
          eventCx.stop_propagation();
          if (selectable(rows[controller.at])) onActivate?.(rows[controller.at].id, event, eventCx);
          return;
        }
        if (!["up", "down", "home", "end", "pageup", "pagedown"].includes(key)) return;
        if (controller.at < 0) {
          eventCx.stop_propagation();
          const choices = rows.map((row, index) => selectable(row) ? index : -1).filter(index => index >= 0);
          choose(key === "up" || key === "end" || key === "pageup" ? choices.at(-1) : choices[0], event, eventCx);
          return;
        }
        const previous = rows[controller.at]?.id;
        controller.key(event, eventCx, rows, { closeOnActivate: false });
        if (selectable(rows[controller.at]) && rows[controller.at].id !== previous) onSelect?.(rows[controller.at].id, event, eventCx);
      })
      .when(!rows.length, el => el.child(uiCaption("No items")))
      .child(v_virtual_list(listId, rows.length, rowHeight, index => String(rows[index].id),
        range => rows.slice(range.start, range.end).map(row => uiListRow(`${id}-${row.id}`, [
          ...(row.icon ? [row.icon()] : []), div().flex_1().min_w(0).truncate().child(row.label),
          ...(row.detail ? [div().max_w(150).truncate().text_size(uiSize(11)).text_color(uiColors().secondary).child(row.detail)] : []),
        ], { selected: row.id === selectedId, disabled: row.disabled, interactive: true })))
        .size_full().track_scroll(controller.scroll).on_item_click((key, eventCx) => {
          eventCx.stop_propagation(); controller.focus.focus();
          choose(rows.findIndex(row => String(row.id) === key), undefined, eventCx);
        }))
      .child(Scrollbar.vertical(listId).absolute().inset_0()));
}
export function uiTreeRow(id, label, { depth = 0, selected = false, expanded, graphic, shortcut, onClick, disabled = false } = {}) {
  const c = uiColors();
  return uiListRow(id, [
    div().w(12).flex_none().text_color(c.secondary).child(expanded === undefined ? "" : expanded ? "⌄" : "›"),
    ...(graphic ? [graphic] : []), div().flex_1().min_w(0).truncate().child(label),
    ...(shortcut ? [div().flex_none().max_w(220).truncate().text_color(c.secondary).child(shortcut)] : []),
  ], { selected, disabled, onClick, indent: depth * 14 }).rounded(0);
}
export function uiSettingsShell(id, { title, sidebar, content, footer = [], width = 900, height = 700, sidebarWidth = 145 }) {
  const c = uiColors();
  return popupSurface(v_flex(), true).id(id).w(width).h(height).min_h(0).bg(c.surface)
    .child(h_flex().h(28).flex_none().px(16).items_center().text_color(c.secondary).child(title))
    .child(h_flex().flex_1().min_h(0).items_stretch()
      .child(v_flex().w(sidebarWidth).h_full().flex_none().min_h(0).border_r(1).border_color(c.separator).child(sidebar))
      .child(v_flex().flex_1().h_full().min_w(0).min_h(0).px(16).py(12).child(content)))
    .child(h_flex().h(46).flex_none().border_t(1).border_color(c.separator).px(14).items_center().justify_end().gap(8).children(footer));
}
export function uiDialog(id, { title, body, footer }) {
  // An auto-sized overlay has no definite parent height for h_full().
  // Callers may override this explicit default via .h(theirDialogHeight).
  return popupSurface(v_flex(), true).id(id).w_full().h(360).min_h(0)
    .child(uiCaption(title).when(isIdea(), el => el.min_h(IDEA.toolHeaderHeight).border_b(1).border_color(uiColors().separator)))
    .child(v_flex().flex_1().min_h(0).px(12).py(isIdea() ? 12 : 0).child(body))
    .child(h_flex().flex_none().items_center().justify_end().gap(8).p(12)
      .when(isIdea(), el => el.border_t(1).border_color(uiColors().separator))
      .children(Array.isArray(footer) ? footer : footer ? [footer] : []));
}
export const uiIslandBottom = () => div().h(IDEA.islandRadius).flex_none().bg(uiColors().surface).rounded_b(IDEA.islandRadius);

// Editor-local modes (such as Markdown preview) share the editor's lower chrome.
export const uiEditorFooter = children => ideaUI(h_flex()).w_full().h(IDEA.editorBreadcrumbHeight).flex_none()
  .px(8).gap(6).items_center().justify_end().bg(uiColors().editor).border_t(1).border_color(uiColors().separator)
  .children(Array.isArray(children) ? children : children ? [children] : []);

// Keep the stripe's hit area separate from its inset selection fill. The fill
// must never reach the window edge, even at compact density.
export function uiStripeButton(id, graphic, action, { active = false, disabled = false, tip = "", side } = {}) {
  const c = uiColors(), inset = 2;
  // The adjoining island contributes half its gap on the inside of a stripe.
  // Move only the fill/icon by half that inset, keeping the hit target fixed:
  // both visible margins then include the same share of the shell's spacing.
  const offset = (side === "left" ? 1 : side === "right" ? -1 : 0) * IDEA.islandGap / 4;
  const fill = h_flex().w(IDEA.stripeButtonWidth - inset * 2).h(IDEA.stripeButtonHeight - inset * 2)
    .relative().left(offset).items_center().justify_center().rounded(isIdea() ? IDEA.selectionRadius : 6).bg(active ? isIdea() ? c.selection : c.accent : "#00000000")
    .text_color(disabled ? c.disabled : active && isIdea() ? c.accent : c.foreground)
    .when(!disabled, el => el.hover(s => s.bg(active ? isIdea() ? c.selection : c.accent : c.hover)))
    .when(isIdea() && active, el => el.child(div().absolute().left(side === "right" ? IDEA.stripeButtonWidth - inset * 2 - 2 : 0)
      .top(6).bottom(6).w(2).rounded(1).bg(c.accent))).child(graphic);
  let button = (isIdea() ? Button.new(id) : h_flex().id(id)).w(IDEA.stripeButtonWidth).h(IDEA.stripeButtonHeight).flex_none()
    .flex().items_center().justify_center().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(fill);
  if (isIdea()) button = button.disabled(disabled).selected(active).accessibility_label(tip || id)
    .border_1().border_color("#00000000").focus(s => s.border_color(c.focus));
  if (!disabled) button = button.cursor_pointer().on_click((event, cx) => { cx.stop_propagation(); action(event, cx); });
  if (tip) button = button.tooltip(tip);
  return button;
}

export function uiCheckbox(id, label, action, { checked = false, disabled = false } = {}) {
  const c = uiColors();
  let checkbox = ideaUI(h_flex()).id(id).min_h(Math.max(IDEA.rowHeight, uiSize() + 8)).flex_none().gap(7).items_center()
    .text_color(disabled ? c.disabled : c.foreground)
    .child(h_flex().size(14).flex_none().items_center().justify_center().rounded(3).border_1()
      .border_color(disabled ? c.disabled : checked ? c.accent : c.border).bg(checked ? c.accent : c.surface)
      .text_size(12).text_color(c.accentForeground).child(checked ? "✓" : ""))
    .child(div().min_w(0).truncate().child(label));
  if (!disabled) checkbox = checkbox.cursor_pointer().on_click(action);
  return checkbox;
}

// ADE's first native frame is built from the approved HTML, independently of
// the legacy idea controls. Colors and assets still have one canonical source.
export const ADE = Object.freeze(IDEA_TOKENS["herdr.ade"].metrics);
export const adeColors = () => ux.colors;
export const adeSize = (size = 13) => size * (Number(settings().ui_font_size) || 13) / 13;
export const adeUI = element => element.font_family(settings().ui_font ?? settings().ui_font_family ?? ".AppleSystemUIFont").text_size(adeSize()).text_color(ux.colors.foreground);

export function adeButton(id, label, action, { icon, tip, kind = "quiet", disabled = false, selected = false, square = false } = {}) {
  const c = adeColors(), height = Math.max(ADE.controlHeight, adeSize() + 12);
  const fill = kind === "primary" ? c.primary : selected ? c.selection : "#00000000";
  let button = adeUI(Button.new(id)).h(height).min_w(24).flex_none().px(square ? 4 : 8).flex().items_center().justify_center().gap(6)
    .rounded(5).border(1).border_color(kind === "outline" ? c.separator : kind === "primary" ? c.primary : "#00000000")
    .bg(fill).text_color(disabled ? c.disabled : kind === "primary" ? c.onPrimary : c.foreground)
    .disabled(disabled).selected(selected).accessibility_label(tip ?? (typeof label === "string" ? label : id))
    .focus(style => style.border_color(c.focus))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation());
  if (square) button = button.w(height);
  if (icon) button = button.child(icon);
  if (label) button = button.child(label);
  if (tip) button = button.tooltip(tip);
  if (!disabled) button = button.cursor_pointer().hover(style => style.bg(selected ? c.selection : kind === "primary" ? c.primary : c.hover))
    .on_click((event, cx) => { cx.stop_propagation(); action?.(event, cx); });
  return button;
}

export function adeGutterAction(id, marker, { graphic, onActivate, height = 24 } = {}) {
  if (!marker) return div().w(24).h(height).flex_none();
  return adeButton(id, null, onActivate, { icon: graphic?.(), tip: marker.title, square: true })
    .w(24).min_w(24).h(height).px(2).rounded(3)
    .text_color(marker.kind.startsWith("spring") || marker.kind === "http" ? adeColors().success : adeColors().secondary);
}

export function adeCompletionPopup(id, rows, controller, cx, { bounds, title = "자동완성 · Enter/Tab 적용 · Esc 닫기", hint, ...actions } = {}) {
  if (!bounds?.width || !bounds?.height) return div().h(0);
  const c = adeColors();
  return adeUI(v_flex()).id(id).w(bounds.width).h(bounds.height).min_h(0).overflow_hidden()
    .rounded(ADE.radius).border(1).border_color(c.separator).bg(c.popup)
    .on_mouse_down_out(actions.onClose)
    .child(div().h(bounds.headerHeight).flex_none().overflow_hidden().px(10).flex().items_center().text_size(adeSize(11)).text_color(c.secondary).tooltip(hint || title).child(title))
    .child(bounds.height > bounds.headerHeight ? adeManagedList(`${id}-items`, rows, controller, cx, { ...actions, activateOnClick: true }) : div().h(0));
}

export function adeStripeButton(id, icon, action, { selected = false, tip = "" } = {}) {
  const c = adeColors();
  return adeButton(id, null, action, { icon, selected, tip, square: true }).size(ADE.stripeButtonSize).relative()
    .text_color(selected ? c.accent : c.foreground)
    .when(selected, element => element.child(div().absolute().left(0).top(8).bottom(8).w(2).bg(c.accent)));
}

export function adeRow(id, label, { icon, leading, detail, indent = 0, selected = false, strong = false, labelColor, onClick } = {}) {
  const c = adeColors();
  let row = adeUI(h_flex()).id(id).h(Math.max(ADE.rowHeight, adeSize() + 12)).flex_none().min_w(0).items_center().gap(7)
    .pl(8 + indent).pr(8).rounded(ADE.radius).aria_selected(selected)
    .bg(selected ? c.selection : "#00000000");
  if (leading) row = row.child(leading);
  if (icon) row = row.child(icon);
  row = row.child(div().flex_1().min_w(0).truncate().text_color(labelColor || c.foreground).when(strong, element => element.font_semibold()).child(label));
  if (detail) row = row.child(div().flex_none().max_w(140).truncate().text_size(adeSize(11)).text_color(c.disabled).child(detail));
  if (onClick) row = row.cursor_pointer().hover(style => style.bg(selected ? c.selection : c.hover)).on_click(onClick);
  return row;
}

export function adePanel(id, title, body, { actions = [] } = {}) {
  const c = adeColors();
  return adeUI(v_flex()).id(id).size_full().min_w(0).min_h(0).rounded(ADE.radius).overflow_hidden().bg(c.editor)
    .child(h_flex().h(Math.max(ADE.toolHeaderHeight, adeSize(12) + 18)).flex_none().min_w(0).items_center().gap(5).px(10)
      .bg(c.surface).border_b(1).border_color(c.separator).text_size(adeSize(12)).text_color(c.secondary)
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(title)).children(actions))
    .child(v_flex().flex_1().min_h(0).min_w(0).child(body));
}

// ADE overlays own an opaque surface independently of the legacy layout.
export function adeDialog(id, { title, body, footer = [] }) {
  const c = adeColors();
  return adePanel(id, title, v_flex().flex_1().min_h(0)
    .child(v_flex().flex_1().min_h(0).p(12).child(body))
    .child(h_flex().flex_none().items_center().justify_end().gap(8).p(12).border_t(1).border_color(c.separator)
      .children(Array.isArray(footer) ? footer : [footer]))).w_full().h(360).border_1().border_color(c.separator);
}

export function adeTab(id, label, { icon, selected = false, onSelect, closeIcon, onClose } = {}) {
  const c = adeColors();
  return adeUI(h_flex()).id(id).h(Math.max(ADE.tabFillHeight, adeSize() + 18)).flex_none().items_center().gap(7).pl(12).pr(onClose ? 4 : 12)
    .rounded_t(ADE.radius).border_b(2).border_color(selected ? c.accent : "#00000000")
    .bg(selected ? c.tabSelected : "#00000000").text_color(selected ? c.foreground : c.secondary).aria_selected(selected)
    .cursor_pointer().hover(style => style.bg(selected ? c.tabSelected : c.hover)).on_click(onSelect)
    .on_mouse_down("middle", (event, cx) => { cx.stop_propagation(); onClose?.(event, cx); })
    .when(Boolean(icon), element => element.child(icon)).child(label)
    .when(Boolean(onClose), element => element.child(adeButton(`${id}-close`, null, onClose, { icon: closeIcon, tip: `닫기: ${label}`, square: true }).ml(5).text_color(c.disabled)));
}

export const adeNote = text => adeUI(div()).flex_none().p(12).border_t(1).border_color(adeColors().separator)
  .text_size(adeSize(11)).text_color(adeColors().secondary).whitespace_normal().child(text);

export function adeInputBox(input, { error = false, width } = {}) {
  const c = adeColors();
  return adeUI(h_flex()).min_h(Math.max(ADE.controlHeight, adeSize() + 12)).min_w(0).px(7).rounded(4).border_1()
    .border_color(error ? c.error : c.separator).bg(c.canvas)
    .when(Boolean(width), element => element.w(width)).child(input.flex_1().min_w(0));
}
export function adeListHeading(id, label, detail, height = Math.max(ADE.rowHeight, adeSize() + 12)) {
  const c = adeColors();
  return adeUI(h_flex()).id(id).h(height).w_full().flex_none().px(10).gap(8).items_center()
    .text_size(adeSize(11)).text_color(c.secondary).font_medium()
    .child(div().flex_1().min_w(0).truncate().child(label))
    .when(detail != null, element => element.child(String(detail)));
}

function adeManagedRows(id, rows, controller, { selectedId, choose, rowActions, height }) {
  const c = adeColors(), count = Math.max(1, Math.min(25, Math.floor((controller.windowHeight || height * 10) / height)));
  let start = Number(controller.windowStart) || 0;
  const at = rows.findIndex(row => row.id === selectedId), changed = controller.windowSelection !== selectedId || controller.windowIndex !== at;
  const resizedVisible = count !== controller.windowCount && at >= start && at < start + (controller.windowCount || count);
  const reveal = controller.windowReveal ?? (changed || resizedVisible ? at : -1);
  if (reveal >= 0) { if (reveal < start) start = reveal; else if (reveal >= start + count) start = reveal - count + 1; }
  start = Math.max(0, Math.min(start, Math.max(0, rows.length - count)));
  controller.windowStart = start; controller.windowCount = count; controller.windowSelection = selectedId; controller.windowIndex = at; controller.windowReveal = null;
  const end = Math.min(rows.length, start + count), overflow = rows.length > count;
  const scroll = (delta, eventCx) => {
    const next = Math.max(0, Math.min(controller.windowStart + delta, Math.max(0, rows.length - count)));
    if (next === controller.windowStart) return;
    controller.windowStart = next; controller.windowReveal = null; controller.hoveredId = null; eventCx.notify();
  };
  return v_flex().flex_1().min_w(0).min_h(0)
    .child(v_flex().id(`${id}-window`).flex_1().min_h(0).overflow_hidden()
      .on_size_change((size, eventCx) => {
        if (size.height > 0 && Math.abs(size.height - controller.windowHeight) > 0.5) { controller.windowHeight = size.height; eventCx.notify(); }
      })
      .on_scroll_wheel((event, eventCx) => {
        const y = Number(event.delta?.y) || 0, x = Number(event.delta?.x) || 0;
        if (!y || Math.abs(x) > Math.abs(y)) return;
        scroll(-Math.sign(y) * Math.max(1, Math.round(Math.abs(y) / height)), eventCx); eventCx.stop_propagation();
      })
      .children(rows.slice(start, end).map((row, offset) => {
        if (row.heading) return adeListHeading(`${id}-${row.id}`, row.label, row.detail, height);
        const actions = rowActions(row) ?? [];
        if (actions.some(action => action.icon && typeof action.icon !== "function")) throw new Error("adeManagedList row action icons must be factories");
        const show = controller.hoveredId === row.id || row.id === selectedId;
        return adeRow(`${id}-${row.id}`, row.label, { icon: row.icon?.(), detail: show && actions.length ? undefined : row.detail, selected: row.id === selectedId,
          onClick: row.disabled ? undefined : (_event, eventCx) => { eventCx.stop_propagation(); controller.focus.focus(); choose(start + offset, undefined, eventCx, true); },
        }).text_color(row.disabled ? c.disabled : c.foreground)
          .when(Boolean(row.tip), element => element.tooltip(row.tip))
          .on_hover((hovered, eventCx) => {
            const next = hovered ? row.id : controller.hoveredId === row.id ? null : controller.hoveredId;
            if (next !== controller.hoveredId) { controller.hoveredId = next; eventCx.notify(); }
          })
          .when(show && actions.length > 0, element => element.child(h_flex().flex_none().gap(2)
            .children(actions.map(action => adeButton(`${id}-${row.id}-${action.id}`, null, (event, eventCx) => { controller.focus.focus(); action.action?.(row.id, event, eventCx); }, {
              icon: action.icon?.(), tip: action.label, square: true, disabled: Boolean(row.disabled || action.disabled),
            })))));
      })))
    .when(overflow, element => element.child(h_flex().flex_none().min_h(ADE.controlHeight).items_center().gap(4).px(6).border_t(1).border_color(c.separator)
      .child(div().flex_1().min_w(0).truncate().text_size(adeSize(11)).text_color(c.secondary).child(`${start + 1}–${end} / ${rows.length}`))
      .child(adeButton(`${id}-previous`, "이전", (_event, eventCx) => scroll(-count, eventCx), { disabled: start === 0 }))
      .child(adeButton(`${id}-next`, "다음", (_event, eventCx) => scroll(count, eventCx), { disabled: end >= rows.length }))));
}
export function adeManagedList(id, rows, controller, cx, { selectedId, onSelect, onActivate, onClose, activateOnClick = false, actions = [], rowActions, search, caption: title, onKeyDown } = {}) {
  const c = adeColors(), height = Math.max(ADE.rowHeight, adeSize() + 12), listId = `${id}-rows`;
  if (rows.some(row => row.icon && typeof row.icon !== "function") || actions.some(action => action.icon && typeof action.icon !== "function")) throw new Error("adeManagedList icons must be factories");
  controller.at = rows.findIndex(row => row.id === selectedId && selectable(row));
  const choose = (at, event, eventCx, clicked = false) => {
    if (!selectable(rows[at])) return;
    controller.select(at, rows, eventCx);
    onSelect?.(rows[at].id, event, eventCx);
    if (clicked && activateOnClick) onActivate?.(rows[at].id, event, eventCx);
  };
  const body = rowActions ? adeManagedRows(id, rows, controller, { selectedId, choose, rowActions, height })
    : v_virtual_list(listId, rows.length, height, at => String(rows[at].id), range => rows.slice(range.start, range.end).map(row => row.heading ? adeListHeading(`${id}-${row.id}`, row.label, row.detail, height) :
      adeRow(`${id}-${row.id}`, row.label, { icon: row.icon?.(), leading: row.leading?.(), detail: row.detail, indent: row.indent ?? 0, selected: row.id === selectedId })
        .text_color(row.disabled ? c.disabled : c.foreground).when(Boolean(row.tip), element => element.tooltip(row.tip))))
      .size_full().track_scroll(controller.scroll).on_item_click((itemId, eventCx) => {
        eventCx.stop_propagation(); controller.focus.focus(); choose(rows.findIndex(row => String(row.id) === itemId), undefined, eventCx, true);
      });
  return adeUI(v_flex()).id(id).w_full().flex_1().min_w(0).min_h(0)
    .when(actions.length > 0, element => element.child(h_flex().flex_none().min_h(36).px(5).gap(2).items_center().border_b(1).border_color(c.separator)
      .children(actions.map(action => adeButton(`${id}-${action.id}`, null, action.action, { icon: action.icon?.(), tip: action.label, square: true, disabled: Boolean(action.disabled) })))))
    .when(Boolean(search), element => element.child(div().flex_none().px(8).py(6).child(search)))
    .when(Boolean(title), element => element.child(div().flex_none().px(10).py(7).text_size(adeSize(11)).text_color(c.secondary).child(title)))
    .child(v_flex().flex_1().min_h(0).relative().track_focus(controller.focus)
      .on_key_down((event, eventCx) => {
        if (onKeyDown?.(event, eventCx, rows[controller.at])) return;
        const chord = event.keystroke ?? event.key;
        if (chord === "alt-up" || chord === "alt-down") {
          eventCx.stop_propagation();
          const action = actions.find(item => item.id === (chord === "alt-up" ? "move-up" : "move-down"));
          if (action && !action.disabled) action.action?.(event, eventCx);
        } else if (chord === "enter") {
          eventCx.stop_propagation();
          if (selectable(rows[controller.at])) onActivate?.(rows[controller.at].id, event, eventCx);
        } else {
          const before = rows[controller.at]?.id;
          controller.key(event, eventCx, rows, { onClose, closeOnActivate: false, pageSize: rowActions ? Math.max(1, Math.min(25, Math.floor((controller.windowHeight || height * 10) / height))) : 10 });
          if (selectable(rows[controller.at]) && rows[controller.at].id !== before) onSelect?.(rows[controller.at].id, event, eventCx);
        }
      })
      .when(!rows.length, element => element.child(div().p(12).text_color(c.secondary).child("표시할 항목이 없습니다")))
      .child(body)
      .when(!rowActions, element => element.child(Scrollbar.vertical(listId).absolute().inset_0())));
}

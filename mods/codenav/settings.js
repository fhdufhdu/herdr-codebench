// IntelliJ-style settings for the idea layout. Personal Herdr settings are
// changed with the same optimistic file writes as Herdr's own settings view.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Select, Popup } from "gpui-base";
import { shared, setShared, settings, keys, theme, run, props, closeOverlay, openOverlay, appHome, readTextFile, writeTextFile } from "herdr";
import { uiSize, IDEA, uiInputBox, uiButton, uiColors, uiCaption, uiSettingsShell, uiTreeRow, uiListRow, uiCheckbox, MenuController, uiManagedList, uiMenu, NOTIFICATION_GROUPS } from "./idea-design.js";
import { icon, codeFont } from "./common.js";
import { T } from "./i18n.js";
import { openLspSetup } from "./lsp-setup.js";

import { TOOLS, SIDES, currentSides, DEFAULT_SIDES, hiddenTools, arrange } from "./tool-windows.js";
import { openDatabaseManager } from "./database.js";
import { orderedTools } from "./tool-layout.js";
import { toolImage } from "./ideaicons.js";
import { listActions, getAction, formatShortcut, normalizeChord } from "./actions.js";
import { stageBindingEdits, applyBindingEdits, validateChord } from "./keymap-model.js";
import { restoreKnownGroups, mergeCustomization } from "./toolbar-model.js";
const copy = value => JSON.parse(JSON.stringify(value ?? {}));

// Re-read on a rejected optimistic write so unrelated concurrent edits survive.
// Parse/domain errors stay outside the retry; only writes can be retried.
async function updateJsonFile(path, update) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await readTextFile(path), document = raw ? JSON.parse(raw) : {};
    const next = update(document) ?? document;
    try { await writeTextFile(path, JSON.stringify(next, null, 2) + "\n", raw); return next; }
    catch (error) { if (attempt === 2) throw error; }
  }
}

export const openIdeaSettings = (page = "appearance") => openOverlay({
  mod: "codenav", props: { view: "settings", page }, kind: "dialog", frame: "none", width: 900, height: 700,
});

const PAGES = [
  ["appearance", "Appearance & Behavior", "Appearance"],
  ["windows", "Appearance & Behavior", "Tool Windows"],
  ["notifications", "Appearance & Behavior", "Notifications"],
  ["editor", "Editor", "Font"],
  ["terminal", "Tools", "Terminal"],
  ["lsp", "Tools", "Language Servers"],
  ["database", "Tools", "Database"],
  ["keymap", "Keymap", "Keymap"],
];
const actionLabel = action => T(getAction(action)?.label ?? action.replace(/^[^.]+\./, "").replace(/-/g, " "));
const bindingGroup = action => getAction(action)?.category ?? "Other";
const editableSection = section => ["layout:idea", "mod:codenav", "mod:activity", "terminal"].includes(section);

export default class IdeaSettings {
  init(p, cx) {
    this.page = PAGES.some(([id]) => id === p?.page) ? p.page : "appearance";
    const s = settings(), a = shared("codenav.appearance") ?? {};
    this.draft = {
      uiFont: a.uiFont ?? s.ui_font_family ?? ".AppleSystemUIFont", uiSize: a.uiSize ?? 13,
      editorFont: a.editorFont ?? codeFont().family, editorSize: a.editorSize ?? codeFont().size,
      terminalFont: s.font_family ?? "JetBrains Mono", terminalSize: s.font_size ?? 14, compact: a.compact !== false,
      toolSides: currentSides(), toolHidden: [...hiddenTools()],
    };
    this.savedRawToolOrder = copy(shared("codenav.toolOrder"));
    this.draft.toolOrder = Object.fromEntries(Object.keys(SIDES).map(side => [side, orderedTools(Object.keys(TOOLS).filter(name => this.draft.toolSides[name] === side), this.savedRawToolOrder[side])]));
    this.toolSide = "left";
    this.windowSelected = Object.keys(TOOLS)[0];
    this.windowMenu = new MenuController(cx);
    this.windowPositionMenu = new MenuController(cx); this.windowPositionFocus = cx.focus_handle(); this.windowPositionOpen = false;
    this.windowSearch = InputState.new({ placeholder: T("Search tool windows") }); this.windowQuery = "";
    this.windowSearch.on("change", (_e, eventCx) => { this.windowQuery = this.windowSearch.value().trim().toLowerCase(); this.windowMenu.ensureVisible(0); eventCx.notify(); });
    this.saved = JSON.stringify(this.draft);
    this.savedToolSides = { ...this.draft.toolSides };
    this.notificationPolicy = copy(shared("codenav.notificationPolicy"));
    this.savedNotificationPolicy = copy(this.notificationPolicy);
    this.focus = cx.focus_handle(); this.focus.focus();
    this.shortcutFocus = cx.focus_handle();
    this.bindingBase = keys();
    this.pendingBindings = []; this.sidebarCollapsed = new Set();
    this.keyMenu = new MenuController(cx);
    const firstBinding = this.bindings()[0];
    this.selectedBinding = firstBinding?.id ?? null; this.selectedChord = firstBinding?.chords[0] ?? null;
    this.inputs = {};
    for (const field of ["uiFont", "editorFont", "terminalFont"]) {
      const input = InputState.new(); input.set_value(this.draft[field]);
      input.on("change", (_e, cx) => { this.draft[field] = input.value(); this.error = null; cx.notify(); });
      input.on("submit", (_e, cx) => this.apply(cx, true));
      this.inputs[field] = input;
    }
    this.search = InputState.new({ placeholder: T("Search settings") });
    this.query = "";
    this.search.on("change", (_e, cx) => { this.query = this.search.value().trim().toLowerCase(); cx.notify(); });
    this.keySearch = InputState.new({ placeholder: T("Search actions or shortcuts") }); this.keyQuery = "";
    this.keySearch.on("change", (_e, cx) => {
      this.keyQuery = this.keySearch.value().trim().toLowerCase();
      const rows = this.keymapRows();
      if (!rows.some(row => row.id === this.selectedBinding)) this.selectBinding(rows[0]?.id, cx);
      this.keyMenu.ensureVisible(0); cx.notify();
    });
    this.shortcutInput = InputState.new({ placeholder: "cmd-shift-o" });
    this.shortcutInput.on("change", (_e, cx) => { this.newShortcut = this.shortcutInput.value(); this.error = null; cx.notify(); });
    this.shortcutInput.on("submit", (_e, cx) => this.stageShortcut(cx));
  }

  release() {
    for (const input of [...Object.values(this.inputs), this.search, this.keySearch, this.shortcutInput, this.windowSearch]) input?.release?.();
    this.keyMenu.release(); this.keyMenu.focus.release();
    this.windowMenu.release(); this.windowMenu.focus.release();
    this.windowPositionMenu.release(); this.windowPositionMenu.focus.release(); this.windowPositionFocus.release();
    this.focus.release(); this.shortcutFocus.release();
  }

  bindings() {
    const rows = new Map();
    for (const action of listActions()) {
      const section = action.keymapSection ?? (action.owner === "activity" ? "mod:activity" : "layout:idea"), id = `${section}:${action.id}`;
      rows.set(id, { id, action: action.id, section, label: T(action.label), chords: [], group: action.category });
    }
    for (const binding of stageBindingEdits(this.bindingBase, this.pendingBindings).filter(k => editableSection(k.section)
      && !(k.section === "terminal" && k.action.startsWith("codenav.key:") && normalizeChord(k.action.slice(12)) === normalizeChord(k.keys)))) {
      const id = `${binding.section}:${binding.action}`;
      const row = rows.get(id) ?? { id, action: binding.action, section: binding.section, label: actionLabel(binding.action), chords: [], group: bindingGroup(binding.action) };
      if (!row.chords.includes(binding.keys)) row.chords.push(binding.keys);
      rows.set(id, row);
    }
    return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  beginShortcut(cx, mode = "add") {
    if (this.saving) return;
    const row = this.bindings().find(item => item.id === this.selectedBinding);
    if (!row || mode === "replace" && !row.chords.includes(this.selectedChord)) return;
    this.capturing = true; this.shortcutMode = mode; this.replacingChord = mode === "replace" ? this.selectedChord : null;
    this.newShortcut = ""; this.shortcutInput.set_value(""); this.shortcutInput.focus(); this.error = null; cx.notify();
  }
  captureShortcut(event, cx) {
    if (!this.capturing || this.saving) return;
    cx.stop_propagation();
    if (event.key === "escape") { this.capturing = false; this.error = null; this.focus.focus(); cx.notify(); return; }
    if (["shift", "control", "alt", "cmd", "meta", "fn"].includes(event.key)) return;
    this.newShortcut = normalizeChord(event.keystroke ?? event.key); this.shortcutInput.set_value(this.newShortcut); cx.notify();
  }
  editBindings(edits, cx) {
    try {
      let pending = this.pendingBindings.slice();
      for (const edit of edits) {
        const chord = validateChord(edit.chord), previous = pending.find(item => item.section === edit.section && item.chord === chord);
        const expected = previous?.expected ?? this.bindingBase.find(item => item.section === edit.section && normalizeChord(item.keys) === chord)?.action ?? null;
        pending = pending.filter(item => item.section !== edit.section || item.chord !== chord);
        if (edit.action !== expected) pending.push({ ...edit, chord, expected });
      }
      stageBindingEdits(this.bindingBase, pending);
      this.pendingBindings = pending; this.error = null; return true;
    } catch (error) { this.error = String(error.message ?? error); cx.notify(); return false; }
  }
  stageShortcut(cx) {
    if (this.saving || !this.capturing) return;
    const row = this.bindings().find(r => r.id === this.selectedBinding), chord = this.newShortcut;
    if (!row || !chord) return;
    const normalized = normalizeChord(chord), existing = stageBindingEdits(this.bindingBase, this.pendingBindings).find(item => item.section === row.section && normalizeChord(item.keys) === normalized);
    if (existing && existing.action !== row.action) { this.error = T("This shortcut is already assigned."); cx.notify(); return; }
    const edits = this.replacingChord && normalizeChord(this.replacingChord) !== normalized ? [{ section: row.section, chord: this.replacingChord, action: null }] : [];
    edits.push({ section: row.section, chord, action: row.action });
    if (!this.editBindings(edits, cx)) return;
    this.selectedChord = normalized;
    this.capturing = false; this.focus.focus(); cx.notify();
  }
  removeShortcut(cx) {
    if (this.saving) return;
    const row = this.bindings().find(item => item.id === this.selectedBinding);
    if (row?.chords.includes(this.selectedChord) && this.editBindings([{ section: row.section, chord: this.selectedChord, action: null }], cx)) {
      this.selectedChord = this.bindings().find(item => item.id === row.id)?.chords[0] ?? null;
      this.capturing = false; cx.notify();
    }
  }
  async saveShortcuts() {
    if (!this.pendingBindings.length) return;
    const document = await updateJsonFile(`${appHome()}/keys.json`, latest => applyBindingEdits(latest, this.pendingBindings));
    this.bindingBase = Object.entries(document).flatMap(([section, bindings]) => bindings && typeof bindings === "object" && !Array.isArray(bindings)
      ? Object.entries(bindings).filter(([_keys, action]) => typeof action === "string").map(([keys, action]) => ({ section, keys, action })) : []);
    this.pendingBindings = [];
  }

  apply(cx, close = false) {
    if (this.saving) return;
    if (["uiFont", "editorFont", "terminalFont"].some((f) => !this.draft[f].trim())) {
      this.error = T("Enter a font family."); cx.notify(); return;
    }
    this.saving = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const d = copy(this.draft), s = settings();
        const restoreToolLayout = this.restoreToolLayout;
        const policy = copy(this.notificationPolicy);
        // Validate conflicts before changing other preferences. Preserve future
        // notification fields and unrelated concurrent tool changes.
        mergeCustomization(this.savedNotificationPolicy, policy, shared("codenav.notificationPolicy") ?? {});
        this.mergedToolOrder(d);
        await this.saveShortcuts();
        if (d.terminalFont !== s.font_family || d.terminalSize !== s.font_size) {
          await updateJsonFile(`${appHome()}/settings.json`, person => {
            person.font = d.terminalFont.trim(); person.font_size = d.terminalSize;
          });
        }
        setShared("codenav.appearance", { ...(shared("codenav.appearance") ?? {}),
          uiFont: d.uiFont.trim(), uiSize: d.uiSize, editorFont: d.editorFont.trim(), editorSize: d.editorSize, compact: d.compact });
        const moved = Object.fromEntries(Object.entries(d.toolSides).filter(([name, side]) => TOOLS[name] && SIDES[side] && (restoreToolLayout || side !== this.savedToolSides[name])));
        if (Object.keys(moved).length) {
          setShared("codenav.toolSides", { ...(shared("codenav.toolSides") ?? {}), ...moved });
          arrange(moved);
        }
        const previous = JSON.parse(this.saved);
        if (JSON.stringify(d.toolHidden) !== JSON.stringify(previous.toolHidden)) {
          const hidden = new Set(hiddenTools());
          for (const name of Object.keys(TOOLS)) {
            if (d.toolHidden.includes(name) === previous.toolHidden.includes(name)) continue;
            d.toolHidden.includes(name) ? hidden.add(name) : hidden.delete(name);
          }
          setShared("codenav.toolHidden", [...hidden]);
        }
        this.savedToolSides = { ...d.toolSides };
        const toolOrder = this.mergedToolOrder(d);
        if (JSON.stringify(toolOrder) !== JSON.stringify(shared("codenav.toolOrder") ?? {})) setShared("codenav.toolOrder", toolOrder);
        this.savedRawToolOrder = copy(toolOrder);
        const notificationPolicy = mergeCustomization(this.savedNotificationPolicy, policy, shared("codenav.notificationPolicy") ?? {});
        if (JSON.stringify(policy) !== JSON.stringify(this.savedNotificationPolicy)) setShared("codenav.notificationPolicy", notificationPolicy);
        this.notificationPolicy = copy(notificationPolicy); this.savedNotificationPolicy = copy(notificationPolicy);
        this.restoreToolLayout = false;
        this.saved = JSON.stringify(d);
        if (close) closeOverlay(props().overlay);
      } catch (e) { this.error = String(e); }
      this.saving = false; cx.notify();
    });
  }

  field(name, sizeKey, t) {
    return h_flex().gap(10).items_center()
      .child(uiInputBox(Input.new(this.inputs[name]).text_size(uiSize()), { error: Boolean(this.error) }).w(300))
      .child(div().text_color(t.muted).child(T("Size:")))
      .child(h_flex().h(IDEA.inputHeight).items_center().rounded(IDEA.controlRadius).border_1().border_color(t.input)
        .child(this.step(`${sizeKey}-minus`, "−", () => { this.draft[sizeKey] = Math.max(sizeKey === "uiSize" ? 9 : 8, this.draft[sizeKey] - 1); }))
        .child(div().w(28).text_center().child(String(this.draft[sizeKey])))
        .child(this.step(`${sizeKey}-plus`, "+", () => { this.draft[sizeKey] = Math.min(sizeKey === "uiSize" ? 24 : 36, this.draft[sizeKey] + 1); })));
  }
  step(id, label, action) {
    return uiButton(`settings-${id}`, label, (_e, cx) => { action(); cx.notify(); }, { small: true, disabled: this.saving }).w(26).px(0);
  }
  label(text, child, t) {
    return v_flex().gap(8).child(div().text_color(t.foreground).child(T(text))).child(child);
  }
  preview(t, editor = false, terminal = false) {
    const family = this.draft[editor ? "editorFont" : terminal ? "terminalFont" : "uiFont"];
    const size = this.draft[editor ? "editorSize" : terminal ? "terminalSize" : "uiSize"];
    return v_flex().mt(12).p(16).gap(8).min_h(130).rounded(4).border_1().border_color(t.input).bg(t.background)
      .font_family(family).text_size(size).text_color(editor || terminal ? "#BCBEC4" : t.foreground)
      .child(editor ? "class Application {" : terminal ? "~/project  main" : T("Project"))
      .child(editor ? '    val message = "Hello, world!"' : terminal ? "$ ./gradlew test" : "  src / main / kotlin")
      .child(editor ? "}" : terminal ? "BUILD SUCCESSFUL" : T("Search Everywhere"));
  }

  body(t, cx) {
    if (this.page === "appearance") return v_flex().gap(20)
      .child(this.label("Theme:", div().h(28).px(10).flex().items_center().rounded(4).border_1().border_color(t.input).child("Codebench Dark"), t))
      .child(this.label("Interface font:", this.field("uiFont", "uiSize", t), t))
      .child(uiCheckbox("settings-compact", T("Compact mode"), (_e, cx) => { this.draft.compact = !this.draft.compact; cx.notify(); },
        { checked: this.draft.compact, disabled: this.saving }))
      .child(this.label("Zoom:", uiToolbar("settings-zoom", [
        button("settings-zoom-out", "−", () => run("app.zoom_out")),
        div().w(50).text_center().child(`${Math.round((Number(settings().zoom) || 1) * 100)}%`),
        button("settings-zoom-in", "+", () => run("app.zoom_in")),
        button("settings-zoom-reset", T("Reset"), () => run("app.zoom_reset")),
      ]), t))
      .child(this.preview(t));
    if (this.page === "editor" || this.page === "terminal") {
      const editor = this.page === "editor";
      return v_flex().gap(18)
        .child(this.label("Font:", this.field(editor ? "editorFont" : "terminalFont", editor ? "editorSize" : "terminalSize", t), t))
        .child(this.preview(t, editor, !editor));
    }
    if (this.page === "lsp") return v_flex().gap(12)
      .child(uiCaption(T("Choose a language, install its SDK and language server, then check and start it.")))
      .child(uiButton("settings-lsp-setup", T("Open Installation Guide"), () => openLspSetup()));
    if (this.page === "windows") return this.windowsBody(cx);
    if (this.page === "database") return v_flex().gap(12)
      .child(uiCaption(T("Data sources are shared across projects.")))
      .child(uiCaption(T("Saved passwords are managed by the operating system credential store.")))
      .child(uiButton("settings-database-manage", T("Manage Data Sources"), () => openDatabaseManager()));
    if (this.page === "notifications") return this.notificationsBody();
    return this.keymapBody(cx);
  }

  windowTools(side = this.toolSide) {
    return orderedTools(Object.keys(TOOLS).filter(name => this.draft.toolSides[name] === side), this.draft.toolOrder[side]);
  }
  moveWindowTool(name, to, cx) {
    if (!TOOLS[name] || !SIDES[to] || this.saving) return;
    this.draft.toolSides[name] = to;
    for (const side of Object.keys(SIDES)) this.draft.toolOrder[side] = this.draft.toolOrder[side].filter(item => item !== name);
    this.draft.toolOrder[to].push(name);
    this.toolSide = to; cx.notify();
  }
  reorderWindowTool(name, direction, cx) {
    const items = this.windowTools(), at = items.indexOf(name), to = at + direction;
    if (this.saving || at < 0 || to < 0 || to >= items.length) return;
    [items[at], items[to]] = [items[to], items[at]];
    this.draft.toolOrder[this.toolSide] = items; cx.notify();
  }
  windowPosition(name, cx) {
    const side = this.draft.toolSides[name];
    const changeOpen = (open, eventCx) => {
      this.windowPositionOpen = open;
      if (open) { this.windowPositionMenu.at = Object.keys(SIDES).indexOf(side); this.windowPositionMenu.ensureVisible(); this.windowPositionMenu.focus.focus(); }
      else this.windowPositionFocus.focus();
      eventCx.notify();
    };
    const rows = Object.entries(SIDES).map(([id, info]) => ({ id, label: T(info.label), icon: () => icon(id === side ? "check" : "columns-2", 14),
      action: (_e, eventCx) => { this.moveWindowTool(name, id, eventCx); this.windowMenu.ensureVisible(this.windowRows().findIndex(row => row.id === name)); } }));
    const trigger = uiButton("settings-window-position", T(SIDES[side]?.label ?? side),
      (_e, eventCx) => changeOpen(!this.windowPositionOpen, eventCx), { small: true, disabled: this.saving }).w_full().gap(8).child(icon("chevron-down", 12));
    return Select.new("settings-window-position-select").accessibility_label(T("Position"))
      .open(this.windowPositionOpen).track_focus(this.windowPositionFocus).content_focus_handle(this.windowPositionMenu.focus).on_open_change(changeOpen)
      .child(Popup.new("settings-window-position-popup", trigger).anchor("bottom_left")
        .when(this.windowPositionOpen, el => el.content(uiMenu("settings-window-positions", rows, this.windowPositionMenu, cx,
          { width: 220, maxHeight: 220, onClose: (_e, eventCx) => changeOpen(false, eventCx) }))));
  }
  windowRows() {
    return Object.entries(SIDES).flatMap(([side, info]) => this.windowTools(side).map(name => ({ id: name, label: T(TOOLS[name].label),
      detail: `${T(info.label)}${this.draft.toolHidden.includes(name) ? ` · ${T("Hidden")}` : ""}`, icon: () => toolImage(TOOLS[name].idea, 16) })))
      .filter(row => !this.windowQuery || `${row.label} ${row.detail}`.toLowerCase().includes(this.windowQuery));
  }
  windowsBody(cx) {
    const name = this.windowSelected, side = this.draft.toolSides[name], items = this.windowTools(side), at = items.indexOf(name);
    const hidden = this.draft.toolHidden.includes(name), disabled = Boolean(this.saving), filtered = Boolean(this.windowQuery);
    const move = (direction, eventCx) => {
      this.toolSide = this.draft.toolSides[this.windowSelected]; this.reorderWindowTool(this.windowSelected, direction, eventCx);
      this.windowMenu.ensureVisible(this.windowRows().findIndex(row => row.id === this.windowSelected));
    };
    const actions = [
      { id: "show", label: T("Show on Stripe"), icon: () => icon("plus", 16), disabled: disabled || !hidden, action: (_e, eventCx) => this.toggleWindowTool(name, eventCx) },
      { id: "hide", label: T("Hide Tool Window"), icon: () => icon("minus", 16), disabled: disabled || hidden, action: (_e, eventCx) => this.toggleWindowTool(name, eventCx) },
      { id: "move-up", label: T("Move Up"), icon: () => icon("arrow-up", 16), disabled: disabled || filtered || at <= 0, shortcut: "Alt+↑", action: (_e, eventCx) => move(-1, eventCx) },
      { id: "move-down", label: T("Move Down"), icon: () => icon("arrow-down", 16), disabled: disabled || filtered || at < 0 || at >= items.length - 1, shortcut: "Alt+↓", action: (_e, eventCx) => move(1, eventCx) },
      { id: "restore", label: T("Restore Tool Window Layout"), icon: () => icon("undo", 16), disabled, action: (_e, eventCx) => this.restoreWindowTools(eventCx) },
    ];
    return h_flex().h_full().min_h(0).min_w(0).border_1().border_color(uiColors().border)
      .child(div().w(290).flex_none().h_full().min_h(0).border_r(1).border_color(uiColors().separator)
        .child(uiManagedList("settings-window-list", this.windowRows(), this.windowMenu, cx, {
          selectedId: name, onSelect: (id, _e, eventCx) => { this.windowSelected = id; this.toolSide = this.draft.toolSides[id]; this.windowPositionOpen = false; eventCx.notify(); },
          actions, search: uiInputBox(Input.new(this.windowSearch)), caption: `${T("Tool Windows")} · ${Object.keys(TOOLS).length}`,
        })))
      .child(v_flex().flex_1().min_w(0).gap(14).p(16)
        .child(div().font_semibold().child(T(TOOLS[name]?.label ?? "Tool Window")))
        .child(uiCheckbox(`settings-window-${name}-visible`, T("Show on Stripe"), (_e, eventCx) => this.toggleWindowTool(name, eventCx), { checked: !hidden, disabled }))
        .child(uiCaption(T("Position"))).child(this.windowPosition(name, cx))
        .child(uiCaption(T("Reorder within a position using the toolbar. Choose a position to move the tool.")))
        .child(uiCaption(T("Changes take effect with Apply."))));
  }
  mergedToolOrder(draft) {
    const before = JSON.parse(this.saved).toolOrder, edited = copy(this.savedRawToolOrder);
    for (const side of Object.keys(SIDES)) {
      if (JSON.stringify(before[side]) === JSON.stringify(draft.toolOrder[side])) continue;
      const future = (this.savedRawToolOrder[side] ?? []).filter(name => !TOOLS[name]);
      edited[side] = [...draft.toolOrder[side], ...future];
    }
    return mergeCustomization({ groups: this.savedRawToolOrder }, { groups: edited }, { groups: shared("codenav.toolOrder") ?? {} }).groups;
  }
  restoreWindowTools(cx) {
    this.draft.toolSides = { ...this.draft.toolSides, ...DEFAULT_SIDES };
    this.draft.toolOrder = Object.fromEntries(Object.keys(SIDES).map(side => [side, Object.keys(TOOLS).filter(name => DEFAULT_SIDES[name] === side)]));
    this.draft.toolHidden = this.draft.toolHidden.filter(name => !TOOLS[name]);
    this.restoreToolLayout = true; cx.notify();
  }

  toggleWindowTool(name, cx) {
    if (this.saving || !TOOLS[name]) return;
    const hidden = new Set(this.draft.toolHidden);
    hidden.has(name) ? hidden.delete(name) : hidden.add(name);
    this.draft.toolHidden = [...hidden]; cx.notify();
  }

  notificationsBody() {
    const c = uiColors();
    return v_flex().gap(12)
      .child(uiCaption(T("Choose how each notification group appears. Herdr sound preferences also apply.")))
      .child(v_flex().border_1().border_color(c.separator).rounded(4).overflow_hidden()
        .child(h_flex().h(28).px(10).gap(8).items_center().text_color(c.secondary)
          .child(div().flex_1().child(T("Notification Group"))).children(["Popup", "Timeline", "Sound"].map(label => div().w(85).child(T(label)))))
        .children(NOTIFICATION_GROUPS.map(group => {
          const policy = { ...group.defaults, ...(this.notificationPolicy.groups?.[group.id] ?? {}) };
          return h_flex().h(34).px(10).gap(8).items_center().child(div().flex_1().child(T(group.label)))
            .children(["popup", "log", "sound"].map(field => uiCheckbox(`notify-policy-${group.id}-${field}`, "", (_e, cx) => {
              this.notificationPolicy.groups = { ...(this.notificationPolicy.groups ?? {}), [group.id]: { ...(this.notificationPolicy.groups?.[group.id] ?? {}), [field]: !policy[field] } }; cx.notify();
            }, { checked: policy[field], disabled: this.saving }).w(85)));
        })))
      .child(uiButton("notify-policy-restore", T("Restore Defaults"), (_e, cx) => {
        this.notificationPolicy = restoreKnownGroups(this.notificationPolicy, Object.fromEntries(NOTIFICATION_GROUPS.map(group => [group.id, {}]))); cx.notify();
      }, { disabled: this.saving }))
      .child(uiCaption(T("Herdr agent notifications keep their native notification path. These options control the mode timeline and additional popups.")));
  }

  keymapRows() {
    return this.bindings().filter(row => !this.keyQuery || `${row.label} ${row.action} ${row.group} ${row.section} ${row.chords.join(" ")} ${row.chords.map(formatShortcut).join(" ")}`.toLowerCase().includes(this.keyQuery));
  }
  selectBinding(id, cx) {
    const row = this.bindings().find(item => item.id === id);
    this.selectedBinding = row?.id ?? null;
    this.selectedChord = row?.chords[0] ?? null;
    this.capturing = false; this.error = null; cx.notify();
  }
  // Display effective Herdr bindings verbatim; never globally remap Ctrl to Cmd.
  keymapBody(cx) {
    const c = uiColors(), rows = this.keymapRows(), selected = rows.find(row => row.id === this.selectedBinding);
    const actions = [
      { id: "add", label: T("Add Shortcut…"), icon: () => icon("plus", 14), action: (_e, eventCx) => this.beginShortcut(eventCx), disabled: !selected || this.saving },
      { id: "replace", label: T("Change Shortcut…"), icon: () => icon("pencil", 14), action: (_e, eventCx) => this.beginShortcut(eventCx, "replace"), disabled: !selected?.chords.includes(this.selectedChord) || this.saving },
      { id: "remove", label: T("Remove Shortcut"), icon: () => icon("minus", 14), action: (_e, eventCx) => this.removeShortcut(eventCx), disabled: !selected?.chords.includes(this.selectedChord) || this.saving },
    ];
    return h_flex().h_full().min_h(0).min_w(0).border_1().border_color(c.border)
      .child(div().w(370).h_full().min_h(0).flex_none().border_r(1).border_color(c.separator)
        .child(uiManagedList("settings-keymap-list", rows.map(row => ({ id: row.id, label: row.label,
          detail: row.chords.length ? row.chords.map(formatShortcut).join(", ") : T(row.group), icon: () => icon("key", 16) })), this.keyMenu, cx, {
          selectedId: this.selectedBinding, onSelect: (id, _event, eventCx) => this.selectBinding(id, eventCx),
          actions, search: uiInputBox(Input.new(this.keySearch)), caption: T("Keymap"),
        })))
      .child(v_flex().flex_1().min_w(0).h_full().min_h(0).p(16).gap(12).overflow_y_scrollbar()
        .when(!selected, el => el.child(uiCaption(T("No matching shortcuts"))))
        .when(Boolean(selected), el => el
          .child(div().font_semibold().child(selected?.label))
          .child(uiCaption(`${T(selected?.group ?? "Other")} · ${selected?.section ?? ""}`))
          .child(div().text_size(uiSize(11)).text_color(c.secondary).child(selected?.action ?? ""))
          .child(uiCaption(T("Assigned Shortcuts")))
          .child(v_flex().id("keymap-assigned-shortcuts").gap(2).children(selected?.chords.length ? selected.chords.map((chord, index) =>
            uiListRow(`keymap-chord-${index}`, [formatShortcut(chord)], { selected: chord === this.selectedChord,
              onClick: (_e, eventCx) => { this.selectedChord = chord; this.capturing = false; this.error = null; eventCx.notify(); } }))
            : [uiCaption(T("No shortcut assigned"))]))
          .when(Boolean(this.capturing), detail => detail.child(v_flex().gap(8)
            .child(uiCaption(T(this.shortcutMode === "replace" ? "Change Shortcut…" : "Add Shortcut…")))
            .child(uiCaption(T("Type a shortcut such as cmd-shift-o, or record it.")))
            .child(uiInputBox(Input.new(this.shortcutInput).text_size(uiSize())))
            .child(h_flex().gap(6).flex_wrap()
              .child(uiButton("keymap-record", T("Record Shortcut"), (_e, eventCx) => { this.shortcutFocus.focus(); eventCx.notify(); }, { disabled: this.saving })
                .track_focus(this.shortcutFocus).on_key_down((event, eventCx) => this.captureShortcut(event, eventCx)))
              .child(uiButton("keymap-shortcut-add", T(this.shortcutMode === "replace" ? "Change" : "Add"), (_e, eventCx) => this.stageShortcut(eventCx), { disabled: !this.newShortcut || this.saving }))
              .child(uiButton("keymap-shortcut-cancel", T("Cancel"), (_e, eventCx) => { this.capturing = false; this.error = null; this.focus.focus(); eventCx.notify(); })))))
          .child(uiCaption(this.pendingBindings.length ? T("Shortcut changes will be saved with Apply.") : T("Select an action to add, change or remove a shortcut.")))));
  }

  sidebar() {
    const c = uiColors(), result = [];
    const pages = PAGES.filter(page => !this.query || page.join(" ").toLowerCase().includes(this.query) || T(page[1]).includes(this.query) || T(page[2]).includes(this.query));
    for (const group of [...new Set(pages.map(page => page[1]))]) {
      if (group === "Keymap") {
        result.push(uiTreeRow("settings-page-keymap", T("Keymap"), { selected: this.page === "keymap", onClick: (_e, cx) => { this.page = "keymap"; cx.notify(); } }));
        continue;
      }
      const expanded = !this.sidebarCollapsed.has(group) || Boolean(this.query);
      result.push(uiTreeRow(`settings-group-${group}`, T(group), { expanded, onClick: (_e, cx) => {
        this.sidebarCollapsed.has(group) ? this.sidebarCollapsed.delete(group) : this.sidebarCollapsed.add(group); cx.notify();
      } }));
      if (expanded) for (const [id, , label] of pages.filter(page => page[1] === group)) result.push(uiTreeRow(`settings-page-${id}`, T(label), { depth: 1, selected: this.page === id,
        onClick: (_e, cx) => { this.page = id; cx.notify(); } }));
    }
    return v_flex().h_full().min_h(0).gap(8).text_color(c.foreground)
      .child(uiInputBox(h_flex().min_w(0).gap(4).items_center().child(icon("search", 13)).child(Input.new(this.search).text_size(uiSize()))).mx(8).mt(8).flex_none())
      .child(v_flex().id("settings-tree").flex_1().min_h(0).overflow_y_scrollbar().children(result));
  }

  render(cx) {
    const t = theme(), c = uiColors(), current = PAGES.find(([id]) => id === this.page);
    const dirty = JSON.stringify(this.draft) !== this.saved || Boolean(this.pendingBindings.length) || Boolean(this.restoreToolLayout)
      || JSON.stringify(this.notificationPolicy) !== JSON.stringify(this.savedNotificationPolicy);
    const content = v_flex().h_full().min_h(0).gap(18).text_color(c.foreground)
      .child(div().flex_none().h(24).font_semibold().text_size(uiSize()).child(T(this.page === "keymap" ? "Keymap" : current[2])))
      .child(v_flex().id("settings-body").flex_1().min_h(0)
        .when(!["keymap", "windows"].includes(this.page), el => el.overflow_y_scrollbar())
        .child(this.body(t, cx)))
      .when(Boolean(this.error), el => el.child(div().flex_none().text_color(c.error).child(this.error)));
    const footer = [
      uiButton("settings-cancel", T("Cancel"), () => closeOverlay(props().overlay), { disabled: this.saving }),
      uiButton("settings-apply", T("Apply"), (_e, cx) => this.apply(cx), { disabled: !dirty || this.saving }),
      uiButton("settings-ok", T(this.saving ? "Saving…" : "OK"), (_e, cx) => this.apply(cx, true), { primary: true, disabled: this.saving }),
    ];
    return uiSettingsShell("idea-settings", { title: T("Settings"), sidebar: this.sidebar(), content, footer, width: 900, height: 700, sidebarWidth: 145 })
      .track_focus(this.focus).on_key_down((event, cx) => {
        if (event.key === "escape") {
          if (this.capturing) { this.capturing = false; this.error = null; this.focus.focus(); cx.notify(); }
          else if (!this.saving) closeOverlay(props().overlay);
          cx.stop_propagation();
        }
      });
  }
}

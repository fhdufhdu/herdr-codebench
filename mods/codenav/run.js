// Run configurations, as IntelliJ's run widget (the idea layout's toolbar, top
// right): a named command per project, run in its own terminal tab ("▶ name")
// of the space; running again uses that tab, asking first when something
// still runs there.
// Kept in shared "codenav.run" by project folder: { configs: [{name, command,
// folder}], selected }. runmenu is the widget's popup, runconfigs the editor.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, spaces, panes, terminals, run, props, closeOverlay, openOverlay, hc, exec } from "herdr";
import { T } from "./i18n.js";
import { IDEA, isIdea, uiSize, popupSurface, MenuController, uiMenu, uiDialog, uiInputBox, uiButton, uiManagedList, uiCaption, uiSeparator, uiNotify } from "./idea-design.js";
import { tilde, icon, codeFont, uiFontFamily, editorKey } from "./common.js";
import { toolImage } from "./ideaicons.js";
import { beginExecution, updateExecution, executionStore, executionBusy, interruptExecution, releaseExecution, inspectExecutionTerminal } from "./execution-results.js";
import { launchRunProcess } from "./run-process.js";

const KEY = "codenav.run";
const project = () => { const s = spaces().find((x) => x.active); return s ? `${s.machine ?? ""}:${s.folder}` : null; };
const activeSpace = () => spaces().find(s => s.active)?.id ?? null;
const sessionScope = () => `${project()}@${activeSpace()}`;
export const runStore = () => (shared(KEY) ?? {})[project()] ?? { configs: [], selected: 0 };
function saveRun(patch, k = project()) {
  if (!k) return;
  setShared(KEY, { ...(shared(KEY) ?? {}), [k]: { ...((shared(KEY) ?? {})[k] ?? { configs: [], selected: 0 }), ...patch } });
}
export const tabName = (c) => `▶ ${c.name}`;
const configKey = c => c?.id ?? `legacy:${c?.name ?? ""}`;
const newId = () => `run.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
export const configTab = c => {
  if (!c) return null;
  const tabs = spaces().find(s => s.active)?.tabs ?? [], sessions = (shared("codenav.runSessions") ?? {})[sessionScope()] ?? {};
  const attached = sessions[configKey(c)]?.tab;
  if (attached) return tabs.find(tab => tab.id === attached) ?? null;
  // Adopt a pre-ID configuration's existing terminal once; never claim a new
  // configuration's unrelated same-name tab or an ambiguous legacy terminal.
  const legacy = c.id ? c.legacyTabName : tabName(c);
  if (!legacy) return null;
  const matches = tabs.filter(tab => tab.name === legacy);
  const configs = runStore().configs.filter(item => (item.id ? item.legacyTabName : tabName(item)) === legacy);
  if (matches.length !== 1 || configs.length > 1) return null;
  const claimed = Object.entries(sessions).some(([id, session]) => id !== configKey(c) && id !== `legacy:${legacy.slice(2)}` && session.tab === matches[0].id);
  return claimed ? null : matches[0];
};
const tabTerminal = (tab) => tab && panes().find((p) => p.tab === tab.id && p.terminal);
// Something other than the shell runs in the configuration's tab.
export const isRunning = (c) => {
  const p = tabTerminal(configTab(c)), session = (shared("codenav.runSessions") || {})[sessionScope()]?.[configKey(c)];
  if (isIdea() && session?.processOwned) {
    const entries = executionStore().entries;
    if (entries.some(entry => entry.configuration === configKey(c) && executionBusy(entry))) return true;
    if (session.nativeState === "finished" || entries.find(entry => entry.id === session.executionId)?.nativeState === "finished") return false;
    return (terminals() || []).some(terminal => terminal.address === session.terminal && terminal.state === "live");
  }
  return Boolean(p && p.program && !p.program.shell) || isIdea() && (Boolean(p && session?.untracked && p.terminal === session.terminal) || executionStore().entries.some(entry => entry.configuration === configKey(c) && executionBusy(entry)));
};
export const openRunConfigs = () => openOverlay({ mod: "codenav", props: { view: "runconfigs" }, kind: "dialog", ...(isIdea() ? { frame: "none" } : {}), width: 880, height: 580 });

// "A=1; B=two words" before the command, through env, so a compound command gets them too.
const quote = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`;
function withEnv(c) {
  const vars = (c.env ?? "").split(/[;\n]/).map((x) => x.trim()).filter((x) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(x));
  if (!vars.length) return c.command;
  return `env ${vars.map((v) => { const i = v.indexOf("="); return `${v.slice(0, i)}=${quote(v.slice(i + 1))}`; }).join(" ")} sh -c ${quote(c.command)}`;
}

const pause = (sec) => exec("sleep", [String(sec)]).catch(() => {});

// Runs a configuration in its tab: made the first time (a shell in the folder),
// reused after; something still running there asks before it is stopped.
export function runConfig(c, after) {
  if (!c?.command) return openRunConfigs();
  if (isRunning(c)) {
    setShared("codenav.runPending", { config: c, project: project(), space: activeSpace() });
    return openOverlay({ mod: "confirm", kind: "dialog", width: 420, height: 170,
      props: { title: T("'{name}' is still running", { name: c.name }), detail: T("Stop it and run it again?"), command: { name: "codenav.run-restart" } } });
  }
  return start(c, after);
}
// The confirmation's answer: stop what runs, then run again.
export async function restartPending(after) {
  const pending = shared("codenav.runPending");
  if (!pending) return;
  setShared("codenav.runPending", null);
  const c = pending.config ?? pending;
  const samePlace = () => (!pending.project || pending.project === project()) && (!pending.space || pending.space === activeSpace());
  if (!samePlace()) { uiNotify({ group: "codenav.run", title: T("Run cancelled"), body: T("Switch back to this project to run."), level: "warning" }); return; }
  await stopConfig(c);
  if (!samePlace()) return;
  if (isRunning(c)) return;
  return start(c, after);
}
const starting = new Set();
async function startIdea(c) {
  const scope = editorKey(), space = spaces().find(item => item.active), snapshot = { ...c };
  const entryId = beginExecution({ kind: "shell", processOwned: true, launching: true, name: snapshot.name, command: snapshot.command,
    folder: snapshot.folder || space?.folder || "", machine: space?.machine || null, configuration: configKey(snapshot) }, scope, { claim: true });
  try {
    const initial = executionStore(scope).entries.find(entry => entry.id === entryId);
    const terminal = await launchRunProcess(initial, withEnv(snapshot));
    const key = `${space?.machine || ""}:${space?.folder}@${space?.id}`, sessions = shared("codenav.runSessions") || {};
    setShared("codenav.runSessions", { ...sessions, [key]: { ...(sessions[key] || {}), [configKey(snapshot)]: { configuration: configKey(snapshot), executionId: entryId, terminal, processOwned: true, startedAt: initial.startedAt } } });
    updateExecution(entryId, { terminal, launching: false, state: "running" }, scope);
    const pending = executionStore(scope).entries.find(entry => entry.id === entryId);
    if (pending.stopRequested) await interruptExecution(pending, scope);
    for (;;) {
      const entry = executionStore(scope).entries.find(item => item.id === entryId);
      if (!executionBusy(entry)) break;
      updateExecution(entryId, await inspectExecutionTerminal(entry), scope);
      if (!executionBusy(executionStore(scope).entries.find(item => item.id === entryId))) break;
      await pause(0.3);
    }
  } catch (error) {
    updateExecution(entryId, { state: "error", launching: false, error: String(error.message ?? error) }, scope);
    uiNotify({ group: "codenav.run", title: T("Run failed"), body: String(error.message ?? error), level: "error" });
  } finally { releaseExecution(entryId, scope); }
}
async function start(c, after) {
  if (isIdea()) return startIdea(c);
  const key = sessionScope(), executionId = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`, launchKey = `${key}:${configKey(c)}`;
  if (starting.has(launchKey)) return;
  starting.add(launchKey);
  try {
    let tab = configTab(c);
    if (!tab) {
      const previous = new Set((spaces().find(s => s.active)?.tabs ?? []).map(item => item.id));
      run("tab.new", { name: tabName(c), folder: c.folder || spaces().find(s => s.active)?.folder });
      for (let i = 0; i < 30; i++) {
        if (sessionScope() !== key) return;
        const created = (spaces().find(s => s.active)?.tabs ?? []).filter(item => !previous.has(item.id) && item.name === tabName(c));
        if (created.length > 1) throw new Error(T("Could not identify the new run terminal."));
        tab = created[0];
        if (tabTerminal(tab)) break;
        await pause(0.15);
      }
    } else run("tab.select", { id: tab.id });
    if (sessionScope() !== key) return;
    const term = tabTerminal(tab)?.terminal;
    if (!term) throw new Error(T("Could not open the run terminal."));
    const sessions = shared("codenav.runSessions") ?? {};
    setShared("codenav.runSessions", { ...sessions, [key]: { ...(sessions[key] ?? {}), [configKey(c)]: { ...(sessions[key]?.[configKey(c)] ?? {}), configuration: configKey(c), executionId, tab: tab.id, terminal: term, startedAt: Date.now() } } });
    after?.();
    const result = await hc(["send", term, withEnv(c)]);
    if (result?.code) throw new Error(result.stderr || T("Could not start the run configuration."));
  } catch (error) { uiNotify({ group: "codenav.run", title: T("Run failed"), body: String(error.message ?? error), level: "error" }); }
  finally { starting.delete(launchKey); }
}
// Stops what runs in the configuration's tab (Ctrl+C, twice if it lingers); the tab stays.
export async function stopConfig(c) {
  const session = (shared("codenav.runSessions") || {})[sessionScope()]?.[configKey(c)];
  const owned = isIdea() && (executionStore().entries.find(entry => entry.configuration === configKey(c) && entry.processOwned && executionBusy(entry)) ||
    (session?.processOwned && isRunning(c) ? { ...session, id: session.executionId } : null));
  if (owned) {
    try {
      const scope = editorKey(), key = sessionScope();
      const status = await interruptExecution(owned, scope);
      if (status?.nativeState === "finished") {
        const sessions = shared("codenav.runSessions") || {};
        setShared("codenav.runSessions", { ...sessions, [key]: { ...sessions[key], [configKey(c)]: { ...sessions[key]?.[configKey(c)], nativeState: "finished" } } });
      }
      for (let i = 0; i < 30 && executionStore(scope).entries.some(entry => entry.id === owned.id && executionBusy(entry)); i++) await pause(0.1);
    }
    catch (error) { uiNotify({ group: "codenav.run", title: T("Stop failed"), body: String(error.message ?? error), level: "warning" }); }
    return;
  }
  const term = tabTerminal(configTab(c))?.terminal;
  if (!term) return;
  if (isIdea()) {
    const scope = editorKey(), session = (shared("codenav.runSessions") || {})[sessionScope()]?.[configKey(c)];
    const entry = executionStore(scope).entries.find(entry => entry.terminal === term && (executionBusy(entry) || entry.state === "untracked")) || (session?.untracked ? { terminal: term, configuration: configKey(c), state: "untracked" } : null);
    if (entry) {
      try { await interruptExecution(entry, scope); }
      catch (error) { uiNotify({ group: "codenav.run", title: T("Stop failed"), body: String(error.message ?? error), level: "warning" }); return; }
      for (let i = 0; i < 15 && executionStore(scope).entries.some(item => item.id === entry.id && executionBusy(item)); i++) await pause(0.1);
      return;
    }
  }
  await hc(["interrupt", term]).catch(() => {});
  for (let i = 0; i < 10 && tabTerminal(configTab(c))?.program && !tabTerminal(configTab(c)).program.shell; i++) await pause(0.2);
  if (tabTerminal(configTab(c))?.program && !tabTerminal(configTab(c)).program.shell) { await hc(["keys", term, "ctrl+c"]).catch(() => {}); await pause(0.5); }
}

// The widget's popup: pick a configuration, or edit them.
export class RunMenu {
  init(_p, cx) {
    this.menu = new MenuController(cx, runStore().selected ?? 0);
    this.menu.focus.focus();
  }
  release() { this.menu.release(); this.menu.focus.release(); }
  render(cx) {
    const st = runStore(), done = () => closeOverlay(props()?.overlay);
    const rows = st.configs.map((c, i) => ({ id: `rm-c${i}`, label: c.name, icon: () => toolImage("run", 14), shortcut: c.command,
      action: () => saveRun({ selected: i }) }));
    if (rows.length) rows.push({ separator: true });
    rows.push({ id: "rm-edit", label: T("Edit Configurations…"), icon: () => toolImage("settings", 14), action: () => openRunConfigs() });
    return uiMenu("run-menu", rows, this.menu, cx, { width: 320, maxHeight: 400, onClose: done });
  }
}

// The editor, laid out as IntelliJ's Run/Debug Configurations: the project's
// configurations as a tree on the left (one kind: shell commands), the chosen
// one's fields on the right, Run / Cancel / Apply / OK below.
const FIELDS = ["name", "command", "folder", "env"];
export class RunConfigs {
  init(_p, cx) {
    this.focus = cx.focus_handle();
    this.projectKey = project();
    const space = spaces().find(s => s.active);
    this.projectSpace = space ? { id: space.id, machine: space.machine, folder: space.folder } : null;
    const st = runStore();
    this.configs = st.configs.map((c) => c.id ? { ...c } : { ...c, id: newId(), legacyTabName: tabName(c) });
    this.saved = JSON.stringify(this.configs);
    this.at = Math.min(st.selected ?? 0, Math.max(this.configs.length - 1, 0));
    this.list = new MenuController(cx, this.at);
    this.search = InputState.new({ placeholder: T("Search") });
    this.search.on("change", (_event, eventCx) => eventCx.notify());
    this.inputs = {
      name: InputState.new({ placeholder: T("Name") }),
      command: InputState.new({ placeholder: "./gradlew bootRun" }),
      folder: InputState.new({ placeholder: T("The project's folder") }),
      env: InputState.new({ placeholder: "SPRING_PROFILES_ACTIVE=local; PORT=8080" }),
    };
    for (const f of FIELDS) this.inputs[f].on("change", (_e, cx) => { if (this.configs[this.at]) { this.configs[this.at][f] = this.inputs[f].value(); cx.notify(); } });
    this.load();
    if (isIdea()) {
      if (this.configs.length) this.inputs.name.focus(); else this.focus.focus();
      for (const f of FIELDS) this.inputs[f].on("submit", () => { this.apply(); closeOverlay(props()?.overlay); });
    }
  }
  release() {
    this.focus.release(); this.list.release(); this.list.focus.release(); this.search.release();
    for (const input of Object.values(this.inputs)) input.release();
  }
  load() {
    const c = this.configs[this.at] ?? {};
    for (const f of FIELDS) this.inputs[f].set_value(c[f] ?? "");
  }
  add(copy) {
    const base = copy && this.configs[this.at] ? { ...this.configs[this.at], name: T("{name} (copy)", { name: this.configs[this.at].name }) }
      : { name: T("Unnamed"), command: "", folder: "", env: "" };
    base.id = newId(); delete base.legacyTabName;
    this.configs.push(base); this.at = this.configs.length - 1; this.load(); this.inputs.name.focus();
  }
  apply() {
    const configs = this.configs.filter((c) => c.name?.trim() || c.command?.trim());
    saveRun({ configs, selected: Math.min(this.at, Math.max(configs.length - 1, 0)) }, this.projectKey);
    this.saved = JSON.stringify(this.configs);
  }

  renderIdea(cx) {
    const t = theme(), c = this.configs[this.at], space = this.projectSpace;
    const dirty = JSON.stringify(this.configs) !== this.saved, sameProject = project() === this.projectKey;
    const done = () => closeOverlay(props()?.overlay);
    const field = (label, element, hint) => v_flex().flex_none().gap(4)
      .child(h_flex().flex_none().min_w(0).gap(10).items_center()
        .child(div().w(100).flex_none().child(label))
        .child(div().flex_1().min_w(0).child(element)))
      .when(Boolean(hint), el => el.child(div().pl(110).text_size(uiSize(11)).text_color(t.dim).child(hint)));
    const input = (name, mono = false) => uiInputBox(Input.new(this.inputs[name]), { mono }).w_full();
    const query = this.search.value().trim().toLocaleLowerCase();
    const select = id => { this.at = this.configs.findIndex(config => config.id === id); this.load(); };
    const move = step => {
      const to = this.at + step;
      if (query || to < 0 || to >= this.configs.length) return;
      [this.configs[this.at], this.configs[to]] = [this.configs[to], this.configs[this.at]];
      this.at = to; this.list.at = to; this.list.ensureVisible();
    };
    const action = (id, label, graphic, callback, disabled = false) => ({ id, label: T(label), icon: () => icon(graphic, 16), action: (_event, eventCx) => { callback(); eventCx.notify(); }, disabled });
    const left = v_flex().w(250).flex_none().h_full().min_h(0).border_r(1).border_color(t.border)
      .child(uiManagedList("rc-list", this.configs.filter(config => `${config.name}\n${config.command}`.toLocaleLowerCase().includes(query)).map(config => ({ id: config.id, label: config.name?.trim() || T("Unnamed"), detail: config.command, icon: () => toolImage("runAction", 15) })), this.list, cx, {
        selectedId: c?.id, onSelect: select, onActivate: () => this.inputs.name.focus(), onClose: done,
        search: uiInputBox(Input.new(this.search)), caption: T("Saved per project"),
        actions: [
          action("add", "Add New Configuration", "add", () => { this.search.set_value(""); this.add(false); }),
          action("remove", "Remove Configuration", "remove", () => { this.configs.splice(this.at, 1); this.at = Math.max(0, this.at - 1); this.load(); }, !c),
          action("copy", "Copy Configuration", "copy", () => { this.search.set_value(""); this.add(true); }, !c),
          action("edit", "Edit", "edit", () => this.inputs.name.focus(), !c),
          action("move-up", "Move Up", "up", () => move(-1), !!query || !c || this.at === 0),
          action("move-down", "Move Down", "down", () => move(1), !!query || !c || this.at === this.configs.length - 1),
        ],
      }));
    const right = !c ? v_flex().flex_1().min_w(0).min_h(0).items_center().justify_center().gap(12)
      .child(uiCaption(T("No run configurations yet.")))
      .child(uiButton("rc-first", T("Add New Configuration"), (_event, cx) => { this.add(false); cx.notify(); }))
      : v_flex().id("rc-fields").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().px(18).py(14).gap(14)
        .child(field(T("Name:"), input("name")))
        .child(field(T("Run on:"), uiInputBox(h_flex().min_w(0).gap(6).items_center().child(toolImage(space?.machine ? "terminal" : "homeFolder", 15)).child(div().truncate().child(space?.machine ?? T("Local machine")))), T("Runs in this project's own terminal tab; running it again reuses the tab.")))
        .child(uiSeparator())
        .child(field(T("Command:"), input("command", true), T("Run by the shell as typed, e.g. ./gradlew bootRun or npm run dev")))
        .child(field(T("Working directory:"), input("folder", true), tilde(c.folder || space?.folder || "")))
        .child(field(T("Environment:"), input("env", true), T("KEY=value pairs separated by ;")));
    const footer = [
      div().flex_1().min_w(0).truncate().text_size(uiSize(11)).text_color(t.dim).child(sameProject ? "" : T("Switch back to this project to run.")),
      uiButton("rc-run", h_flex().gap(6).items_center().child(toolImage("runAction", 15)).child(T("Run")), () => {
        if (project() !== this.projectKey) return;
        this.apply(); done(); runConfig(this.configs[this.at]);
      }, { disabled: !c?.command || !sameProject, accessibilityLabel: T("Run") }),
      uiButton("rc-cancel", T("Cancel"), done),
      uiButton("rc-apply", T("Apply"), (_event, cx) => { this.apply(); cx.notify(); }, { disabled: !dirty }),
      uiButton("rc-ok", T("OK"), () => { this.apply(); done(); }, { primary: true }),
    ];
    return uiDialog("run-configurations", { title: T("Run/Debug Configurations"), body: h_flex().flex_1().h_full().min_h(0).min_w(0).child(left).child(right), footer })
      .h(580).track_focus(this.focus).on_key_down((event, cx) => { if ((event.key ?? event.keystroke) === "escape") { done(); cx.stop_propagation(); } });
  }

  render(cx) {
    if (isIdea()) return this.renderIdea(cx);
    const t = theme(), { overlay } = props() ?? {}, c = this.configs[this.at], dirty = JSON.stringify(this.configs) !== this.saved;
    const space = spaces().find((s) => s.active), mono = codeFont().family;
    const tool = (id, name, tip, action, enabled = true) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(5)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { action(); cx.notify(); }))
      .when(!enabled, (e) => e.opacity(0.35)).tooltip(tip).child(toolImage(name, 16));
    const box = (child, mono_) => div().h(isIdea() ? IDEA.inputHeight : 30).px(9).flex().items_center().rounded(IDEA.controlRadius).border_1().border_color(t.input).bg(t.background)
      .when(Boolean(mono_), (e) => e.font_family(mono)).child(child);
    const row = (label, field, hint) => v_flex().gap(5)
      .child(h_flex().gap(12).items_center()
        .child(div().w(104).flex_none().text_color(t.foreground).child(label))
        .child(div().flex_1().min_w(0).child(field)))
      .when(Boolean(hint), (e) => e.child(div().pl(116).text_size(uiSize(12)).text_color(t.dim).child(hint)));
    const button = (id, children, action, kind) => h_flex().id(id).h(isIdea() ? IDEA.inputHeight : 30).px(16).gap(7).flex_none().items_center().justify_center().rounded(isIdea() ? IDEA.controlRadius : 5).text_size(uiSize(13)).cursor_pointer()
      .when(kind === "solid", (e) => e.bg(t.solid).text_color(t.solid_foreground).hover((s) => s.opacity(0.9)))
      .when(kind !== "solid", (e) => e.border_1().border_color(t.input).text_color(kind === "off" ? t.dim : t.foreground).when(kind !== "off", (x) => x.hover((s) => s.bg(t.hover))))
      .on_click((_e, cx) => { if (kind !== "off") action(cx); }).children(children);
    const done = () => closeOverlay(overlay);

    // the tree
    const left = v_flex().w(270).flex_none().h_full().border_r(1).border_color(t.border)
      .child(h_flex().h(36).flex_none().px(8).gap(2).items_center()
        .child(tool("rc-add", "add", T("Add New Configuration"), () => this.add(false)))
        .child(tool("rc-remove", "remove", T("Remove Configuration"), () => { this.configs.splice(this.at, 1); this.at = Math.max(0, this.at - 1); this.load(); }, Boolean(c)))
        .child(tool("rc-copy", "copy", T("Copy Configuration"), () => this.add(true), Boolean(c))))
      .child(div().h(1).flex_none().bg(t.border))
      .child(div().id("rc-tree").flex_1().min_h(0).py(4).overflow_y_scrollbar()
        .child(h_flex().h(isIdea() ? IDEA.rowHeight : 28).px(10).gap(6).items_center()
          .child(icon(this.configs.length ? "chevron-down" : "chevron-right", 12).text_color(t.muted))
          .child(toolImage("terminal", 16))
          .child(div().font_semibold().child(T("Shell Command"))))
        .children(this.configs.map((x, i) => h_flex().id(`rc-${i}`).h(isIdea() ? IDEA.rowHeight : 28).mx(isIdea() ? 4 : 0).rounded(isIdea() ? IDEA.selectionRadius : 0).pl(36).pr(10).gap(7).items_center().cursor_pointer()
          .bg(i === this.at ? t.selected : "#00000000").hover((e) => e.bg(i === this.at ? t.selected : t.hover))
          .on_click((_e, cx) => { this.at = i; this.load(); cx.notify(); })
          .child(toolImage("runAction", 15))
          .child(div().flex_1().min_w(0).truncate().child(x.name?.trim() || T("Unnamed"))))))
      .child(div().px(14).py(12).text_size(uiSize(12)).text_color(t.dim).child(T("Saved per project")));

    // the fields
    const right = !c ? v_flex().flex_1().items_center().justify_center().gap(12)
        .child(div().text_color(t.dim).child(T("No run configurations yet.")))
        .child(button("rc-first", [toolImage("add", 14), div().child(T("Add New Configuration"))], (cx) => { this.add(false); cx.notify(); }))
      : v_flex().flex_1().min_w(0).px(22).py(18).gap(16)
        .child(row(T("Name:"), box(Input.new(this.inputs.name))))
        .child(row(T("Run on:"), box(h_flex().gap(8).items_center().child(toolImage(space?.machine ? "terminal" : "homeFolder", 15))
          .child(div().child(space?.machine ?? T("Local machine")))),
          T("Runs in this project's own terminal tab; running it again reuses the tab.")))
        .child(div().h(1).bg(t.border))
        .child(row(T("Command:"), box(Input.new(this.inputs.command), true), T("Run by the shell as typed, e.g. ./gradlew bootRun or npm run dev")))
        .child(row(T("Working directory:"), box(Input.new(this.inputs.folder), true), tilde(c.folder || space?.folder || "")))
        .child(row(T("Environment:"), box(Input.new(this.inputs.env), true), T("KEY=value pairs separated by ;")));

    return v_flex().size_full().bg(t.popover).text_color(t.foreground).text_size(uiSize(13)).font_family(uiFontFamily())
      .when(isIdea(), (e) => popupSurface(e, true).p(4))
      .track_focus(this.focus)
      .on_key_down((e, cx) => { if (e.key === "escape") { done(); cx.stop_propagation(); } })
      .child(h_flex().h(44).flex_none().px(18).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(uiSize(13.5)).font_semibold().child(T("Run/Debug Configurations"))))
      .child(h_flex().flex_1().min_h(0).child(left).child(right))
      .child(h_flex().h(58).flex_none().px(18).gap(10).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1())
        .child(button("rc-run", [toolImage("runAction", 15), div().child(T("Run"))], () => { this.apply(); done(); runConfig(this.configs[this.at]); }, c?.command ? null : "off"))
        .child(button("rc-cancel", [div().child(T("Cancel"))], () => done()))
        .child(button("rc-apply", [div().child(T("Apply"))], (cx) => { this.apply(); cx.notify(); }, dirty ? null : "off"))
        .child(button("rc-ok", [div().child(T("OK"))], () => { this.apply(); done(); }, "solid")));
  }
}

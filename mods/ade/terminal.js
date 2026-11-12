// Native terminal composition; existing processes receive no text or kill calls.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, agents, terminals, focused, layout, shared, setShared, exec, run, props as runtimeProps, notify, closeOverlay } from "herdr";
import { ADE, MenuController, adeUI, adeManagedList, adeButton, adeNote, adeTab, adeColors } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, projectKey } from "./workspace.js";
import { selectTerminal } from "./frame-layout.js";
import { toolSettings, captureProjectTools, saveProjectTools } from "./project-tools.js";
import { showTerminalFiles } from "./terminal-files.js";

const OWNER = "ade.terminal.project";
const ANCHORS = "ade.project-tabs";
const closingTabs = new Set();
const projectTabs = () => shared(ANCHORS) ?? {};
export function closeTerminalTab(id, cx) {
  const space = spaces().find(space => space.tabs.some(tab => tab.id === id));
  if (!space || closingTabs.has(id) || projectTabs()[space.id] === id) return;
  if (space.tabs.length > 1) { run("tab.close", { id }); cx.notify(); return; }
  // Herdr closes the space with its final tab. A mod-only workspace tab
  // decouples the ADE project lifetime from its last running terminal.
  closingTabs.add(id);
  cx.spawn(async taskCx => {
    try {
      const result = await exec("herdr-app", ["do", "tab.new", JSON.stringify({ space: space.id, name: "ADE 작업 공간", mod: "ade", props: { view: "project-idle" } })]);
      if (result.code) throw new Error(result.stderr || result.stdout || "작업 공간을 유지하지 못했습니다.");
      const created = JSON.parse(result.stdout);
      if (!created.tab) throw new Error("작업 공간 탭을 확인하지 못했습니다.");
      setShared(ANCHORS, { ...projectTabs(), [space.id]: created.tab });
      run("tab.close", { id });
    } catch (error) { notify({ title: "터미널을 닫지 못했습니다", body: String(error), level: "error" }); }
    finally { closingTabs.delete(id); taskCx.notify(); }
  });
}
const machineOf = address => address?.includes("/") ? address.split("/")[0] : null;
const localId = (id, machine) => machine && id?.startsWith(`${machine}/`) ? id.slice(machine.length + 1) : id;
const current = context => projectKey(currentProject()) === projectKey(context);
export function terminalChoices(context = currentProject()) {
  const space = spaces().find(item => item.id === context.id), tabs = (space?.tabs ?? []).map(tab => tab.id);
  const addresses = new Set(panes().filter(pane => tabs.includes(pane.tab) && pane.terminal).map(pane => pane.terminal));
  for (const agent of agents()) if (agent.space === context.id) addresses.add(agent.address);
  const localSpace = localId(context.id, context.machine);
  return terminals().filter(terminal => {
    const address = terminal.address;
    if (!address || machineOf(address) !== (context.machine ?? null)) return false;
    return addresses.has(address) || terminal.labels?.[OWNER] === projectKey(context)
      || (space?.machine === context.machine && terminal.labels?.["herdr.space"] === localSpace);
  }).map(terminal => ({ ...terminal, label: terminal.name || terminal.title || terminal.program?.name || terminal.address,
    detail: `${terminal.address} · ${terminal.state ?? terminal.status ?? ""}` }));
}
async function display(address, context) {
  if (currentProject().id !== context.id) throw new Error("프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 선택하세요.");
  const tree = layout(), next = selectTerminal(tree, address, toolSettings(context));
  if (next === tree) throw new Error("현재 레이아웃의 ADE 터미널 영역을 찾지 못했습니다.");
  if (JSON.stringify(next) === JSON.stringify(tree)) return;
  const result = await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: next })]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "터미널 영역을 변경하지 못했습니다.");
  if (current(context)) saveProjectTools(context, captureProjectTools(next, toolSettings(context)));
}
const failure = error => notify({ title: "터미널을 열지 못했습니다", body: String(error), level: "error" });
export function showTerminal(address, context = currentProject(), cx) {
  if (!current(context)) { failure("프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 선택하세요."); return; }
  if (address !== null && !terminalChoices(context).some(terminal => terminal.address === address)) {
    failure("현재 프로젝트에 속한 터미널을 선택하세요."); return;
  }
  const space = spaces().find(item => item.id === context.id), tabIds = new Set((space?.tabs ?? []).map(tab => tab.id));
  const pane = address === null ? null : panes().find(item => item.terminal === address && tabIds.has(item.tab));
  if (address !== null && !pane) { run("terminal.peek", { terminal: address }); return; }
  if (pane) run("tab.select", { id: pane.tab });
  cx.spawn(async taskCx => {
    try { await display(address, context); } catch (error) { failure(error); }
    taskCx.notify();
  });
}
export function openTerminal(context = currentProject(), cx) {
  if (!current(context)) { failure("프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 여세요."); return; }
  if (!context.root) { failure("프로젝트 폴더를 먼저 선택하세요."); return; }
  const space = spaces().find(item => item.id === context.id);
  if (!space || (space.machine ?? null) !== (context.machine ?? null)) { failure("현재 공간의 머신과 프로젝트 폴더의 머신이 다릅니다. 해당 머신의 프로젝트 공간을 선택하세요."); return; }
  run("tab.new", { space: space.id, folder: context.root });
  showTerminal(null, context, cx);
}

export function openTerminalFiles(context = currentProject(), terminal) {
  const choices = terminalChoices(context), focus = focused();
  const activeTabs = new Set((spaces().find(space => space.id === context.id)?.tabs ?? []).filter(tab => tab.active).map(tab => tab.id));
  const visible = panes().filter(pane => activeTabs.has(pane.tab) && pane.terminal);
  const address = terminal ?? focus?.shown ?? focus?.terminal ?? visible.find(pane => pane.focused)?.terminal ?? visible[0]?.terminal;
  if (!current(context) || !choices.some(choice => choice.address === address)) {
    notify({ title: "터미널의 파일 목록", body: "파일 목록을 볼 터미널 pane을 선택하세요.", level: "info" });
    return;
  }
  showTerminalFiles(address, context);
}

export class TerminalTabs {
  init(_props, cx) { this.focus = cx.focus_handle(); }
  release() { this.focus.release(); }
  select(id, cx) {
    const context = currentProject(), space = spaces().find(item => item.id === context.id);
    if (!space?.tabs.some(tab => tab.id === id)) return;
    run("tab.select", { id }); showTerminal(null, context, cx);
  }
  render(cx) {
    const context = currentProject(), space = spaces().find(item => item.id === context.id), tabs = (space?.tabs ?? []).filter(tab => tab.id !== projectTabs()[context.id]);
    return adeUI(h_flex()).h(ADE.tabHeight).w_full().flex_none().min_w(0).items_center().px(4).gap(3).overflow_x_scroll().track_focus(this.focus)
      .on_mouse_down("left", () => this.focus.focus())
      .on_key_down((event, eventCx) => {
        if (!["left", "right"].includes(event.keystroke) || !tabs.length) return;
        eventCx.stop_propagation(); const at = tabs.findIndex(tab => tab.active), offset = event.keystroke === "right" ? 1 : -1;
        this.select(tabs[(Math.max(0, at) + offset + tabs.length) % tabs.length].id, eventCx);
      })
      .when(!tabs.length, element => element.child(div().px(8).text_color(adeColors().secondary).child("터미널 탭이 없습니다")))
      .children(tabs.map(tab => adeTab(`terminal-tab-${tab.id}`, tab.name || String(tab.index), {
        selected: tab.active, icon: uiIcon("terminal", 14), onSelect: (_event, eventCx) => this.select(tab.id, eventCx), closeIcon: uiIcon("x", 12),
        onClose: (_event, eventCx) => closeTerminalTab(tab.id, eventCx),
      })));
  }
}

export class PaneHeader {
  init(props, cx) { this.props = { ...props, ...runtimeProps() }; this.focus = cx.focus_handle(); }
  release() { this.focus.release(); }
  command(command, args, cx) {
    const pane = panes().find(item => item.pane === this.props.pane);
    if (!pane) return;
    if (command === "pane.close" && panes().filter(item => item.tab === pane.tab).length === 1) { closeTerminalTab(pane.tab, cx); return; }
    run(command, { ...args, pane: pane.pane }); cx.notify();
  }
  render(cx) {
    const pane = panes().find(item => item.pane === this.props.pane), c = adeColors();
    return adeUI(h_flex()).h(28).w_full().min_w(0).items_center().gap(3).px(5).bg(c.surface).track_focus(this.focus)
      .child(uiIcon("terminal", 12))
      .child(div().flex_1().min_w(0).truncate().text_color(c.secondary).child(pane?.title || "터미널"))
      .child(adeButton(`pane-${this.props.pane}-files`, null, () => openTerminalFiles(currentProject(), pane?.terminal), {
        icon: uiIcon("files", 12), square: true, tip: "이 터미널의 파일 목록", disabled: !pane?.terminal,
      }))
      .children([
        ["split-right", "오른쪽 분할", "columns-2", "pane.split", { direction: "right" }],
        ["split-down", "아래로 분할", "rows-2", "pane.split", { direction: "down" }],
        ["zoom", pane?.zoomed ? "분할 복원" : "확대", "maximize", "pane.zoom", {}],
        ["close", "패널 닫기", "x", "pane.close", {}],
      ].map(([id, label, icon, command, args]) => adeButton(`pane-${this.props.pane}-${id}`, null, (_event, eventCx) => this.command(command, args, eventCx), {
        icon: uiIcon(icon, 12), square: true, tip: label, disabled: !pane,
      })));
  }
}

export class TerminalBody {
  init(props, cx) { this.props = props; this.menu = new MenuController(cx); this.focus = this.menu.focus; this.selected = null; }
  release() { this.menu.release(); this.focus.release(); }
  select(address, context, cx) { showTerminal(address, context, cx); if (this.props.overlay) closeOverlay(this.props.overlay); }
  render(cx) {
    const context = currentProject(), choices = terminalChoices(context);
    const rows = choices.map(terminal => ({ id: terminal.address, label: terminal.label, detail: terminal.detail, icon: () => uiIcon("terminal", 16) }));
    if (!rows.some(row => row.id === this.selected)) this.selected = rows[0]?.id ?? null;
    return adeUI(v_flex()).size_full().min_h(0).min_w(0)
      .when(!rows.length, element => element.child(adeNote("현재 프로젝트에 연결된 터미널이 없습니다.")))
      .child(adeManagedList("ade-terminal-choices", rows, this.menu, cx, {
        selectedId: this.selected,
        onSelect: (id, event, eventCx) => { this.selected = id; if (!event) this.select(id, context, eventCx); eventCx.notify(); },
        onActivate: (id, _event, eventCx) => this.select(id, context, eventCx),
        onClose: () => { if (this.props.overlay) closeOverlay(this.props.overlay); },
      }).flex_1())
      .child(h_flex().flex_none().p(8).gap(6).child(adeButton("ade-new-terminal", "새 터미널", (_event, eventCx) => openTerminal(context, eventCx), {
        icon: uiIcon("plus", 16),
      })).child(div().flex_1()));
  }
}

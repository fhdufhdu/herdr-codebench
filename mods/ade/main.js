import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, layout, shared, setShared, exec, openOverlay, run, window as appWindow, notify, nextCommand } from "herdr";
import { ADE, adeColors, adeUI, adeButton, adeStripeButton, adeRow, adePanel, adeNote } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { REGIONS, toggleRegion, regionSettings } from "./frame-layout.js";
import { currentProject, projectKey, documentState, openDocument, ProjectTree, ProjectPicker } from "./workspace.js";
import { toolSettings, captureProjectTools, saveProjectTools, initialProjectTools, savedProjectTools, restoreProjectTools } from "./project-tools.js";
import { EditorHost } from "./editor-host.js";
import { ResultsHost } from "./results.js";
import { DatabaseTree, DatabaseManager } from "./database.js";
import { DatabaseTransfer } from "./database-editor.js";
import { openDatabaseDocument } from "./database-model.js";
import Collection from "./collection.js";
import { RunConfigurations, executionState, selectedConfiguration, runConfiguration, stopExecution } from "./execution.js";
import { TerminalBody, TerminalTabs, PaneHeader, openTerminal, openTerminalFiles } from "./terminal.js";
import { TerminalFiles } from "./terminal-files.js";
import { AgentPanel, AgentLauncher, AgentAttachment } from "./agents.js";
import { SearchDialog } from "./navigation.js";
import { openReview, ReviewSidebar } from "./review.js";
import { EditorNavigationMenu } from "./editor-menu.js";
import { SettingsView } from "./settings.js";
import { FileAnalysisView, fileAnalysisButton } from "./file-analysis.js";
import { SpringBrowser, HttpRequests } from "./project-services.js";

const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map(child => find(child, id)).find(Boolean);
const icon = (role, size = ADE.iconSize) => uiIcon(role, size);
const spacer = () => div().flex_1().min_w(0);
export const TOOLS = Object.freeze(Object.fromEntries(Object.entries(REGIONS).map(([name, region]) => [name, { ...region,
  headerActions: [
    ...(name === "project" ? [{ id: "search", icon: "search", label: "파일·내용 검색", command: "search" }, { id: "refresh", icon: "refresh-cw", label: "새로 고침", command: "refresh" }] : []),
    ...(name === "agents" ? [{ id: "new", icon: "plus", label: "에이전트 시작", command: "agent-new" }] : []),
    ...(name === "terminal" ? [{ id: "files", icon: "files", label: "터미널의 파일 목록", command: "terminal-files" }, { id: "new", icon: "plus", label: "새 터미널 탭", command: "terminal-new" }] : []),
    ...(name === "database" ? [{ id: "manage", icon: "settings", label: "연결 관리", command: "database-manage" }, { id: "new", icon: "plus", label: "새 연결", command: "database-new" }, { id: "refresh", icon: "refresh-cw", label: "새로 고침", command: "refresh" }] : []),
    ...(name === "review" ? [{ id: "refresh", icon: "refresh-cw", label: "리뷰 새로고침", command: "review-refresh" }] : []),
    ...(name === "structure" ? [{ id: "refresh", icon: "refresh-cw", label: "문서 구조 다시 분석", command: "structure-refresh" }] : []),
    { id: "hide", icon: "minus", label: `${region.label} 접기`, command: `hide:${name}` },
  ],
}])));

export default class ADEFrame extends View {
  init(initial, cx) {
    this.p = { ...initial, ...props() }; this.alive = true; this.busy = false;
    this.focus = cx.focus_handle(); this.contextKey = projectKey(currentProject());
    const view = this.p.view, context = this.p.context ?? currentProject();
    const Impl = view === "spring" ? SpringBrowser : view === "http-requests" ? HttpRequests : view === "file-analysis" ? FileAnalysisView : view === "editor-menu" ? EditorNavigationMenu : view === "database-manager" ? DatabaseManager : view === "database-transfer" ? DatabaseTransfer : view === "pane-header" ? PaneHeader : view === "settings" ? SettingsView : view === "editor" ? EditorHost : view === "projects" ? ProjectPicker : view === "collection" ? Collection : view === "configurations" ? RunConfigurations :
      view === "search" ? SearchDialog : view === "terminal-files" ? TerminalFiles : view === "agent-new" ? AgentLauncher : view === "attachment" ? AgentAttachment : ["terminal-body", "terminals"].includes(view) ? TerminalBody :
      view === "panel" && !this.p.headerOnly ? this.p.region === "project" ? ProjectTree : this.p.region === "review" ? ReviewSidebar : this.p.region === "agents" ? AgentPanel : this.p.region === "database" ? DatabaseTree : this.p.region === "results" ? ResultsHost : null : null;
    if (Impl) { this.impl = new Impl(); this.impl.init({ ...this.p, context, owner: this, onOpen: Impl === DatabaseTree ? spec => openDatabaseDocument(spec, currentProject()) : (path, project) => openDocument(path, project) }, cx); }
    if (view === "panel" && this.p.region === "terminal" && this.p.headerOnly) { this.terminalTabs = new TerminalTabs(); this.terminalTabs.init(this.p, cx); }
    cx.spawn(async taskCx => {
      while (this.alive) {
        const command = await nextCommand();
        if (!this.alive) break;
        if (command === "focus") { (this.impl?.focus ?? this.focus).focus(); taskCx.notify(); }
        else if (command === "executions-changed" && this.p.region === "results") this.impl?.refresh?.(taskCx, currentProject());
        else if (command === "workspace-changed") { if (this.p.region !== "database") this.impl?.refresh?.(taskCx, currentProject()); taskCx.notify(); }
        else if (command.startsWith("review-action:") && view === "editor") {
          try { this.impl?.reviewAction(JSON.parse(command.slice("review-action:".length)), taskCx); }
          catch (error) { notify({ title: "리뷰 작업 실패", body: String(error), level: "error" }); }
        }
        else if (command === "review-project" && view === "appbar") this.command("changes", taskCx);
        else if (view === "appbar" || (view === "editor" && command === "save")) this.command(command, taskCx);
      }
    });
    if (view === "appbar") cx.spawn(async taskCx => {
      let project = currentProject();
      let pending = initialProjectTools(project, layout());
      let previous = "";
      while (this.alive) {
        await taskCx.sleep(500);
        if (!this.alive) break;
        if (shared("layout") !== "ade") continue;
        const nextProject = currentProject(), current = projectKey(nextProject);
        if (current !== this.contextKey) {
          project = nextProject; this.contextKey = current;
          pending = savedProjectTools(project); previous = "";
          run("ade.workspace-changed");
        }
        if (pending) {
          const target = pending, tree = layout(), restored = restoreProjectTools(tree, target);
          pending = null;
          if (restored !== tree && projectKey(currentProject()) === current) {
            try {
              const response = await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: restored })]);
              if (response.code) throw new Error(response.stderr || response.stdout);
              this.restoreError = null;
            } catch (error) {
              pending = target;
              if (this.restoreError !== String(error)) notify({ title: "프로젝트 도구 영역 복원 실패", body: String(error), level: "error" });
              this.restoreError = String(error); continue;
            }
          }
        }
        if (projectKey(currentProject()) === current) {
          const state = captureProjectTools(layout(), toolSettings(project)), signature = JSON.stringify(state);
          if (state && signature !== previous) { saveProjectTools(project, state); previous = signature; }
        }
      }
    });
  }
  async close(cx) { this.alive = false; await this.impl?.release?.(cx); this.terminalTabs?.release(); this.focus.release(); }
  overlay(view, dimensions = {}) {
    return openOverlay({ mod: "ade", props: { view, context: currentProject() }, kind: "dialog", frame: "none", width: 780, height: 600, ...dimensions });
  }
  toggle(region, cx) {
    if (this.busy) return;
    const context = currentProject(), current = layout(), next = toggleRegion(current, region, toolSettings(context));
    if (next === current) return;
    this.busy = true;
    cx.spawn(async taskCx => {
      try {
        const response = await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: next })]);
        if (response.code) throw new Error(response.stderr || response.stdout);
        if (projectKey(currentProject()) === projectKey(context)) saveProjectTools(context, captureProjectTools(next, toolSettings(context)));
      } catch (error) { notify({ title: "도구 영역 변경 실패", body: String(error), level: "error" }); }
      finally { if (this.alive) { this.busy = false; taskCx.notify(); } }
    });
  }
  command(command, cx) {
    if (command.startsWith("hide:")) return this.toggle(command.slice(5), cx);
    if (command === "structure-refresh") {
      const project = currentProject(), path = documentState(project).active;
      if (path && (shared("ade.editor-mode")?.[projectKey(project)] ?? "file") === "file") setShared("ade.analysis-request", { ...shared("ade.analysis-request"), [projectKey(project)]: { path, at: Date.now() } });
      return;
    }
    if (command === "refresh") { this.impl?.refresh?.(cx); return; }
    if (command === "projects") return this.overlay("projects", { width: 560, height: 480 });
    if (command === "file-analysis" || command === "project-analysis") return this.overlay("file-analysis", { width: 620, height: 320 });
    if (command === "search") return this.overlay("search");
    if (command === "settings") return this.overlay("settings", { width: 900, height: 640 });
    if (command === "collection") return this.overlay("collection");
    if (command === "agent-new") return this.overlay("agent-new", { width: 560, height: 420 });
    if (command === "terminal") return this.overlay("terminals", { width: 660, height: 480 });
    if (command === "terminal-new") return openTerminal(currentProject(), cx);
    if (command === "terminal-files") return openTerminalFiles(currentProject());
    if (command === "database-manage" || command === "database-new") return this.overlay("database-manager", { width: 860, height: 640, props: { view: "database-manager", add: command === "database-new", context: currentProject() } });
    if (command === "configurations") return this.overlay("configurations", { width: 860, height: 620 });
    if (command === "executions-changed") {
      if (find(layout(), "ade-results")?.hidden) this.toggle("results", cx);
      return;
    }
    if (command === "review-refresh") { run(`ade.review-action:${JSON.stringify({ project: projectKey(currentProject()), action: "refresh" })}`); return; }
    if (command === "changes") {
      openReview(currentProject());
      if (!find(layout(), "ade-review") || find(layout(), "ade-review").hidden) this.toggle("review", cx);
      cx?.notify();
      return;
    }
    if (command === "run") {
      const context = currentProject(), config = selectedConfiguration(context);
      if (!config) return this.command("configurations", cx);
      if (find(layout(), "ade-results")?.hidden) this.toggle("results", cx);
      runConfiguration(context, config, cx); run("ade.executions-changed"); return;
    }
    if (command === "stop") {
      const record = executionState(currentProject()).running.at(-1);
      if (record) cx.spawn(async taskCx => { try { await stopExecution(record.id); } catch (error) { notify({ title: "실행 중지 실패", body: String(error), level: "error" }); } run("ade.executions-changed"); taskCx.notify(); });
    }
    if (command === "save" && this.p.view === "editor") { const doc = this.impl?.active?.(); if (doc) this.impl.save(doc); }
  }
  appbar() {
    const c = adeColors(), project = currentProject(), config = selectedConfiguration(project), running = executionState(project).running.length > 0;
    return adeUI(h_flex()).size_full().min_w(0).items_center().gap(8).px(14).bg(c.canvas)
      .when(appWindow()?.platform === "macos" && !appWindow()?.fullscreen, element => element.pl(82))
      .child(h_flex().size(26).flex_none().rounded(5).items_center().justify_center().bg(c.primary).text_color(c.onPrimary).text_size(11).font_bold().child("HC"))
      .child(adeButton("projects", project.name, () => this.command("projects"), { icon: icon("chevron-down", 12), tip: "프로젝트 선택·정렬" }).max_w(240))
      .child(h_flex().gap(6).min_w(0).max_w(260).items_center().text_color(c.secondary).child(icon("git-branch", 14)).child(div().truncate().child(project.branch || "브랜치 없음")))
      .child(fileAnalysisButton(() => this.command("file-analysis")))
      .child(spacer())
      .child(adeButton("run-config", config?.name || "실행 구성", () => this.command("configurations"), { icon: icon("chevron-down", 12), tip: "실행 구성 관리" }).max_w(200))
      .child(adeButton("run", null, (_event, cx) => this.command("run", cx), { icon: icon("play"), square: true, tip: config ? `실행: ${config.name}` : "실행 구성 추가" }))
      .child(adeButton("stop", null, (_event, cx) => this.command("stop", cx), { icon: icon("square"), disabled: !running, square: true, tip: "실행 중지" }))
      .child(div().h(20).w(1).bg(c.separator).mx(4))
      .child(adeButton("collection", null, () => this.overlay("collection"), { icon: icon("layers"), square: true, tip: "디자인 시스템" }))
      .child(adeButton("search", null, () => this.overlay("search"), { icon: icon("search"), square: true, tip: "파일·내용 검색" }))
      .child(adeButton("settings", null, () => this.command("settings"), { icon: icon("settings"), square: true, tip: "설정" }));
  }
  stripe() {
    const c = adeColors(), positions = regionSettings(layout(), toolSettings()) ?? Object.fromEntries(Object.entries(REGIONS).map(([name, region]) => [name, { position: region.side === "bottom" ? "bottom" : `${region.side}-${region.section}`, order: 0 }]));
    const entries = Object.entries(REGIONS).filter(([name]) => {
      const position = positions[name]?.position || (REGIONS[name].side === "bottom" ? "bottom" : `${REGIONS[name].side}-${REGIONS[name].section}`);
      return this.p.side === "left" ? position.startsWith("left") || position === "bottom" : position.startsWith("right");
    }).sort(([a], [b]) => (positions[a]?.order ?? 0) - (positions[b]?.order ?? 0));
    const button = ([name, region]) => adeStripeButton(`stripe-${name}`, icon(region.icon, ADE.stripeIconSize), (_event, cx) => { if (name === "review" && find(layout(), region.id)?.hidden) this.command("changes", cx); else this.toggle(name, cx); }, { selected: find(layout(), region.id)?.hidden !== true, tip: region.label });
    const top = entries.filter(([name]) => positions[name]?.position?.endsWith("-top"));
    const lower = entries.filter(([name]) => positions[name]?.position?.endsWith("-bottom"));
    const bottom = entries.filter(([name]) => positions[name]?.position === "bottom");
    return v_flex().size_full().items_center().gap(6).pt(4).pb(4).bg(c.canvas).children(top.map(button))
      .when(Boolean(top.length && lower.length), element => element.child(div().h(1).w(24).my(6).bg(c.separator).flex_none()))
      .children(lower.map(button)).child(spacer()).children(bottom.map(button));
  }
  panel(cx) {
    const tool = TOOLS[this.p.region];
    if (!tool) return div();
    const actions = tool.headerActions.map(action => adeButton(`${tool.id}-${action.id}`, null, (_event, eventCx) => this.command(action.command, eventCx), { icon: icon(action.icon, 14), square: true, tip: action.label }));
    let body = this.terminalTabs ? this.terminalTabs.render(cx) : div();
    if (!this.p.headerOnly) {
      if (this.impl) body = this.impl.render(cx);
      else if (this.p.region === "structure") {
        const project = currentProject(), path = documentState(project).active, fileMode = (shared("ade.editor-mode")?.[projectKey(project)] ?? "file") === "file";
        const candidate = shared("ade.outline")?.[projectKey(project)];
        const outline = fileMode && candidate?.path === path ? candidate : null;
        const empty = !fileMode ? "소스 파일을 선택하면 문서 구조가 표시됩니다." : !path ? "파일을 열면 문서 구조가 표시됩니다."
          : !outline || ["pending", "idle"].includes(outline.status) ? "문서 구조를 분석하는 중…"
          : outline.error ? `문서 구조를 분석하지 못했습니다. ${outline.error}` : "이 문서에는 표시할 구조 항목이 없습니다.";
        body = v_flex().flex_1().min_h(0).id("outline-scroll").overflow_y_scrollbar().p(6)
          .children((outline?.items ?? []).map((item, index) => adeRow(`symbol-${index}`, item.name, { icon: icon("hash"), detail: item.detail,
            onClick: () => { const project = currentProject(); openDocument(outline.path, project); setShared("ade.navigation", { ...shared("ade.navigation"), [projectKey(project)]: { path: outline.path, line: item.line + 1, column: item.col + 1, at: Date.now() } }); } })))
          .when(!outline?.items?.length, element => element.child(adeNote(empty)));
      }
    }
    return adePanel(`panel-${this.p.region}`, tool.label, body, { actions })
      .when(Boolean(this.p.headerOnly), element => element.h(ADE.toolHeaderHeight + (this.terminalTabs ? ADE.tabHeight : 0)));
  }
  render(cx) {
    if (this.p.view === "project-idle") return adeUI(v_flex()).size_full().items_center().justify_center().gap(8).bg(adeColors().editor)
      .child(adeNote("열린 터미널이 없습니다. 프로젝트와 편집 중인 파일은 유지됩니다."))
      .child(adeButton("project-idle-terminal", "새 터미널", (_event, eventCx) => openTerminal(currentProject(), eventCx), { icon: icon("plus", 16) }));
    const view = this.p.view;
    if (view === "appbar") return this.appbar();
    if (view === "stripe") return this.stripe();
    if (view === "panel") return this.panel(cx);
    if (this.impl) return this.impl.render(cx);
    const project = currentProject();
    return adeUI(h_flex()).size_full().items_center().gap(8).px(14).text_size(11).text_color(adeColors().secondary)
      .child(icon("git-branch", 12)).child(project.branch || project.name).child(spacer()).child(project.machine || "로컬 작업 공간");
  }
}

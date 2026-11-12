import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Textarea, TextareaState } from "gpui-base";
import { agents, spaces, knownAgents, readTextFile, openOverlay, closeOverlay, run, exec, props } from "herdr";
import { adeUI, adeButton, adeNote, adePanel, adeColors, adeManagedList, MenuController } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, projectKey, documentState } from "./workspace.js";
import { showTerminal } from "./terminal.js";

export const agentStatus = status => ({ working: "진행 중", blocked: "입력 대기", done: "완료", idle: "대기" }[status] ?? status);

export const agentKind = agent => agent.program?.name || agent.app || "에이전트";
export function agentIcon(agent, size = 16) {
  const program = agent.program;
  if (!program?.icon) return uiIcon("bot", size);
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(adeColors().secondary) : image(program.icon).size(size).flex_none();
}

export class AgentPanel {
  init(_props, cx) { this.menu = new MenuController(cx); this.focus = this.menu.focus; this.selected = null; }
  release() { this.menu.release(); this.focus.release(); }
  render(cx) {
    const context = currentProject(), projects = new Map(spaces().map(space => [space.id, space.name || space.folder || space.id]));
    const live = agents(), rows = [];
    for (const status of ["working", "blocked", "done", "idle"]) {
      const group = live.filter(agent => agent.status === status);
      if (!group.length) continue;
      rows.push({ id: `status:${status}`, label: agentStatus(status), detail: String(group.length), heading: true });
      rows.push(...group.map(agent => ({ id: agent.address,
        label: agent.title || agent.program?.name || agent.address,
        detail: projects.get(agent.space) || agent.space || "프로젝트 없음",
        tip: `${agentKind(agent)} · ${agentStatus(agent.status)} · ${projects.get(agent.space) || agent.space || "프로젝트 없음"} · ${agent.address}`,
        icon: () => agentIcon(agent) })));
    }
    const selected = rows.some(row => !row.heading && row.id === this.selected) ? this.selected : rows.find(row => !row.heading)?.id;
    const reveal = (id, _event, eventCx) => {
      const agent = agents().find(agent => agent.address === id);
      if (!agent) return;
      this.selected = id;
      if (agent.space === context.id) showTerminal(id, context, eventCx);
      else {
        run("space.select", { id: agent.space }); run("pane.focus", { terminal: id });
        eventCx.timer.after(0, taskCx => { const target = currentProject(); if (target.id === agent.space && agents().some(item => item.address === id)) showTerminal(id, target, taskCx); });
      }
    };
    return adeManagedList("ade-agents", rows, this.menu, cx, { selectedId: selected,
      onSelect: (id, _event, eventCx) => { this.selected = id; eventCx.notify(); }, onActivate: reveal,
      activateOnClick: true, caption: `${live.length}개 에이전트 · 모든 프로젝트` });
  }
}

export class AgentLauncher {
  init(p, cx) {
    this.p = p; this.context = p.context ?? currentProject(); this.menu = new MenuController(cx); this.focus = this.menu.focus;
    this.alive = true; this.rows = []; this.loading = true; this.error = "";
    cx.spawn(async taskCx => {
      try { this.rows = (await knownAgents({ on: this.context.machine })).filter(agent => agent.installed).map(agent => ({ id: agent.key, label: agent.name, icon: () => agentIcon({ program: agent }), program: agent })); }
      catch (error) { this.error = String(error); }
      if (this.alive) { this.loading = false; taskCx.notify(); }
    });
  }
  release() { this.alive = false; this.menu.release(); this.focus.release(); }
  launch(id) {
    const row = this.rows.find(row => row.id === id);
    if (!row || projectKey(currentProject()) !== projectKey(this.context)) return;
    run("tab.new", { space: this.context.id, folder: this.context.root, argv: row.program.run, name: row.label });
    closeOverlay(this.p.overlay ?? props().overlay);
  }
  render(cx) {
    return adePanel("agent-launch", "에이전트 시작", this.loading || this.error ? adeNote(this.error || "설치된 에이전트를 확인하는 중…") :
      adeManagedList("agent-programs", this.rows, this.menu, cx, { selectedId: this.rows[this.menu.at]?.id,
        onSelect: (id, _e, eventCx) => { this.menu.at = this.rows.findIndex(row => row.id === id); eventCx.notify(); },
        onActivate: id => this.launch(id), caption: "실행할 에이전트를 선택하세요. 메시지는 자동 전송하지 않습니다.",
        actions: [{ id: "launch", label: "선택한 에이전트 시작", icon: () => uiIcon("play", 16), disabled: !this.rows.length, action: () => this.launch(this.rows[this.menu.at]?.id) }] }),
      { actions: [adeButton("close-agents", null, () => closeOverlay(this.p.overlay ?? props().overlay), { icon: uiIcon("x", 16), square: true, tip: "닫기" })] }).size_full();
  }
}

export class AgentAttachment {
  init(p, cx) {
    this.p = p; this.context = p.context; this.alive = true; this.loading = true; this.error = ""; this.busy = false;
    this.input = TextareaState.new({ rows: 18 });
    if (typeof p.text === "string") { this.input.set_value(p.text); this.loading = false; return; }
    const path = documentState(this.context).active;
    cx.spawn(async taskCx => {
      try {
        const text = await readTextFile(path, { on: this.context.machine });
        if (text === null) throw new Error("현재 파일을 읽지 못했습니다.");
        if (this.alive) this.input.set_value(`파일: ${path}\n\n\`\`\`\n${text}\n\`\`\``);
      } catch (error) { this.error = String(error); }
      if (this.alive) { this.loading = false; taskCx.notify(); }
    });
  }
  release() { this.alive = false; this.input.release(); }
  paste(cx) {
    if (this.busy || this.loading || !agents().some(agent => agent.address === this.p.address) || projectKey(currentProject()) !== projectKey(this.context)) {
      this.error = "대상 프로젝트와 에이전트를 다시 확인하세요."; cx.notify(); return;
    }
    cx.write_to_clipboard(this.input.value()); this.busy = true;
    cx.spawn(async taskCx => {
      try {
        const focus = await exec("herdr-app", ["do", "pane.focus", JSON.stringify({ terminal: this.p.address })]);
        if (focus.code) throw new Error(focus.stderr || "에이전트 입력창에 포커스를 옮기지 못했습니다.");
        const paste = await exec("herdr-app", ["do", "terminal.paste"]);
        if (paste.code) throw new Error(paste.stderr || "입력에 첨부하지 못했습니다.");
        closeOverlay(this.p.overlay ?? props().overlay);
      } catch (error) { if (this.alive) this.error = String(error); }
      finally { if (this.alive) { this.busy = false; taskCx.notify(); } }
    });
  }
  render(cx) {
    const c = adeColors();
    return adePanel("agent-attachment", "AI에게 첨부", v_flex().flex_1().min_h(0).gap(10).p(16)
      .child(adeNote(`${this.context.name} · ${this.p.address} · 내용을 확인하고 입력창에 첨부하세요. 전송은 에이전트에서 직접 합니다.`))
      .when(Boolean(this.error), element => element.child(adeNote(this.error)))
      .child(this.loading ? adeNote("파일을 읽는 중…") : Textarea.new(this.input).flex_1().min_h(0).bg(c.editor).text_color(c.foreground))
      .child(h_flex().flex_none().justify_end().gap(8)
        .child(adeButton("cancel-attach", "취소", () => closeOverlay(this.p.overlay ?? props().overlay)))
        .child(adeButton("paste-attach", this.busy ? "첨부 중…" : "입력창에 첨부", (_e, eventCx) => this.paste(eventCx), { kind: "primary", disabled: this.loading || this.busy || Boolean(this.error) }))))
      .size_full();
  }
}

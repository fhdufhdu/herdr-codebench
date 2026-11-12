import { h_flex, v_flex } from "gpui-base";
import { adeUI, adeColors, adeTab, adeNote, TabViewport, uiTabStrip } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { projectKey, currentProject } from "./workspace.js";
import { ExecutionResults, executionState } from "./execution.js";
import { DatabaseResults } from "./database-editor.js";
import { databaseExecutionState, selectDatabaseExecution, sqlResultTitle } from "./database-model.js";

const stateLabel = state => ({ queued: "대기", starting: "시작 중", running: "실행 중", stopping: "중지 중", completed: "완료",
  failed: "실패", error: "실패", cancelled: "취소", unknown: "상태 확인 필요" }[state] ?? state ?? "");
export function resultEntries(context) {
  return [
    ...executionState(context).records.filter(record => !record.closed).map(record => ({ key: `shell:${record.id}`, id: record.id, kind: "shell", name: record.name, state: record.status, startedAt: record.startedAt ?? 0 })),
    ...databaseExecutionState(context).records.filter(record => !record.closed).map(record => ({ key: `sql:${record.id}`, id: record.id, kind: "sql", name: sqlResultTitle(record), sourceName: record.sourceName ?? record.name, state: record.state, startedAt: record.startedAt ?? 0 })),
  ].sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
}
export class ResultsHost {
  init(props, cx) {
    this.context = props.context ?? currentProject(); this.alive = true; this.projects = new Map(); this.viewport = new TabViewport(); this.jobs = [];
    this.shell = new ExecutionResults(); this.database = new DatabaseResults();
    // Child initial fetches must observe the host's initial selection.
    this.shell.context = this.context;
    const selected = this.synchronize();
    if (selected) this.selectChild(selected);
    this.shell.init({ ...props, context: this.context, embedded: true }, cx);
    this.database.init({ ...props, context: this.context, embedded: true }, cx);
    cx.spawn(async taskCx => {
      for (;;) {
        while (this.jobs.length) this.jobs.shift()(taskCx);
        if (!this.alive) break;
        await new Promise(resolve => { this.wake = resolve; });
      }
    });
    this.refreshSignature = this.metadataSignature(this.context);
  }
  release() { this.alive = false; this.jobs.length = 0; const wake = this.wake; this.wake = null; wake?.(); this.shell.release(); this.database.release(); }
  metadataSignature(context) {
    return JSON.stringify([projectKey(context), executionState(context).records.map(record => [record.id, record.status, record.closed]),
      databaseExecutionState(context).records.map(record => [record.id, record.state, record.closed, record.queryLabel, record.runNumber, record.sourceName])]);
  }
  schedule(context) {
    const signature = this.metadataSignature(context);
    if (signature === this.refreshSignature) return;
    this.refreshSignature = signature; this.pendingContext = context;
    if (this.refreshPending) return;
    this.refreshPending = true;
    this.jobs.push(taskCx => { this.refreshPending = false; if (this.alive) this.refresh(taskCx, this.pendingContext); });
    const wake = this.wake; this.wake = null; wake?.();
  }
  synchronize() {
    const key = projectKey(this.context), entries = resultEntries(this.context);
    let state = this.projects.get(key);
    if (!state) { state = { active: null, known: new Set() }; this.projects.set(key, state); }
    const added = entries.filter(entry => !state.known.has(entry.key));
    if (added.length) state.active = added.at(-1).key;
    else if (!entries.some(entry => entry.key === state.active)) state.active = entries.at(-1)?.key ?? null;
    state.known = new Set(entries.map(entry => entry.key));
    return entries.find(entry => entry.key === state.active) ?? null;
  }
  selectChild(entry) {
    if (entry.kind === "shell") this.shell.select(entry.id);
    else selectDatabaseExecution(entry.id, this.context);
  }
  select(key, cx) {
    const entry = resultEntries(this.context).find(item => item.key === key);
    if (!entry) return;
    this.synchronize(); this.projects.get(projectKey(this.context)).active = key;
    this.selectChild(entry);
    if (entry.kind === "shell") this.shell.refresh(cx, this.context);
    else this.database.refresh(cx, this.context);
    cx.notify();
  }
  close(entry, cx) {
    if (entry.kind === "shell") this.shell.close(entry.id);
    else if (!this.database.closeExecution(entry.id, cx, this.context)) return;
    const selected = this.synchronize();
    if (selected) this.selectChild(selected);
    this.refresh(cx); cx.notify();
  }
  refresh(cx, context = this.context) {
    if (!this.alive) return;
    this.context = context; this.shell.context = context;
    const selected = this.synchronize();
    if (selected) this.selectChild(selected);
    this.shell.refresh(cx, context); this.database.refresh(cx, context);
    this.refreshSignature = this.metadataSignature(context);
  }
  render(cx) {
    this.context = currentProject(); this.schedule(this.context);
    const selected = this.synchronize(), entries = resultEntries(this.context), c = adeColors();
    const root = adeUI(v_flex()).id("ade-results-host").size_full().min_w(0).min_h(0).bg(c.editor);
    if (!entries.length) return root.child(adeNote("실행 기록이 없습니다. 실행 구성 또는 SQL 콘솔에서 실행하세요."));
    return root.child(h_flex().h(38).flex_none().min_w(0).items_center().border_b(1).border_color(c.separator)
      .child(uiTabStrip("ade-results-tabs", entries.map(entry => ({ id: entry.key,
        content: adeTab(`ade-results-${entry.key}`, entry.kind === "sql" ? entry.name : `${entry.name || "실행"} · ${stateLabel(entry.state)}`, {
          icon: uiIcon(entry.kind === "sql" ? "database" : "terminal", 14), selected: entry.key === selected?.key,
          onSelect: (_event, eventCx) => this.select(entry.key, eventCx), closeIcon: uiIcon("x", 12), onClose: (_event, eventCx) => this.close(entry, eventCx),
        }).tooltip(entry.kind === "sql" ? this.database.tooltip?.(entry.id, this.context) || `${entry.sourceName ?? "SQL"} · ${stateLabel(entry.state)}` : `${entry.name} · ${stateLabel(entry.state)}`),
      })), selected?.key, this.viewport)))
      .child(v_flex().flex_1().min_w(0).min_h(0).child(projectKey(selected.kind === "shell" ? this.shell.context : this.database.context) !== projectKey(this.context)
        ? adeNote("실행 결과를 준비하는 중…") : selected.kind === "shell"
        ? this.shell.render(cx, { selectedId: selected.id }) : this.database.render(cx, { selectedId: selected.id })));
  }
}

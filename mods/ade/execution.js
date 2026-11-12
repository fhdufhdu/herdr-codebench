// ADE only accesses processes carrying an execution's unique ownership labels.
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, EditorState, Editor } from "gpui-base";
import { hc, shared, setShared, closeOverlay } from "herdr";
import { projectKey } from "./workspace.js";
import { adeUI, adeColors, adeSize, adeButton, adeTab, adeNote, MenuController, adeInputBox, adeManagedList, TabViewport, uiTabStrip } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { readableOutput } from "./execution-output.js";

const EXECUTIONS = "ade.execution", CONFIGURATIONS = "ade.run-configurations";
const OWNER = "ade.execution", LIMIT = 20, LINES = 2000;
const launching = new Set();
const active = record => ["starting", "running", "stopping"].includes(record.status);
const unique = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const bucket = (namespace, context) => object(object(shared(namespace))[projectKey(context)]);
function save(namespace, context, state) {
  setShared(namespace, { ...object(shared(namespace)), [projectKey(context)]: state });
}
function records(context) {
  const state = bucket(EXECUTIONS, context);
  return (Array.isArray(state.records) ? state.records : []).slice(-LIMIT);
}
function update(context, id, patch) {
  const previous = records(context).find(record => record.id === id);
  if (!previous || Object.entries(patch).every(([key, value]) => previous[key] === value)) return false;
  save(EXECUTIONS, context, { ...bucket(EXECUTIONS, context), records: records(context).map(record => record.id === id ? { ...record, ...patch } : record) });
  return true;
}
function configurations(context) {
  const state = bucket(CONFIGURATIONS, context);
  return { ...state, configurations: Array.isArray(state.configurations) ? state.configurations : [] };
}
export function selectedConfiguration(context) {
  const state = configurations(context);
  return state.configurations.find(config => config.id === state.selectedId) ?? state.configurations[0] ?? null;
}
export function executionState(context) {
  const state = bucket(EXECUTIONS, context), list = records(context);
  return { ...state, records: list, activeId: state.activeId, running: list.filter(active) };
}
async function command(args, json = false) {
  const result = await hc(args);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "프로세스 요청 실패");
  return json ? JSON.parse(result.stdout) : result.stdout;
}
function owned(info, record) {
  if (info?.labels?.[OWNER] !== record.owner || info?.labels?.[`${OWNER}.project`] !== record.project || info?.keep || info?.parent) {
    throw new Error("실행 소유권을 확인할 수 없습니다. 프로세스에 접근하지 않았습니다.");
  }
  return info;
}
async function inspect(record) {
  if (!record.owner || !record.processName || !record.project) throw new Error("소유권 정보가 없는 이전 실행입니다.");
  const target = record.address || (record.context.machine ? `${record.context.machine}/${record.processName}` : record.processName);
  return owned(await command(["get", target, "--json"], true), record);
}
const addressOf = (info, record) => record.context.machine && !info.address.includes("/") ? `${record.context.machine}/${info.address}` : info.address;
function completion(info, record) {
  return { status: record.stopRequested ? "cancelled" : info.exit_code === 0 ? "completed" : "failed",
    exitCode: info.exit_code ?? null, exitSignal: info.signal ?? null, reason: info.reason ?? null,
    finishedAt: info.finished_ms ?? Date.now(), error: null };
}
async function observe(context, record) {
  // The launcher and results pane are distinct mod copies. Their module-local
  // sets are not shared, so allow the persisted starting record a short grace
  // period before trying recovery by name in another copy.
  if (!record.address && (launching.has(record.id) || record.status === "starting" && Date.now() - record.startedAt < 5000)) return;
  try {
    const info = await inspect(record), address = addressOf(info, record);
    const output = await command(["read", address, "--lines", String(LINES)]);
    const latest = records(context).find(item => item.id === record.id);
    if (!latest) return;
    return update(context, record.id, { address, output: output.split("\n").slice(-LINES).join("\n"), error: null,
      ...(info.state === "finished" ? completion(info, latest) : { status: latest.stopRequested ? "stopping" : "running" }) });
  } catch (error) {
    // Lost ownership stops automatic observation; recovery never relaunches.
    return update(context, record.id, { status: "unknown", error: String(error) });
  }
}
export function runConfiguration(context, config, cx) {
  if (!context?.root) throw new Error("프로젝트를 먼저 선택하세요.");
  if (!String(config?.command ?? "").trim()) throw new Error("실행 명령을 입력하세요.");
  const current = records(context);
  if (current.filter(active).length >= LIMIT) throw new Error("실행 중인 기록이 20개입니다. 먼저 실행을 중지하세요.");
  const id = unique(), project = projectKey(context), owner = `ade-${id}`;
  const record = { id, owner, project, context: { ...context }, processName: `ade-${id}`.slice(0, 32),
    config: { ...config }, name: config.name || "실행", command: config.command, cwd: config.cwd || context.root,
    startedAt: Date.now(), status: "starting", output: "", exitCode: null, closed: false };
  const next = [...current];
  while (next.length >= LIMIT) next.splice(next.findIndex(item => !active(item)), 1);
  save(EXECUTIONS, context, { ...bucket(EXECUTIONS, context), records: [...next, record], activeId: id });
  launching.add(id);
  cx.spawn(async taskCx => {
    try {
      const args = ["run", "--json", "--bg", "--no-parent", "--no-notify", "--name", record.processName,
        "--cwd", record.cwd, "--label", `${OWNER}=${owner}`, "--label", `${OWNER}.project=${project}`];
      if (context.machine) args.push("--on", context.machine);
      args.push("--", "/bin/sh", "-lc", config.command);
      const launched = await command(args, true), rawAddress = launched.address ?? launched.terminal?.address;
      if (!rawAddress) throw new Error("프로세스 주소를 받지 못했습니다. 상태 다시 확인으로 복구하세요.");
      const address = context.machine && !rawAddress.includes("/") ? `${context.machine}/${rawAddress}` : rawAddress;
      update(context, id, { address, status: "running" });
      if (records(context).find(item => item.id === id)?.stopRequested) await stopExecution(id);
      await observe(context, records(context).find(item => item.id === id));
    } catch (error) { update(context, id, { status: "unknown", error: String(error) }); }
    launching.delete(id); taskCx.notify();
  });
  return record;
}
export async function stopExecution(id) {
  for (const state of Object.values(object(shared(EXECUTIONS)))) {
    const record = state?.records?.find(item => item.id === id);
    if (!record?.context || !active(record)) continue;
    const context = record.context;
    update(context, id, { stopRequested: true, status: "stopping" });
    if (!record.address) return; // The in-flight launch handles cancellation.
    try {
      let info = await inspect(record);
      const wasFinished = info.state === "finished";
      if (!wasFinished) {
        await command(["interrupt", addressOf(info, record), "--timeout", "1", "--json"], true);
        info = await inspect(record);
        if (info.state !== "finished") {
          await command(["kill", addressOf(info, record), "--json"], true);
          info = await inspect(record);
        }
      }
      update(context, id, info.state === "finished"
        ? { ...completion(info, { ...record, stopRequested: !wasFinished }), stopRequested: !wasFinished }
        : { status: "stopping" });
      await observe(context, records(context).find(item => item.id === id));
    } catch (error) { update(context, id, { status: "unknown", error: String(error) }); throw error; }
    return;
  }
}
const label = record => ({ starting: "시작 중", running: "실행 중", stopping: "중지 중", completed: "완료", failed: "실패", cancelled: "취소", unknown: "상태 확인 필요" }[record.status] || "알 수 없음");
const caption = text => div().text_size(adeSize(11)).text_color(adeColors().secondary).whitespace_normal().child(text);

export class ExecutionResults {
  init(props, cx) {
    this.context = props.context; this.embedded = Boolean(props.embedded); this.alive = true; this.busy = false; this.viewport = new TabViewport();
    this.output = EditorState.new({ readonly: true, language: "text", font_family: "Menlo", font_size: adeSize(12), line_numbers: false, folding: false, soft_wrap: true });
    this.refresh(cx);
  }
  release() { this.alive = false; this.timer?.cancel(); this.timer = null; this.output?.release(); }
  refresh(cx, context = this.context) {
    this.context = context;
    if (!this.alive || this.busy || !context) return;
    this.timer?.cancel(); this.timer = null;
    const watching = records(context).filter(active);
    if (!watching.length) return;
    this.busy = true;
    cx.spawn(async taskCx => {
      let changed = false;
      try { for (const record of watching) changed = await observe(context, record) || changed; }
      finally {
        this.busy = false;
        if (this.alive) {
          if (changed) taskCx.notify();
          if (records(this.context).some(active)) this.timer = taskCx.timer.after(1500, nextCx => { this.timer = null; this.refresh(nextCx); });
        }
      }
    });
  }
  select(id) { save(EXECUTIONS, this.context, { ...bucket(EXECUTIONS, this.context), activeId: id }); }
  close(id) {
    update(this.context, id, { closed: true });
    const state = executionState(this.context), visible = state.records.filter(item => !item.closed);
    if (state.activeId === id) this.select(visible.at(-1)?.id ?? null);
  }
  retry(record, cx) {
    if (record.status === "unknown") {
      this.busy = true;
      cx.spawn(async taskCx => {
        await observe(this.context, record); this.busy = false;
        if (this.alive) { this.refresh(taskCx); taskCx.notify(); }
      });
    } else { runConfiguration(this.context, record.config, cx); this.refresh(cx); }
  }
  stopButton(record) {
    return adeButton("ade-execution-stop", "중지", (_event, cx) => {
      cx.spawn(async taskCx => { try { await stopExecution(record.id); } catch (_) { /* Error is persisted. */ } if (this.alive) { this.refresh(taskCx); taskCx.notify(); } });
    }, { icon: uiIcon("square", 14), disabled: !active(record) || record.stopRequested });
  }
  render(_cx, { selectedId } = {}) {
    const c = adeColors(), state = executionState(this.context), visible = state.records.filter(item => !item.closed);
    const selected = visible.find(item => item.id === (selectedId ?? state.activeId)) ?? visible.at(-1);
    const raw = selected?.output || "";
    if (this.rawOutput !== raw) { this.rawOutput = raw; this.readableOutput = readableOutput(raw); }
    const text = this.readableOutput ?? "";
    if (this.output.value() !== text) this.output.set_value(text);
    return adeUI(v_flex()).id("ade-execution").size_full().min_h(0).min_w(0).bg(c.editor)
      .when(!this.embedded, root => root.child(h_flex().h(38).flex_none().min_w(0).items_center().border_b(1).border_color(c.separator)
        .child(uiTabStrip("ade-execution-tabs", visible.map(item => ({ id: item.id,
          content: adeTab(`ade-execution-tab-${item.id}`, `${item.name} · ${label(item)}`, {
            selected: item.id === selected?.id, onSelect: () => this.select(item.id),
            closeIcon: uiIcon("x", 14), onClose: () => this.close(item.id),
          }) })), selected?.id, this.viewport))
        .when(Boolean(selected), el => el.child(this.stopButton(selected)))))
      .when(!selected, el => el.child(adeNote("실행 기록이 없습니다. 상단에서 실행 구성을 추가한 뒤 실행하세요.")))
      .when(Boolean(selected), el => el
        .child(h_flex().flex_none().min_w(0).items_center().gap(8).px(12).py(6)
          .child(caption(`${label(selected)}${selected.exitCode != null ? ` · 종료 코드 ${selected.exitCode}` : selected.exitSignal != null ? ` · 신호 ${selected.exitSignal}` : ""} · ${selected.cwd}`).flex_1().min_w(0).truncate())
          .child(adeButton("ade-execution-copy", "전체 복사", (_event, cx) => cx.write_to_clipboard(text), { disabled: !raw, icon: uiIcon("copy", 14) }).flex_none())
          .when(text !== raw, row => row.child(adeButton("ade-execution-copy-raw", "원문 복사", (_event, cx) => cx.write_to_clipboard(raw)).flex_none()))
          .when(this.embedded, row => row.child(this.stopButton(selected)))
          .when(!active(selected), row => row.child(adeButton("ade-execution-retry", selected.status === "unknown" ? "상태 다시 확인" : "다시 실행", (_event, cx) => this.retry(selected, cx), { disabled: this.busy }))))
        .when(Boolean(selected.error), body => body.child(adeNote(selected.error)))
        .when(!raw, body => body.child(adeNote(active(selected) ? "출력을 읽고 있습니다…" : "출력이 없습니다.")))
        .child(div().id(`ade-output-${selected.id}`).relative().flex_1().min_w(0).min_h(0).overflow_hidden()
          .child(div().absolute().inset_0().child(Editor.new(this.output).size_full().min_w(0).min_h(0)))));
  }
}

export class RunConfigurations {
  init(props, cx) {
    this.context = props.context; this.overlay = props.overlay;
    const saved = configurations(this.context);
    this.draft = saved.configurations.map(item => ({ ...item }));
    this.selectedId = this.draft.some(item => item.id === saved.selectedId) ? saved.selectedId : this.draft[0]?.id; this.menu = new MenuController(cx);
    this.inputs = Object.fromEntries(["name", "command", "cwd"].map(field => {
      const state = InputState.new({ placeholder: field === "cwd" ? this.context?.root || "프로젝트 폴더" : "" });
      state.on("change", (_event, eventCx) => {
        const config = this.draft.find(item => item.id === this.selectedId);
        if (config && !this.loading) { config[field] = state.value(); this.error = null; eventCx.notify(); }
      });
      return [field, state];
    }));
    this.select(this.selectedId); this.menu.focus.focus();
  }
  release() { this.menu.release(); this.menu.focus.release(); for (const state of Object.values(this.inputs)) state.release(); }
  refresh(cx) { cx.notify(); }
  select(id) {
    this.selectedId = id; const config = this.draft.find(item => item.id === id);
    this.loading = true;
    for (const [field, state] of Object.entries(this.inputs)) state.set_value(config?.[field] ?? "");
    this.loading = false;
    this.menu.at = this.draft.findIndex(item => item.id === id); this.menu.ensureVisible();
  }
  change(action, cx) {
    const at = this.draft.findIndex(item => item.id === this.selectedId), selected = this.draft[at];
    if (action === "add" || (action === "copy" && selected)) {
      const config = action === "copy" ? { ...selected, id: unique(), name: `${selected.name} 복사` } : { id: unique(), name: "새 실행 구성", command: "", cwd: "" };
      this.draft.splice(at < 0 ? this.draft.length : at + 1, 0, config); this.select(config.id);
    } else if (action === "remove" && at >= 0) {
      this.draft.splice(at, 1); this.select(this.draft[Math.min(at, this.draft.length - 1)]?.id);
    } else if ((action === "up" || action === "down") && at >= 0) {
      const to = at + (action === "up" ? -1 : 1);
      if (to >= 0 && to < this.draft.length) { [this.draft[at], this.draft[to]] = [this.draft[to], this.draft[at]]; this.select(selected.id); }
    }
    this.error = null; cx.notify();
  }
  apply(cx) {
    if (this.draft.some(config => !config.name?.trim() || !config.command?.trim())) {
      this.error = "모든 구성에 이름과 실행 명령을 입력하세요."; cx.notify(); return;
    }
    save(CONFIGURATIONS, this.context, { ...configurations(this.context), configurations: this.draft.map(config => ({ ...config })), selectedId: this.selectedId });
    closeOverlay(this.overlay);
  }
  render(cx) {
    const c = adeColors(), at = this.draft.findIndex(item => item.id === this.selectedId);
    const rows = this.draft.map(item => ({ id: item.id, label: item.name || "이름 없음", action: (_event, eventCx) => { this.select(item.id); eventCx.notify(); } }));
    const action = (id, name, graphic, disabled = false) => ({ id: id === "up" ? "move-up" : id === "down" ? "move-down" : id, label: name,
      icon: () => uiIcon(graphic, 16), disabled, action: (_event, eventCx) => this.change(id, eventCx) });
    return adeUI(v_flex()).id("ade-run-configurations").size_full().min_h(0).rounded(8).overflow_hidden().bg(c.surface)
      .child(h_flex().h(44).flex_none().items_center().px(16).border_b(1).border_color(c.separator)
        .child(div().flex_1().font_semibold().child("실행 구성"))
        .child(adeButton("ade-config-close", null, () => closeOverlay(this.overlay), { icon: uiIcon("x", 16), tip: "닫기", square: true })))
      .child(h_flex().flex_1().min_w(0).min_h(0).items_stretch()
        .child(v_flex().w(240).h_full().flex_none().min_h(0).border_r(1).border_color(c.separator)
          .child(adeManagedList("ade-config-list", rows, this.menu, cx, {
            selectedId: this.selectedId, onSelect: (id, _event, eventCx) => { this.select(id); eventCx.notify(); },
            rowActions: () => [
              { id: "copy", label: "실행 구성 복사", icon: () => uiIcon("copy", 16), action: (id, _event, eventCx) => { if (this.draft.some(item => item.id === id)) { this.select(id); this.change("copy", eventCx); } } },
              { id: "remove", label: "실행 구성 제거 · 적용 전 초안", icon: () => uiIcon("minus", 16), action: (id, _event, eventCx) => { if (this.draft.some(item => item.id === id)) { this.select(id); this.change("remove", eventCx); } } },
            ],
            onClose: () => closeOverlay(this.overlay), actions: [
              action("add", "추가", "plus"), action("remove", "삭제", "minus", at < 0), action("copy", "복사", "copy", at < 0),
              action("up", "위로", "arrow-up", at <= 0), action("down", "아래로", "arrow-down", at < 0 || at >= this.draft.length - 1),
            ],
          }).flex_1().min_h(0)))
        .child(v_flex().h_full().flex_1().min_w(0).min_h(0).overflow_y_scrollbar().p(20).gap(16)
          .when(at < 0, body => body.child(caption("왼쪽 툴바에서 실행 구성을 추가하세요.")))
          .when(at >= 0, body => body.children([["name", "이름"], ["command", "명령"], ["cwd", "작업 폴더"]].map(([field, name]) =>
            v_flex().gap(6).child(caption(name)).child(adeInputBox(Input.new(this.inputs[field])))))
            .child(caption("명령은 독립된 백그라운드 프로세스로 실행됩니다. 빈 작업 폴더는 프로젝트 폴더를 사용합니다.")))))
      .when(Boolean(this.error), el => el.child(adeNote(this.error)))
      .child(h_flex().h(56).flex_none().items_center().justify_end().gap(8).px(16).border_t(1).border_color(c.separator)
        .child(adeButton("ade-config-cancel", "취소", () => closeOverlay(this.overlay), { kind: "outline" }))
        .child(adeButton("ade-config-apply", "적용", (_event, eventCx) => this.apply(eventCx), { kind: "primary" })));
  }
}

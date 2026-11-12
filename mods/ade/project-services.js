import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, EditorState, Editor } from "gpui-base";
import { shared, setShared, closeOverlay } from "herdr";
import { adeUI, adePanel, adeButton, adeNote, adeManagedList, adeInputBox, MenuController } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, projectKey, openDocument } from "./workspace.js";
import { backend } from "./backend.js";
import { httpRequests, httpEnvs, chosenEnv } from "./http-client.js";

const same = context => projectKey(context) === projectKey(currentProject());
const closeButton = view => adeButton("close-services", null, () => closeOverlay(view.p.overlay), { icon: uiIcon("x", 16), square: true, tip: "닫기" });

export class SpringBrowser {
  init(p, cx) {
    this.p = p; this.context = p.context; this.kind = "current"; this.rows = []; this.alive = true; this.sequence = 0;
    this.menu = new MenuController(cx); this.focus = this.menu.focus; this.filter = InputState.new({ placeholder: "이름·경로 검색" });
    this.filter.on("change", (_event, eventCx) => eventCx.notify()); this.load(cx);
  }
  release() { this.alive = false; this.sequence++; this.menu.release(); this.focus.release(); this.filter.release(); }
  async request(route, body, cx) { return backend(route, { root: this.context.root, path: this.p.path, text: this.p.text, ...body }, cx); }
  load(cx) {
    const sequence = ++this.sequence; this.busy = true; this.error = ""; this.rows = []; this.selected = null;
    if (this.context.machine) { this.busy = false; this.error = "원격 프로젝트의 Spring 분석은 아직 지원하지 않습니다."; return; }
    cx.spawn(async taskCx => {
      try {
        const rows = await this.request(this.kind === "current" ? "spring_markers" : "spring_project", { kind: this.kind }, taskCx);
        if (this.alive && sequence === this.sequence) { this.rows = (rows ?? []).map((item, index) => ({ ...item, id: String(index) })); this.selected = this.rows[0]?.id; }
      } catch (error) { if (this.alive && sequence === this.sequence) this.error = String(error); }
      finally { if (this.alive && sequence === this.sequence) { this.busy = false; taskCx.notify(); } }
    });
  }
  activate(id, cx) {
    const row = this.rows.find(item => item.id === id);
    if (!row || this.busy || !same(this.context)) return;
    if (this.kind !== "current") { this.open(row); return; }
    const sequence = ++this.sequence; this.busy = true;
    cx.spawn(async taskCx => {
      try {
        const rows = await this.request("related", row, taskCx);
        if (!this.alive || sequence !== this.sequence || !same(this.context)) return;
        if (rows?.length === 1) this.open(rows[0]);
        else { this.kind = "targets"; this.rows = (rows ?? []).map((item, index) => ({ ...item, id: String(index) })); this.selected = this.rows[0]?.id; }
      } catch (error) { if (this.alive && sequence === this.sequence) this.error = String(error); }
      finally { if (this.alive && sequence === this.sequence) { this.busy = false; taskCx.notify(); } }
    });
  }
  open(row) {
    if (!row.path || !same(this.context)) return;
    setShared("ade.navigation", { ...shared("ade.navigation"), [projectKey(this.context)]: { path: row.path, line: (row.line ?? 0) + 1, column: (row.col ?? 0) + 1, at: `${Date.now()}-spring` } });
    openDocument(row.path, this.context); closeOverlay(this.p.overlay);
  }
  render(cx) {
    const query = this.filter.value().trim().toLowerCase();
    const rows = this.rows.filter(row => `${row.name} ${row.type} ${row.detail} ${row.path} ${row.title}`.toLowerCase().includes(query));
    return adePanel("spring-browser", "Spring 탐색", v_flex().flex_1().min_h(0).p(12).gap(8)
      .child(h_flex().flex_none().gap(4).children([["current", "현재 파일"], ["beans", "빈"], ["endpoints", "엔드포인트"], ["properties", "설정 키"]].map(([kind, name]) => adeButton(`spring-${kind}`, name, (_event, eventCx) => { this.kind = kind; this.load(eventCx); }, { selected: kind === this.kind }))))
      .child(adeNote(this.error || (this.busy ? "Spring 분석 중…" : `${this.context.name} · ${rows.length}개 · 조건부 빈과 프로필의 활성 여부는 실행 환경에서 확인하세요.`)))
      .child(adeManagedList("spring-items", rows.map(row => ({ id: row.id, label: row.title || row.name || row.path, detail: `${row.type || row.detail || row.path || ""} · ${(row.line ?? 0) + 1}행`, icon: () => uiIcon("code", 16) })), this.menu, cx, {
        selectedId: this.selected, search: adeInputBox(Input.new(this.filter)),
        onSelect: (id, _event, eventCx) => { this.selected = id; eventCx.notify(); }, onActivate: (id, _event, eventCx) => this.activate(id, eventCx),
        actions: [{ id: "go", label: this.kind === "current" ? "관련 빈·사용 위치 찾기" : "소스로 이동", icon: () => uiIcon("arrow-right", 16), disabled: this.busy || !rows.some(row => row.id === this.selected), action: (_event, eventCx) => this.activate(this.selected, eventCx) }],
      }).flex_1()), { actions: [closeButton(this)] }).size_full();
  }
}

export class HttpRequests {
  init(p, cx) {
    this.p = p; this.context = p.context; this.alive = true; this.menu = new MenuController(cx); this.envMenu = new MenuController(cx); this.focus = this.menu.focus;
    this.lines = p.text.split("\n"); this.requests = httpRequests(this.lines); this.selected = this.requests[p.requestIndex] ? String(p.requestIndex) : this.requests.length ? "0" : "all";
    this.busy = true; this.envs = { names: [] };
    this.preview = EditorState.new({ readonly: true, language: "http", font_family: "Menlo", font_size: 13, folding: false, soft_wrap: true });
    cx.spawn(async taskCx => {
      try { const envs = await httpEnvs(p.path, p.context.root); if (this.alive) { this.envs = envs; this.env = chosenEnv(p.path, envs); } }
      catch (error) { if (this.alive) this.error = String(error); }
      finally { if (this.alive) { this.busy = false; taskCx.notify(); } }
    });
  }
  release() { this.alive = false; this.preview.release(); this.menu.release(); this.focus.release(); this.envMenu.release(); this.envMenu.focus.release(); }
  execute() {
    if (this.busy || !this.requests.length || !same(this.context) || this.context.machine) return;
    setShared("ade.editor-request", { ...shared("ade.editor-request"), [projectKey(this.context)]: { path: this.p.path, revision: this.p.revision, kind: "http-run", request: this.selected === "all" ? null : this.requests[Number(this.selected)], environment: this.env, at: `${Date.now()}-http` } });
    closeOverlay(this.p.overlay);
  }
  render(cx) {
    const chosen = this.requests[Number(this.selected)];
    const preview = chosen ? this.lines.slice(chosen.start, chosen.end).join("\n") : this.p.text;
    if (this.preview.value() !== preview) this.preview.set_value(preview);
    return adePanel("http-requests", "HTTP 요청 실행", v_flex().flex_1().min_w(0).min_h(0).gap(4)
      .when(Boolean(this.error || this.context.machine), body => body.child(adeNote(this.error || "원격 HTTP 실행은 아직 지원하지 않습니다.").w_full().flex_none()))
      .child(h_flex().h(36).px(8).flex_none().items_center().gap(8)
        .child(adeButton("http-env", this.busy ? "환경 확인 중…" : this.env || "환경 없음", (_event, eventCx) => { this.envOpen = !this.envOpen; eventCx.notify(); }, { icon: uiIcon("chevron-down", 14), disabled: this.busy }))
        .child(div().flex_1())
        .child(adeButton("http-execute", "실행", () => this.execute(), { kind: "primary", disabled: this.busy || !this.requests.length || Boolean(this.context.machine) })))
      .when(Boolean(this.envOpen), element => element.child(adeManagedList("http-envs", [{ id: "none", label: "환경 없음" }, ...this.envs.names.map((name, index) => ({ id: String(index), label: name }))], this.envMenu, cx, {
        selectedId: this.env == null ? "none" : String(this.envs.names.indexOf(this.env)), activateOnClick: true,
        onSelect: (id, _event, eventCx) => { this.env = id === "none" ? null : this.envs.names[Number(id)]; eventCx.notify(); },
        onActivate: (_id, _event, eventCx) => { this.envOpen = false; eventCx.notify(); },
      }).h(120).flex_none()))
      .child(div().relative().w_full().flex_1().min_w(0).min_h(0).overflow_hidden().child(h_flex().absolute().inset_0()
        .child(adeManagedList("http-request-list", [{ id: "all", label: `전체 요청 · ${this.requests.length}개` }, ...this.requests.map((request, index) => ({ id: String(index), label: this.lines[request.line], detail: `${request.line + 1}행` }))], this.menu, cx, {
          selectedId: this.selected, onSelect: (id, _event, eventCx) => { this.selected = id; eventCx.notify(); },
        }).w(200).h_full().flex_none())
        .child(div().relative().h_full().flex_1().min_w(0).min_h(0).overflow_hidden()
          .child(div().absolute().inset_0().child(Editor.new(this.preview).size_full().min_w(0).min_h(0)))))),
      { actions: [closeButton(this)] }).size_full();
  }
}

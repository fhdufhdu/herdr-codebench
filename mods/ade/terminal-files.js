import { v_flex, Input, InputState } from "gpui-base";
import { hc, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { MenuController, adeManagedList, adeInputBox, adePanel, adeButton, adeNote } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, projectKey, openDocument } from "./workspace.js";
import { placeOf, pathsIn, resolve } from "./terminal-paths.js";

export function showTerminalFiles(terminal, context = currentProject()) {
  if (!terminal) return;
  openOverlay({ mod: "ade", props: { view: "terminal-files", terminal, context }, kind: "dialog", frame: "none", width: 780, height: 520 });
}

export class TerminalFiles {
  init(props, cx) {
    this.props = props;
    this.context = props.context ?? currentProject();
    this.alive = true;
    this.menu = new MenuController(cx);
    this.focus = this.menu.focus;
    this.rows = [];
    this.selected = null;
    this.input = InputState.new({ placeholder: "파일 경로 검색" });
    this.input.on("change", (_event, eventCx) => { this.selected = this.shown()[0]?.id ?? null; this.menu.at = 0; this.menu.ensureVisible(); eventCx.notify(); });
    this.input.on("submit", (_event, eventCx) => this.open(this.selected, eventCx));
    this.input.focus();
    this.load(cx);
  }
  current() { return this.alive && projectKey(currentProject()) === projectKey(this.context); }
  shown() {
    const query = this.input.value().toLocaleLowerCase();
    return this.rows.filter(row => !query || row.abs.toLocaleLowerCase().includes(query)).slice(0, 200);
  }
  load(cx) {
    if (this.busy || !this.current()) return;
    this.busy = true; this.error = "";
    cx.spawn(async taskCx => {
      try {
        const output = await hc(["read", this.props.terminal]);
        if (output.code) throw new Error(output.stderr || "터미널 출력을 읽지 못했습니다.");
        const paths = pathsIn(output.stdout ?? "").slice(0, 400);
        const place = paths.length ? await placeOf(this.props.terminal, { repo: this.context.root, needHome: paths.some(file => file.path.startsWith("~/")) }) : null;
        if (place && place.on !== (this.context.machine ?? null)) throw new Error("터미널과 프로젝트의 머신이 다릅니다.");
        const files = place ? await resolve(paths, place) : [];
        if (!this.current()) return;
        this.place = place;
        this.rows = files.map(file => ({ ...file, id: JSON.stringify([file.abs, file.line, file.col]), label: `${file.abs.split("/").pop()}${file.line ? `:${file.line}${file.col ? `:${file.col}` : ""}` : ""}`, detail: file.abs }));
        this.selected = this.shown()[0]?.id ?? null; this.menu.at = 0; this.menu.ensureVisible();
      } catch (error) { if (this.current()) this.error = String(error.message ?? error); }
      finally { this.busy = false; if (this.alive) taskCx.notify(); }
    }, { owner: this.props.owner });
  }
  open(id, cx) {
    const row = this.shown().find(row => row.id === id);
    if (!row || !this.current()) return;
    const key = projectKey(this.context);
    setShared("ade.navigation", { ...shared("ade.navigation"), [key]: { path: row.abs, line: row.line ?? 1, column: row.col ?? 1, at: Date.now() } });
    openDocument(row.abs, this.context);
    closeOverlay(this.props.overlay); cx.notify();
  }
  release() { this.alive = false; this.input.release(); this.menu.release(); this.focus.release(); }
  render(cx) {
    const obsolete = !this.current(), rows = obsolete ? [] : this.shown();
    const body = v_flex().flex_1().min_h(0).p(12).gap(8)
      .child(adeInputBox(Input.new(this.input)).on_key_down((event, eventCx) => {
        if (event.keystroke === "down") { eventCx.stop_propagation(); this.focus.focus(); eventCx.notify(); }
        else if (event.keystroke === "escape") closeOverlay(this.props.overlay);
      }))
      .when(obsolete, element => element.child(adeNote("프로젝트가 변경되었습니다. 현재 터미널에서 다시 여세요.")))
      .when(!obsolete && this.busy, element => element.child(adeNote("터미널의 파일 경로를 찾는 중…")))
      .when(!obsolete && Boolean(this.error), element => element.child(adeNote(this.error)))
      .when(!obsolete && !this.busy && !this.error && !rows.length, element => element.child(adeNote(this.rows.length ? "검색 결과가 없습니다." : "현재 터미널 화면에 파일 경로가 없습니다.")))
      .when(rows.length > 0, element => element.child(adeManagedList("terminal-file-list", rows.map(row => ({ ...row, icon: () => uiIcon("file-text", 16) })), this.menu, cx, {
        selectedId: this.selected, onSelect: (id, _event, eventCx) => { this.selected = id; eventCx.notify(); },
        onActivate: (id, _event, eventCx) => this.open(id, eventCx), activateOnClick: true, onClose: () => closeOverlay(this.props.overlay),
      }).flex_1()))
      .when(!rows.length, element => element.child(v_flex().flex_1()))
      .child(adeNote(this.place?.cwd || this.props.terminal).w_full());
    return adePanel("terminal-files", "터미널의 파일 목록", body, { actions: [
      adeButton("terminal-files-refresh", null, (_event, eventCx) => this.load(eventCx), { icon: uiIcon("refresh-cw", 14), square: true, tip: "출력 다시 읽기", disabled: this.busy || obsolete }),
      adeButton("terminal-files-close", null, () => closeOverlay(this.props.overlay), { icon: uiIcon("x", 14), square: true, tip: "닫기" }),
    ] }).size_full();
  }
}

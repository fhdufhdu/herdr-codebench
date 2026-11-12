// Project file/content search, built from ADE primitives.
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, shared, setShared, closeOverlay } from "herdr";
import { MenuController, adeUI, adeManagedList, adeInputBox, adeButton, adeNote, adePanel } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, projectKey, openDocument } from "./workspace.js";

const FILE_LIMIT = 20000, MATCH_LIMIT = 500;
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const join = (root, path) => `${root.replace(/[\\/]+$/, "")}/${path.replace(/^\.\//, "")}`;
const sameProject = context => projectKey(currentProject()) === projectKey(context);
function open(result, context) {
  if (!result || !sameProject(context)) return false;
  setShared("ade.navigation", { ...object(shared("ade.navigation")), [projectKey(context)]: { path: result.path, line: result.line ?? 1, column: 1, at: Date.now() } });
  openDocument(result.path, context); return true;
}
export function parseSearchResults(text, root) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const result = JSON.parse(line);
    if (result.type !== "match" || typeof result.data?.path?.text !== "string") continue;
    const data = result.data, path = join(root, data.path.text);
    rows.push({ id: `${path}:${data.line_number}:${rows.length}`, path, line: data.line_number, label: data.lines?.text?.trimEnd() || " ", detail: `${data.path.text}:${data.line_number}` });
    if (rows.length >= MATCH_LIMIT) break;
  }
  return rows;
}
async function command(program, args, context, allowNoMatch = false) {
  const result = await exec(program, args, { cwd: context.root, on: context.machine });
  if (result.code !== 0 && !(allowNoMatch && result.code === 1)) throw new Error(result.stderr || result.stdout || `${program} 실행 실패 (${result.code})`);
  return result.stdout;
}

export class SearchDialog {
  init(props, cx) {
    this.context = props.context ?? currentProject(); this.overlay = props.overlay;
    this.menu = new MenuController(cx); this.focus = this.menu.focus; this.alive = true; this.generation = 0;
    this.mode = "files"; this.query = ""; this.rows = []; this.selected = null; this.busy = false; this.error = ""; this.files = null; this.limited = false;
    this.input = InputState.new({ placeholder: "파일 이름 또는 내용 검색" });
    this.input.on("change", (_event, eventCx) => {
      this.query = this.input.value(); const generation = ++this.generation;
      this.rows = []; this.selected = null; this.busy = false;
      this.debounce?.cancel();
      this.debounce = eventCx.timer.after(200, timerCx => { if (this.alive && generation === this.generation) this.search(timerCx); });
      eventCx.notify();
    });
    this.input.on("submit", (_event, eventCx) => this.activate(this.selected, eventCx));
    this.input.focus(); this.search(cx);
  }
  release() { this.alive = false; this.generation++; this.debounce?.cancel(); this.input.release(); this.menu.release(); this.focus.release(); }
  activate(id, cx) {
    if (open(this.rows.find(row => row.id === id), this.context)) closeOverlay(this.overlay);
    cx.notify();
  }
  search(cx) {
    const generation = ++this.generation, query = this.query, mode = this.mode, context = this.context;
    if (!sameProject(context)) { this.busy = false; this.rows = []; this.selected = null; cx.notify(); return; }
    this.busy = true; this.error = ""; this.rows = []; this.selected = null; cx.notify();
    cx.spawn(async taskCx => {
      let rows = [], error = "", limited = false;
      try {
        if (!context.root) throw new Error("프로젝트 폴더를 먼저 선택하세요.");
        if (mode === "files") {
          let files = this.files;
          if (!files) {
            const text = await command("rg", ["--files", "--hidden", "--null", "-g", "!.git", "--", "."], context);
            const found = text.split("\0").filter(Boolean); files = found.slice(0, FILE_LIMIT); limited = found.length > FILE_LIMIT;
            if (this.alive && generation === this.generation) { this.files = files; this.fileLimited = limited; }
          } else limited = this.fileLimited;
          rows = files.filter(path => path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, MATCH_LIMIT)
            .map(path => ({ id: path, path: join(context.root, path), line: 1, label: path.replace(/^\.\//, ""), detail: "파일" }));
          limited ||= rows.length >= MATCH_LIMIT;
        } else if (query.trim()) {
          const text = await command("rg", ["--json", "--line-number", "--hidden", "--max-filesize", "1M", "--max-count", "100", "-g", "!.git", "-e", query, "--", "."], context, true);
          rows = parseSearchResults(text, context.root); limited = rows.length >= MATCH_LIMIT;
        }
      } catch (cause) { error = String(cause); }
      if (!this.alive || generation !== this.generation || !sameProject(context)) return;
      this.rows = rows; this.selected = rows[0]?.id ?? null; this.menu.at = rows.length ? 0 : -1; this.menu.ensureVisible();
      this.busy = false; this.error = error; this.limited = limited; taskCx.notify();
    });
  }
  render(cx) {
    const obsolete = !sameProject(this.context);
    const body = v_flex().flex_1().min_h(0).p(12).gap(8)
      .child(adeInputBox(Input.new(this.input)).on_key_down((event, eventCx) => {
        if (event.keystroke === "down") { eventCx.stop_propagation(); this.focus.focus(); eventCx.notify(); }
      }))
      .child(h_flex().flex_none().gap(4).children([["files", "파일"], ["content", "내용"]].map(([mode, label]) => adeButton(`search-${mode}`, label, (_event, eventCx) => {
        this.mode = mode; this.debounce?.cancel(); this.search(eventCx);
      }, { selected: this.mode === mode, disabled: obsolete }))))
      .when(obsolete, element => element.child(adeNote("프로젝트가 변경되었습니다. 창을 닫고 현재 프로젝트에서 검색하세요.")))
      .when(this.busy, element => element.child(adeNote("검색 중…")))
      .when(Boolean(this.error), element => element.child(adeNote(this.error)).child(adeButton("search-retry", "다시 시도", (_event, eventCx) => { this.files = null; this.search(eventCx); }, { disabled: obsolete })))
      .when(this.limited, element => element.child(adeNote("표시 한도: 파일 20,000개 · 결과 500개 · 내용 검색 파일당 1MiB/100줄. 검색어를 좁히세요.")))
      .child(adeManagedList("ade-search-results", obsolete ? [] : this.rows.map(row => ({ ...row, icon: () => uiIcon("file-text", 16) })), this.menu, cx, {
        selectedId: this.selected, onSelect: (id, event, eventCx) => { this.selected = id; if (!event) this.activate(id, eventCx); eventCx.notify(); },
        onActivate: (id, _event, eventCx) => this.activate(id, eventCx), onClose: () => closeOverlay(this.overlay),
      }).flex_1());
    return adePanel("ade-search", `${this.context.name} · 프로젝트 검색`, body, { actions: [adeButton("search-close", null, () => closeOverlay(this.overlay), { icon: uiIcon("x", 16), square: true, tip: "닫기" })] }).size_full();
  }
}

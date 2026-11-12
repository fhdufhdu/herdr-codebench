import { currentProject, projectKey } from "./workspace.js";
import { toolSettings, captureProjectTools, saveProjectTools } from "./project-tools.js";
import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { keys, settings, shared, setShared, layout, exec, appHome, readTextFile, writeTextFile, closeOverlay, openOverlay } from "herdr";
import { MenuController, adeUI, adeManagedList, adeInputBox, adeButton, adeNote, adePanel } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { REGIONS, regionSettings, arrangeRegions, toggleRegion } from "./frame-layout.js";

const ACTIONS = ["search", "projects", "save", "run", "settings", "changes", "terminal"];
const POSITIONS = [["left-top", "왼쪽 위"], ["left-bottom", "왼쪽 아래"], ["right-top", "오른쪽 위"], ["right-bottom", "오른쪽 아래"], ["bottom", "하단"]];
const object = value => value && typeof value === "object" && !Array.isArray(value);
const owned = value => typeof value === "string" && /^ade:[a-z][a-z0-9_-]*$/.test(value);
const identity = row => JSON.stringify([row.section, row.keys]);
export function validateADEChord(value) {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new Error("유효한 단축키를 입력하세요.");
  const chord = value.trim().toLowerCase().replace(/\bcontrol-/g, "ctrl-").replace(/\bmeta-/g, "cmd-").replace(/\s+/g, " ");
  for (const stroke of chord.split(" ")) {
    const key = stroke.replace(/^(?:(?:ctrl|cmd|alt|shift|fn)-)+/, "");
    if (!key || /^(ctrl|cmd|alt|shift|fn|control|meta)$/.test(key) || key !== "-" && key.includes("-")) throw new Error("보조 키와 실제 키를 함께 입력하세요.");
  }
  return chord;
}
export function applyADEBindingEdits(document, edits) {
  if (!object(document)) throw new Error("단축키 파일은 JSON object여야 합니다.");
  const next = JSON.parse(JSON.stringify(document));
  for (const edit of edits) {
    if (typeof edit.section !== "string" || !/^(global|terminal|layout:.+|mod:.+)$/.test(edit.section) || !(edit.action === null || owned(edit.action))) throw new Error("ADE 단축키만 변경할 수 있습니다.");
    const chord = validateADEChord(edit.chord), section = next[edit.section];
    if (section !== undefined && !object(section)) throw new Error("단축키 section 형식이 잘못되었습니다.");
    const matches = Object.entries(section ?? {}).filter(([key]) => validateADEChord(key) === chord);
    if (matches.length > 1) throw new Error("같은 단축키의 중복 별칭을 먼저 정리하세요.");
    const [previousKey, previous] = matches[0] ?? [chord, undefined];
    if (previous !== undefined && !owned(previous)) throw new Error(`기존 사용자 단축키를 덮어쓸 수 없습니다: ${chord}`);
    if ((previous ?? null) !== edit.expected) throw new Error(`편집 중 단축키가 변경되었습니다: ${chord}`);
    const changed = { ...(section ?? {}) }; delete changed[previousKey];
    if (edit.action !== null) changed[chord] = edit.action;
    next[edit.section] = changed;
  }
  return next;
}

export class SettingsView {
  init(props, cx) {
    this.context = props.context;
    this.overlay = props.overlay; this.category = "screen"; this.alive = true; this.busy = false; this.error = ""; this.message = "";
    this.menu = new MenuController(cx); this.positionMenu = new MenuController(cx); this.focus = this.menu.focus;
    this.project = currentProject(); this.tool = "project"; this.toolTree = layout(); this.tools = regionSettings(this.toolTree, toolSettings(this.project)) ?? {};
    this.toolBaseline = JSON.stringify(this.tools);
    this.positionOpen = false; this.selectedBinding = null; this.filter = ""; this.edits = []; this.bindings = keys();
    this.keyText = undefined; this.keyDocument = null;
    const preferences = shared("ade.preferences") ?? {};
    this.inputs = Object.fromEntries(Object.entries({ font: preferences.editorFont ?? settings().editor_font ?? settings().mono_font ?? "monospace", size: String(preferences.editorSize ?? settings().editor_font_size ?? 14), filter: "", chord: "", action: "ade:search" }).map(([key, value]) => [key, InputState.new({ value: String(value) })]));
    this.screenBaseline = { font: this.inputs.font.value(), size: this.inputs.size.value() };
    this.inputs.filter.on("change", (_event, eventCx) => { this.filter = this.inputs.filter.value(); eventCx.notify(); });
    cx.spawn(async taskCx => {
      try {
        const text = await readTextFile(`${appHome()}/keys.json`); if (!this.alive) return;
        const document = text === null ? {} : JSON.parse(text);
        if (!object(document)) throw new Error("단축키 파일은 JSON object여야 합니다.");
        if (text === null) for (const binding of this.bindings) document[binding.section] = { ...(document[binding.section] ?? {}), [binding.keys]: binding.action };
        this.keyText = text; this.keyDocument = document;
      }
      catch (error) { if (this.alive) this.error = String(error); }
      if (this.alive) taskCx.notify();
    });
  }
  release() { this.alive = false; this.menu.release(); this.focus.release(); this.positionMenu.release(); this.positionMenu.focus.release(); Object.values(this.inputs).forEach(input => input.release()); }
  manageDatabases() {
    if (this.busy) return;
    return openOverlay({ mod: "ade", props: { view: "database-manager", context: this.context }, kind: "dialog", frame: "none", width: 900, height: 640 });
  }
  toolsList() {
    return Object.keys(REGIONS).sort((a, b) => POSITIONS.findIndex(([id]) => id === this.tools[a]?.position) - POSITIONS.findIndex(([id]) => id === this.tools[b]?.position) || (this.tools[a]?.order ?? 0) - (this.tools[b]?.order ?? 0));
  }
  moveTool(offset, cx) {
    const group = this.toolsList().filter(key => this.tools[key]?.position === this.tools[this.tool]?.position), at = group.indexOf(this.tool), next = at + offset;
    if (at < 0 || next < 0 || next >= group.length) return;
    [group[at], group[next]] = [group[next], group[at]]; group.forEach((key, order) => { this.tools[key].order = order; }); this.menu.ensureVisible(this.toolsList().indexOf(this.tool)); cx.notify();
  }
  toggleTool(id, cx) {
    if (this.busy || !this.tools[id]) return;
    this.tool = id; this.toolTree = toggleRegion(this.toolTree, id, this.tools);
    const state = regionSettings(this.toolTree, this.tools);
    if (state) for (const key of Object.keys(this.tools)) if (state[key]) this.tools[key].hidden = state[key].hidden;
    cx.notify();
  }
  bindingRows() {
    let rows = [...this.bindings];
    for (const edit of this.edits) {
      rows = rows.filter(row => row.section !== edit.section || validateADEChord(row.keys) !== edit.chord);
      if (edit.action !== null) rows.push({ section: edit.section, keys: edit.chord, action: edit.action });
    }
    return rows;
  }
  bindingsDraft() {
    return this.bindingRows().filter(row => `${row.keys} ${row.action} ${row.section}`.toLowerCase().includes(this.filter.toLowerCase()))
      .map(row => ({ ...row, id: identity(row), label: typeof row.action === "string" ? row.action : JSON.stringify(row.action), detail: row.keys }));
  }
  selectBinding(id, cx) {
    const row = this.bindingsDraft().find(item => item.id === id); this.selectedBinding = id;
    this.inputs.chord.set_value(row?.keys ?? ""); this.inputs.action.set_value(owned(row?.action) ? row.action : "ade:search"); cx.notify();
  }
  editBinding(kind, cx) {
    if (this.busy) return;
    try {
      const row = this.bindingsDraft().find(item => item.id === this.selectedBinding);
      if (kind !== "add" && !owned(row?.action)) throw new Error("선택한 기본/사용자 단축키는 읽기 전용입니다.");
      const action = this.inputs.action.value().trim(), chord = validateADEChord(this.inputs.chord.value());
      if (!owned(action)) throw new Error(`지원하는 ADE 작업: ${ACTIONS.join(", ")}`);
      const additions = [];
      if (kind !== "add") additions.push({ section: row.section, chord: validateADEChord(row.keys), action: null, expected: row.action });
      if (kind !== "remove") {
        const section = kind === "add" ? "layout:ade" : row.section;
        const current = this.bindingsDraft().find(item => item.section === section && validateADEChord(item.keys) === chord);
        additions.push({ section, chord, action, expected: kind === "change" && validateADEChord(row.keys) === chord ? null : current?.action ?? null });
      }
      const next = [...this.edits, ...additions]; applyADEBindingEdits(this.keyDocument, next); this.edits = next; this.error = ""; this.message = "적용 전 변경입니다.";
    } catch (error) { this.error = String(error); }
    cx.notify();
  }
  apply(cx) {
    if (this.busy) return;
    this.error = ""; this.message = "";
    const screen = { font: this.inputs.font.value(), size: this.inputs.size.value() }, editorFont = screen.font.trim(), editorSize = Number(screen.size);
    const screenChanged = screen.font !== this.screenBaseline.font || screen.size !== this.screenBaseline.size;
    if (screenChanged && (!editorFont || !Number.isFinite(editorSize) || editorSize < 8 || editorSize > 40)) { this.error = "글꼴과 8–40 범위의 크기를 입력하세요."; cx.notify(); return; }
    const toolDraft = JSON.parse(JSON.stringify(this.tools)), toolsChanged = JSON.stringify(toolDraft) !== this.toolBaseline, bindingEdits = this.edits.map(edit => ({ ...edit }));
    if (!screenChanged && !toolsChanged && !bindingEdits.length) { this.message = "변경 사항이 없습니다."; cx.notify(); return; }
    this.busy = true; cx.notify();
    cx.spawn(async taskCx => {
      try {
        // Check/write the shared key file first so a stale snapshot applies no
        // unrelated category. A later failure leaves remaining drafts visible.
        if (bindingEdits.length) {
          if (this.keyText === undefined) throw new Error("단축키 원본을 아직 읽지 못했습니다.");
          const path = `${appHome()}/keys.json`, latest = await readTextFile(path);
          if (latest !== this.keyText) throw new Error("다른 곳에서 단축키 파일이 변경되었습니다. 창을 닫고 다시 여세요.");
          const text = `${JSON.stringify(applyADEBindingEdits(this.keyDocument, bindingEdits), null, 2)}\n`;
          await writeTextFile(path, text, latest); this.keyText = text; this.keyDocument = JSON.parse(text); this.bindings = this.bindingRows(); this.edits = [];
        }
        if (toolsChanged) {
          if (projectKey(currentProject()) !== projectKey(this.project)) throw new Error("프로젝트가 변경되었습니다. 도구 설정을 다시 여세요.");
          const tree = layout(), latestTools = regionSettings(tree, toolSettings(this.project)), baseline = JSON.parse(this.toolBaseline);
          if (!latestTools) throw new Error("현재 ADE 도구 영역을 확인할 수 없습니다.");
          for (const key of Object.keys(REGIONS)) for (const field of ["position", "order", "hidden"]) {
            if (toolDraft[key]?.[field] !== baseline[key]?.[field]) latestTools[key][field] = toolDraft[key][field];
          }
          const next = arrangeRegions(tree, latestTools);
          if (next === tree) throw new Error("현재 ADE 도구 영역을 확인할 수 없습니다.");
          const result = await exec("herdr-app", ["do", "layout.set", JSON.stringify({ layout: next })]);
          if (result.code !== 0) throw new Error(result.stderr || result.stdout || "도구 배치를 적용하지 못했습니다.");
          saveProjectTools(this.project, captureProjectTools(next, latestTools)); this.toolTree = next; this.tools = latestTools; this.toolBaseline = JSON.stringify(latestTools);
        }
        if (screenChanged) { setShared("ade.preferences", { ...(shared("ade.preferences") ?? {}), editorFont, editorSize }); this.screenBaseline = screen; }
        if (this.alive) this.message = "설정을 적용했습니다.";
      } catch (error) { if (this.alive) this.error = String(error); }
      finally { this.busy = false; if (this.alive) taskCx.notify(); }
    });
  }
  render(cx) {
    const selected = this.bindingsDraft().find(item => item.id === this.selectedBinding), editable = owned(selected?.action);
    let content;
    if (this.category === "screen") content = v_flex().flex_1().h_full().min_h(0).min_w(0).p(16).gap(10)
      .child(adeNote("ADE 편집기의 글꼴을 설정합니다. 앱 전역 설정은 유지합니다."))
      .child(div().child("편집기 글꼴")).child(adeInputBox(Input.new(this.inputs.font)))
      .child(div().child("글자 크기 · 8–40")).child(adeInputBox(Input.new(this.inputs.size)));
    else if (this.category === "tools") content = h_flex().flex_1().h_full().min_h(0).items_stretch()
      .child(v_flex().w(220).h_full().min_h(0).flex_none().child(adeManagedList("settings-tools", this.toolsList().map(id => ({ id, label: REGIONS[id].label, detail: POSITIONS.find(([position]) => position === this.tools[id]?.position)?.[1], icon: () => uiIcon(REGIONS[id].icon, 16) })), this.menu, cx, {
        selectedId: this.tool, onSelect: (id, _event, eventCx) => { this.tool = id; this.positionOpen = false; eventCx.notify(); },
        rowActions: row => [{ id: "toggle", label: this.tools[row.id]?.hidden ? "도구 표시" : "도구 숨기기", icon: () => uiIcon(this.tools[row.id]?.hidden ? "eye" : "minus", 16), disabled: this.busy || !this.tools[row.id],
          action: (id, _event, eventCx) => this.toggleTool(id, eventCx) }],
        actions: [["move-up", "위로 이동", "chevron-up", -1], ["move-down", "아래로 이동", "chevron-down", 1]].map(([id, label, icon, offset]) => {
          const group = this.toolsList().filter(key => this.tools[key]?.position === this.tools[this.tool]?.position), at = group.indexOf(this.tool);
          return { id, label, icon: () => uiIcon(icon, 16), disabled: this.busy || at < 0 || at + offset < 0 || at + offset >= group.length, action: (_event, eventCx) => this.moveTool(offset, eventCx) };
        }),
      })))
      .child(v_flex().flex_1().h_full().min_h(0).min_w(0).p(16).gap(10).child(div().child(REGIONS[this.tool].label))
        .child(adeButton("tool-visible", this.tools[this.tool]?.hidden ? "숨김 · 표시하기" : "표시 중 · 숨기기", (_event, eventCx) => this.toggleTool(this.tool, eventCx), { disabled: this.busy || !this.tools[this.tool] }))
        .child(adeButton("tool-position", POSITIONS.find(([id]) => id === this.tools[this.tool]?.position)?.[1] ?? "위치", (_event, eventCx) => { this.positionOpen = !this.positionOpen; if (this.positionOpen) this.positionMenu.focus.focus(); eventCx.notify(); }, { icon: uiIcon("chevron-down", 16), disabled: this.busy || !this.tools[this.tool] }))
        .when(this.positionOpen, element => element.child(v_flex().h(170).min_h(0).flex_none().child(adeManagedList("tool-positions", POSITIONS.map(([id, label]) => ({ id, label, disabled: this.busy })), this.positionMenu, cx, {
          selectedId: this.tools[this.tool]?.position, onSelect: (id, event, eventCx) => { this.tools[this.tool].position = id; if (!event) { this.positionOpen = false; this.focus.focus(); } eventCx.notify(); },
          onActivate: (id, _event, eventCx) => { this.tools[this.tool].position = id; this.positionOpen = false; this.focus.focus(); eventCx.notify(); }, onClose: (_event, eventCx) => { this.positionOpen = false; this.focus.focus(); eventCx.notify(); },
        })))));
    else if (this.category === "database") content = v_flex().flex_1().h_full().min_h(0).min_w(0).p(16).gap(10)
      .child(div().child("전역 데이터베이스 연결"))
      .child(adeNote("연결 프로필은 모든 프로젝트에서 공유합니다. macOS 암호는 Keychain에, 다른 운영체제에서는 현재 엔진 세션에 보관합니다. 실제 저장 방식은 연결 관리창에서 확인할 수 있습니다."))
      .child(adeButton("settings-database-manage", "데이터베이스 연결 관리", () => this.manageDatabases(), { icon: uiIcon("database", 16), disabled: this.busy }))
      .child(adeNote("연결 변경은 연결 관리창에서 적용합니다. 이 설정창의 화면·도구 창·단축키 초안은 그대로 유지됩니다."));
    else content = h_flex().flex_1().h_full().min_h(0).items_stretch()
      .child(v_flex().w(320).h_full().min_h(0).flex_none().child(adeManagedList("settings-bindings", this.bindingsDraft(), this.menu, cx, {
        selectedId: this.selectedBinding, onSelect: (id, _event, eventCx) => this.selectBinding(id, eventCx), search: adeInputBox(Input.new(this.inputs.filter)),
        actions: [["add", "추가", "plus", false], ["change", "변경", "pencil", !editable], ["remove", "제거", "trash-2", !editable]].map(([id, label, icon, disabled]) => ({ id, label, icon: () => uiIcon(icon, 16), disabled: this.busy || disabled || !this.keyDocument, action: (_event, eventCx) => this.editBinding(id, eventCx) })),
      })))
      .child(v_flex().flex_1().h_full().min_h(0).min_w(0).p(16).gap(10).child(div().child(selected?.label ?? "ADE 단축키 추가"))
        .child(adeNote(selected && !editable ? "기본/다른 사용자 작업은 읽기 전용입니다. ADE 작업만 추가·변경·제거합니다." : "Control과 Command를 구분합니다. 예: ctrl-r, cmd-shift-p"))
        .child(div().child("작업 · ade:search 등")).child(adeInputBox(Input.new(this.inputs.action)))
        .child(div().child("단축키")).child(adeInputBox(Input.new(this.inputs.chord))));
    const body = v_flex().flex_1().min_h(0)
      .child(h_flex().flex_1().min_h(0).items_stretch().child(v_flex().w(120).h_full().min_h(0).flex_none().p(8).gap(4).children([["screen", "화면"], ["tools", "도구 창"], ["keymap", "단축키"], ["database", "Database"]].map(([id, label]) => adeButton(`settings-${id}`, label, (_event, eventCx) => { this.category = id; this.selectedBinding = null; this.positionOpen = false; this.message = ""; this.error = ""; eventCx.notify(); }, { selected: this.category === id, disabled: this.busy })))).child(content))
      .when(Boolean(this.error || this.message), element => element.child(adeNote(this.error || this.message)))
      .child(h_flex().flex_none().p(10).gap(6).justify_end()
        .child(adeButton("settings-cancel", "취소", () => closeOverlay(this.overlay), { disabled: this.busy }))
        .child(adeButton("settings-apply", this.busy ? "적용 중…" : "적용", (_event, eventCx) => this.apply(eventCx), { kind: "primary", disabled: this.busy })));
    return adePanel("ade-settings", "설정", body).size_full();
  }
}

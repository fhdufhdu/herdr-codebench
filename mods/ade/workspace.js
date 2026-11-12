// Project and document identity are shared; editor contents remain local.
import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, InputState, Input } from "gpui-base";
import { spaces, panes, shared, setShared, exec, run, pickFolder, closeOverlay } from "herdr";
import { ADE, adeUI, adeSize, adeColors, adeRow, adeButton, adeNote, adePanel, adeInputBox, MenuController, adeManagedList } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { GIT_STATUS, FILE_STATUS } from "./file-status.js";

const DOCUMENTS = "ade.documents", ROOTS = "ade.projectRoots", ORDER = "ade.projectOrder", RECENT = "ade.projectRecent";
const REMOVED = "ade.removedProjects";
const removedProjects = () => Array.isArray(shared(REMOVED)) ? shared(REMOVED) : [];
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const scopeKey = context => JSON.stringify([context?.machine ?? null, context?.id ?? ""]);
export const projectKey = (context = currentProject()) => JSON.stringify([context?.machine ?? null, context?.root ?? "", context?.id ?? ""]);
const absolute = path => typeof path === "string" && (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path));
const basename = path => String(path).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
const project = space => {
  const tabs = (space?.tabs ?? []).map(tab => tab.id);
  const candidates = panes().filter(pane => tabs.includes(pane.tab) && absolute(pane.cwd));
  const pane = candidates.find(item => item.focused) ?? candidates[0];
  const base = { id: space?.id ?? "", root: space?.folder || pane?.cwd || "", machine: space?.machine ?? null, name: space?.name || "프로젝트 없음", branch: space?.branch ?? pane?.branch ?? "" };
  const override = object(shared(ROOTS))[scopeKey(base)];
  return override && absolute(override.root) ? { ...base, root: override.root, machine: override.machine ?? null, name: space?.named ? base.name : basename(override.root), branch: "" } : base;
};
export function currentProject() { return project(spaces().find(space => space.active)); }
export function documentState(context = currentProject()) {
  const saved = object(shared(DOCUMENTS))[projectKey(context)];
  const tabs = [...new Set((Array.isArray(saved?.tabs) ? saved.tabs : []).filter(absolute))];
  return { tabs, active: tabs.includes(saved?.active) ? saved.active : tabs[0] ?? null };
}
function storeDocuments(context, state) { setShared(DOCUMENTS, { ...object(shared(DOCUMENTS)), [projectKey(context)]: state }); }
export function openDocument(path, context = currentProject()) {
  if (!absolute(path)) return;
  const state = documentState(context);
  storeDocuments(context, { tabs: state.tabs.includes(path) ? state.tabs : [...state.tabs, path], active: path });
  setShared("ade.editor-mode", { ...object(shared("ade.editor-mode")), [projectKey(context)]: "file" });
}
export function selectDocument(path, context = currentProject()) { openDocument(path, context); }
export function closeDocument(path, context = currentProject()) {
  const state = documentState(context), index = state.tabs.indexOf(path), tabs = state.tabs.filter(item => item !== path);
  storeDocuments(context, { tabs, active: state.active === path ? tabs[Math.min(index, tabs.length - 1)] ?? null : state.active });
}
const icon = name => uiIcon(name, 16);
const SCAN = "import json,os,sys\np=sys.argv[1]\nwith os.scandir(p) as entries:\n rows=[{'name':e.name,'path':e.path,'directory':e.is_dir(follow_symlinks=False)} for e in entries if e.name != '.git']\nprint(json.dumps(sorted(rows,key=lambda e:(not e['directory'],e['name'].casefold()))))";

export class ProjectTree {
  init(props, cx) {
    this.props = props; this.menu = new MenuController(cx); this.focus = this.menu.focus;
    this.alive = true; this.generation = 0; this.nodes = new Map(); this.expanded = new Set();
    this.statuses = {}; this.statusTimer = cx.timer.every(5000, taskCx => this.loadStatus(taskCx));
    this.refresh(cx);
  }
  release() { this.statusTimer.cancel(); this.alive = false; this.generation++; this.menu.release(); this.focus.release(); }
  refresh(cx) {
    this.context = currentProject(); this.key = projectKey(this.context); this.generation++;
    this.nodes = new Map(); this.expanded = new Set(this.context.root ? [this.context.root] : []); this.menu.at = 0;
    this.statuses = {};
    if (absolute(this.context.root)) { this.load(this.context.root, cx); this.loadStatus(cx); }
    cx.notify();
  }
  loadStatus(cx) {
    if (!this.alive || this.statusLoading || !absolute(this.context?.root) || projectKey(currentProject()) !== this.key) return;
    const generation = this.generation, context = this.context;
    this.statusLoading = true;
    cx.spawn(async taskCx => {
      try {
        const result = await exec("python3", ["-c", GIT_STATUS, context.root], { on: context.machine });
        const statuses = result.code === 0 ? JSON.parse(result.stdout) : {};
        if (!this.alive || generation !== this.generation || projectKey(currentProject()) !== this.key) return;
        const next = statuses && typeof statuses === "object" && !Array.isArray(statuses) ? statuses : {};
        if (JSON.stringify(next) !== JSON.stringify(this.statuses)) { this.statuses = next; taskCx.notify(); }
      } catch (_) { /* Git unavailable is a normal uncolored file tree. */ }
      finally { this.statusLoading = false; }
    });
  }
  expand(path, cx, depth = 0) {
    this.expanded.add(path);
    const children = this.nodes.get(path)?.children;
    if (!children) { this.load(path, cx, depth); return; }
    if (depth < 64 && children.length === 1 && children[0].directory) this.expand(children[0].path, cx, depth + 1);
  }
  load(path, cx, depth = 0) {
    if (this.nodes.get(path)?.loading) return;
    const generation = this.generation, context = this.context;
    this.nodes.set(path, { loading: true });
    cx.spawn(async taskCx => {
      let state;
      try {
        const result = await exec("python3", ["-c", SCAN, path], { on: context.machine });
        if (result.code !== 0) throw new Error(result.stderr || result.stdout || "폴더를 읽지 못했습니다");
        const children = JSON.parse(result.stdout);
        if (!Array.isArray(children)) throw new Error("잘못된 폴더 응답");
        state = { children: children.filter(entry => absolute(entry.path) && typeof entry.name === "string") };
      } catch (error) { state = { error: String(error) }; }
      if (!this.alive || generation !== this.generation || projectKey(currentProject()) !== this.key) return;
      this.nodes.set(path, state);
      if (state.children && this.expanded.has(path)) this.expand(path, taskCx, depth);
      taskCx.notify();
    });
  }
  rows() {
    if (!absolute(this.context.root)) return [];
    const rows = [];
    const visit = (entry, depth) => {
      rows.push({ ...entry, id: entry.path, depth });
      if (!entry.directory || !this.expanded.has(entry.path)) return;
      const state = this.nodes.get(entry.path);
      if (state?.children) {
        if (!state.children.length) rows.push({ id: `${entry.path}:empty`, label: "빈 폴더", disabled: true, depth: depth + 1 });
        state.children.forEach(child => visit(child, depth + 1));
      } else rows.push({ id: `${entry.path}:state`, path: entry.path, label: state?.error ? `읽기 실패 · 다시 시도: ${state.error}` : "불러오는 중…", retry: Boolean(state?.error), disabled: !state?.error, depth: depth + 1 });
    };
    visit({ path: this.context.root, name: this.context.name, directory: true }, 0);
    return rows;
  }
  activate(row, eventCx) {
    if (!row || row.disabled) return;
    if (row.retry) this.load(row.path, eventCx);
    else if (row.directory) {
      if (this.expanded.has(row.path)) this.expanded.delete(row.path);
      else this.expand(row.path, eventCx);
    } else this.props.onOpen?.(row.path, this.context, eventCx);
    eventCx.notify();
  }
  render(cx) {
    if (projectKey(currentProject()) !== this.key && !this.refreshPending) {
      this.refreshPending = true;
      cx.spawn(async taskCx => { this.refreshPending = false; if (this.alive) this.refresh(taskCx); });
    }
    if (projectKey(currentProject()) !== this.key) return adeNote("프로젝트를 불러오는 중…");
    this.context.name = currentProject().name;
    const rows = this.rows(), menuRows = rows.map(row => ({ ...row, action: (_event, eventCx) => this.activate(row, eventCx) }));
    this.menu.normalize(menuRows);
    const height = Math.max(ADE.rowHeight, adeSize() + 12), id = "ade-project-tree";
    return adeUI(v_flex()).size_full().min_h(0).min_w(0).relative().track_focus(this.focus)
      .on_key_down((event, eventCx) => {
        const row = rows[this.menu.at];
        if (row?.directory && ["left", "right"].includes(event.keystroke)) {
          eventCx.stop_propagation();
          if ((event.keystroke === "right") !== this.expanded.has(row.path)) this.activate(row, eventCx);
          return;
        }
        this.menu.key(event, eventCx, menuRows, { closeOnActivate: false });
      })
      .when(!rows.length, element => element.child(adeNote("프로젝트 폴더가 없습니다. 상단 프로젝트 메뉴에서 폴더를 여세요.")))
      .child(v_virtual_list(id, rows.length, height, index => rows[index].id, range => rows.slice(range.start, range.end).map((row, offset) =>
        adeRow(`tree-${row.id}`, row.label ?? row.name, { indent: row.depth * 16, selected: range.start + offset === this.menu.at,
          leading: row.directory ? icon(this.expanded.has(row.path) ? "chevron-down" : "chevron-right") : div().w(16),
          icon: row.label ? undefined : icon(row.directory ? "folder" : "file-text"), strong: row.depth === 0,
          labelColor: row.label ? undefined : adeColors()[FILE_STATUS[this.statuses[row.path]]?.[0]],
          detail: row.directory ? undefined : FILE_STATUS[this.statuses[row.path]]?.[1],
        }).when(Boolean(row.disabled), element => element.text_color(adeColors().disabled))
      )).size_full().track_scroll(this.menu.scroll).on_item_click((key, eventCx) => {
        eventCx.stop_propagation(); this.focus.focus();
        const at = rows.findIndex(row => row.id === key);
        this.menu.select(at, menuRows, eventCx); this.activate(rows[at], eventCx);
      }))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }
}

const SORTS = [["name", "이름순"], ["recent", "최근 사용순"], ["manual", "직접 지정"]];
export class ProjectPicker {
  init(props, cx) {
    this.props = props; this.menu = new MenuController(cx); this.sortMenu = new MenuController(cx); this.focus = this.menu.focus;
    this.selected = scopeKey(spaces().find(space => space.active)); this.sort = SORTS.some(([value]) => value === shared("ade.projectSort")) ? shared("ade.projectSort") : "name";
    this.draft = null; this.sortOpen = false; this.busy = false; this.error = ""; this.alive = true; this.focus.focus();
    this.editing = null; this.nameInput = InputState.new({ placeholder: "프로젝트 이름" });
    this.nameInput.on("change", (_event, eventCx) => eventCx.notify());
    this.nameInput.on("submit", (_event, eventCx) => this.rename(eventCx));
  }
  release() { this.alive = false; this.menu.release(); this.focus.release(); this.sortMenu.release(); this.sortMenu.focus.release(); this.nameInput.release(); }
  dismiss() { closeOverlay(this.props.overlay); }
  projects() {
    const removed = removedProjects();
    const list = spaces().filter(space => !removed.includes(scopeKey(space))).map(space => ({ ...project(space), key: scopeKey(space), space }));
    const order = this.draft ?? (Array.isArray(shared(ORDER)) ? shared(ORDER) : []), recent = object(shared(RECENT));
    return list.sort((a, b) => this.sort === "recent" ? (Number(recent[b.key]) || 0) - (Number(recent[a.key]) || 0) || a.name.localeCompare(b.name)
      : this.sort === "manual" ? (order.includes(a.key) ? order.indexOf(a.key) : order.length + a.space.index) - (order.includes(b.key) ? order.indexOf(b.key) : order.length + b.space.index)
      : a.name.localeCompare(b.name));
  }
  choose(id) {
    if (this.editing || this.busy) return;
    const selected = this.projects().find(item => item.key === id);
    if (!selected) return;
    setShared(RECENT, { ...object(shared(RECENT)), [id]: Date.now() });
    run("space.select", { id: selected.id }); this.dismiss();
  }
  move(offset, cx) {
    const order = this.projects().map(item => item.key), at = order.indexOf(this.selected), next = at + offset;
    if (at < 0 || next < 0 || next >= order.length) return;
    [order[at], order[next]] = [order[next], order[at]]; this.draft = order; this.menu.ensureVisible(next); cx.notify();
  }
  edit(id, kind, cx) {
    if (this.busy || this.draft) return;
    const item = this.projects().find(item => item.key === id);
    if (!item) return;
    this.selected = id; this.editing = { item, kind }; this.error = "";
    if (kind === "rename") { this.nameInput.set_value(item.name); this.nameInput.focus(); }
    cx.notify();
  }
  rename(cx) {
    if (this.busy || this.editing?.kind !== "rename") return;
    const name = this.nameInput.value().trim(), item = this.editing.item;
    if (!name) { this.error = "프로젝트 이름을 입력하세요."; cx.notify(); return; }
    if (!spaces().some(space => scopeKey(space) === item.key)) { this.editing = null; cx.notify(); return; }
    this.busy = true; this.error = "";
    cx.spawn(async taskCx => {
      try {
        const result = await exec("herdr-app", ["do", "space.rename", JSON.stringify({ id: item.id, name })]);
        if (result.code) throw new Error(result.stderr || result.stdout || "이름을 변경하지 못했습니다.");
        if (this.alive) this.editing = null;
      } catch (error) { if (this.alive) this.error = String(error); }
      finally { this.busy = false; if (this.alive) taskCx.notify(); }
    });
  }
  remove(cx) {
    if (this.busy || this.editing?.kind !== "remove") return;
    const key = this.editing.item.key;
    setShared(REMOVED, [...new Set([...removedProjects(), key])]);
    this.editing = null; this.selected = this.projects()[0]?.key ?? null;
    this.menu.at = 0; this.focus.focus(); cx.notify();
  }
  beginOrder(cx) {
    this.draft = this.projects().map(item => item.key);
    if (!this.draft.includes(this.selected)) this.selected = this.draft[0] ?? null;
    this.menu.at = this.draft.indexOf(this.selected); this.menu.ensureVisible(); this.focus.focus(); cx.notify();
  }
  chooseSort(value, cx, close = false) {
    if (!SORTS.some(([id]) => id === value)) return;
    this.sort = value; setShared("ade.projectSort", value);
    if (value === "manual") this.beginOrder(cx);
    if (close || value === "manual") { this.sortOpen = false; this.focus.focus(); }
    cx.notify();
  }
  pick(cx) {
    if (this.busy) return;
    this.busy = true; this.error = "";
    cx.spawn(async taskCx => {
      try {
        const root = await pickFolder({ prompt: "프로젝트 폴더 열기" });
        if (!this.alive) return;
        if (root) {
          const normalized = root.replace(/\/+$/, "") || "/";
          const existing = spaces().map(project).find(item => !item.machine && (item.root.replace(/\/+$/, "") || "/") === normalized);
          if (existing) {
            setShared(REMOVED, removedProjects().filter(key => key !== scopeKey(existing)));
            setShared(RECENT, { ...object(shared(RECENT)), [scopeKey(existing)]: Date.now() });
            run("space.select", { id: existing.id });
          } else {
            const result = await exec("herdr-app", ["do", "space.new", JSON.stringify({ name: basename(root), folder: root, machine: "" })]);
            if (result.code) throw new Error(result.stderr || result.stdout || "프로젝트를 추가하지 못했습니다.");
          }
          if (this.alive) this.dismiss();
        }
      } catch (error) { if (this.alive) this.error = String(error); }
      finally { this.busy = false; if (this.alive) taskCx.notify(); }
    });
  }
  render(cx) {
    const projects = this.projects(), selectedIndex = projects.findIndex(item => item.key === this.selected);
    const actions = this.draft ? [
      { id: "move-up", label: "위로 이동", icon: () => icon("chevron-up"), disabled: selectedIndex <= 0, action: (_event, eventCx) => this.move(-1, eventCx) },
      { id: "move-down", label: "아래로 이동", icon: () => icon("chevron-down"), disabled: selectedIndex < 0 || selectedIndex >= projects.length - 1, action: (_event, eventCx) => this.move(1, eventCx) },
    ] : [
      { id: "rename", label: "이름 변경", icon: () => icon("pencil"), disabled: !this.selected || this.busy || Boolean(this.editing), action: (_event, eventCx) => this.edit(this.selected, "rename", eventCx) },
      { id: "remove", label: "목록에서 제거", icon: () => icon("minus"), disabled: !this.selected || this.busy || Boolean(this.editing), action: (_event, eventCx) => this.edit(this.selected, "remove", eventCx) },
    ];
    const body = v_flex().flex_1().min_h(0).p(12).gap(8)
      .when(this.sortOpen, element => element.child(v_flex().h(124).min_h(0).flex_none().child(adeManagedList("project-sort", SORTS.map(([id, label]) => ({ id, label })), this.sortMenu, cx, {
        selectedId: this.sort, onSelect: (id, event, eventCx) => this.chooseSort(id, eventCx, !event),
        onActivate: (id, _event, eventCx) => this.chooseSort(id, eventCx, true),
        onClose: (_event, eventCx) => { this.sortOpen = false; this.focus.focus(); eventCx.notify(); },
      }))))
      .child(adeManagedList("ade-projects", projects.map(item => ({ id: item.key, label: item.name, detail: item.root, icon: () => icon("folder") })), this.menu, cx, {
        selectedId: this.selected, onSelect: (id, event, eventCx) => { this.selected = id; if (!event && !this.draft) this.choose(id); eventCx.notify(); },
        onActivate: id => { if (!this.draft) this.choose(id); }, onClose: () => this.dismiss(), actions,
        rowActions: row => this.draft ? [-1, 1].map(offset => ({ id: offset < 0 ? "move-up" : "move-down", label: offset < 0 ? "위로 이동" : "아래로 이동", icon: () => icon(offset < 0 ? "chevron-up" : "chevron-down"),
          disabled: this.draft.indexOf(row.id) + offset < 0 || this.draft.indexOf(row.id) + offset >= this.draft.length,
          action: (id, _event, eventCx) => { this.selected = id; this.move(offset, eventCx); },
        })) : [
          { id: "rename", label: "이름 변경", icon: () => icon("pencil"), disabled: this.busy || Boolean(this.editing), action: (id, _event, eventCx) => this.edit(id, "rename", eventCx) },
          { id: "remove", label: "목록에서 제거", icon: () => icon("minus"), disabled: this.busy || Boolean(this.editing), action: (id, _event, eventCx) => this.edit(id, "remove", eventCx) },
        ],
      }).flex_1())
      .when(Boolean(this.editing), element => element.child(v_flex().flex_none().gap(8)
        .child(adeNote(this.editing.kind === "rename" ? `이름 변경 · ${this.editing.item.name}` : `${this.editing.item.name}을(를) 목록에서 제거할까요? 폴더·파일과 실행 중인 터미널은 유지됩니다. 폴더 열기로 다시 추가할 수 있습니다.`))
        .when(this.editing.kind === "rename", row => row.child(adeInputBox(Input.new(this.nameInput))))
        .child(h_flex().gap(6)
          .child(adeButton("project-edit-cancel", "취소", (_event, eventCx) => { this.editing = null; this.error = ""; this.focus.focus(); eventCx.notify(); }, { disabled: this.busy }))
          .child(adeButton("project-edit-save", this.editing.kind === "rename" ? "이름 변경" : "목록에서 제거", (_event, eventCx) => this.editing.kind === "rename" ? this.rename(eventCx) : this.remove(eventCx), { kind: "primary", disabled: this.busy || this.editing.kind === "rename" && !this.nameInput.value().trim() })))))
      .child(h_flex().flex_none().gap(6).child(adeButton("open-folder", this.busy ? "처리 중…" : "폴더 열기…", (_event, eventCx) => this.pick(eventCx), { disabled: this.busy || Boolean(this.draft) || Boolean(this.editing), icon: icon("folder-open") }))
        .when(removedProjects().length > 0, element => element.child(adeButton("restore-projects", "제거한 프로젝트 복원", (_event, eventCx) => { setShared(REMOVED, []); eventCx.notify(); }, { disabled: this.busy || Boolean(this.draft) || Boolean(this.editing), icon: icon("undo") })))
        .when(this.sort === "manual" && !this.draft, element => element.child(adeButton("project-order", "순서 관리…", (_event, eventCx) => this.beginOrder(eventCx)))))
      .when(Boolean(this.draft), element => element.child(h_flex().flex_none().gap(6)
        .child(adeButton("cancel-order", "취소", (_event, eventCx) => { this.draft = null; eventCx.notify(); }))
        .child(adeButton("save-order", "확인", (_event, eventCx) => { const old = Array.isArray(shared(ORDER)) ? shared(ORDER) : []; setShared(ORDER, [...this.draft, ...old.filter(id => !this.draft.includes(id))]); this.draft = null; eventCx.notify(); }, { kind: "primary" }))))
      .when(Boolean(this.error), element => element.child(adeNote(this.error)));
    return adePanel("project-picker", this.draft ? "프로젝트 순서" : "프로젝트", body, { actions: [
      adeButton("project-sort", SORTS.find(([value]) => value === this.sort)[1], (_event, eventCx) => { this.sortOpen = !this.sortOpen; if (this.sortOpen) this.sortMenu.focus.focus(); eventCx.notify(); }, { icon: icon("chevron-down"), disabled: Boolean(this.draft) || Boolean(this.editing) || this.busy, tip: "프로젝트 정렬 기준" }),
      adeButton("close-project-picker", null, () => this.dismiss(), { icon: icon("x"), square: true, tip: "닫기" }),
    ] }).size_full();
  }
}

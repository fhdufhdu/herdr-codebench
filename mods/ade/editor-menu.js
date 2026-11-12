import { v_flex } from "gpui-base";
import { shared, setShared, openOverlay, closeOverlay } from "herdr";
import { ADE, adeUI, adeColors, adeSize, adeManagedList, MenuController } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { projectKey } from "./workspace.js";

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export function navigationRows(mode = "actions", locations = [], available = true) {
  if (mode === "actions") return [
    ["hover", "빠른 정보", "info"], ["definition", "정의로 이동", "arrow-right"], ["references", "참조 찾기", "search"],
    ["super", "상위 선언·인터페이스로 이동", "arrow-up"], ["implementation", "구현으로 이동", "arrow-down"], ["type-definition", "타입 정의로 이동", "code"],
    ["definition-locations", "정의 위치…", "list-tree"], ["reference-files", "참조 파일…", "files"],
  ].map(([kind, label, icon]) => ({ id: kind, kind, label, icon, disabled: !available }));
  const groups = new Map();
  for (const location of locations) {
    if (typeof location?.path !== "string") continue;
    const key = mode === "reference-files" ? location.path : JSON.stringify([location.path, location.line, location.col]);
    if (groups.has(key)) { groups.get(key).count++; continue; }
    groups.set(key, { location: { path: location.path, line: location.line ?? 0, col: location.col ?? 0, external: Boolean(location.external) }, count: 1 });
  }
  return [...groups].map(([id, { location, count }]) => ({ id, kind: "navigate", location, icon: "file-text", disabled: false,
    label: `${location.path.split(/[\\/]/).pop()}:${location.line + 1}:${location.col + 1}${mode === "reference-files" ? ` · ${count}곳` : ""}`,
    detail: location.external ? `외부 소스 · ${location.path}` : location.path }));
}
export function editorMenuSize(count, reason = "") {
  return { width: 380, height: Math.min(440, Math.max(1, count) * Math.max(ADE.rowHeight, adeSize() + 12) + 12 + (reason ? 46 : 0)) };
}
export function openEditorMenu(context, request, { mode = "actions", locations = [], available = true, reason = "" } = {}) {
  const rows = navigationRows(mode, locations, available), size = editorMenuSize(rows.length, reason);
  const at = request.position && Number.isFinite(request.position.x) && Number.isFinite(request.position.y) ? request.position : "pointer";
  return openOverlay({ mod: "ade", kind: "popup", frame: "none", at, ...size,
    props: { view: "editor-menu", context, request, mode, locations, available, reason } });
}
export class EditorNavigationMenu {
  init(props, cx) {
    this.props = props; this.menu = new MenuController(cx); this.focus = this.menu.focus; this.rows = navigationRows(props.mode, props.locations, props.available);
    this.selected = this.rows.find(row => !row.disabled)?.id; this.menu.focus.focus();
  }
  release() { this.menu.release(); this.menu.focus.release(); }
  activate(id) {
    const row = this.rows.find(item => item.id === id && !item.disabled); if (!row) return;
    const previous = object(shared("ade.editor-request"));
    setShared("ade.editor-request", { ...previous, [projectKey(this.props.context)]: { ...this.props.request,
      kind: row.kind, location: row.location, at: `${Date.now()}-${Math.random().toString(36).slice(2)}` } });
    closeOverlay(this.props.overlay);
  }
  render(cx) {
    const c = adeColors(), size = editorMenuSize(this.rows.length, this.props.reason);
    return adeUI(v_flex()).id("ade-editor-navigation-menu").w(size.width).h(size.height).min_h(0).rounded(ADE.radius).overflow_hidden()
      .bg(c.popup).border(1).border_color(c.separator)
      .child(adeManagedList("ade-editor-menu-list", this.rows.map(row => ({ ...row, icon: () => uiIcon(row.icon, 16) })), this.menu, cx, {
        caption: this.props.reason, selectedId: this.selected, activateOnClick: true,
        onSelect: (id, _event, eventCx) => { this.selected = id; eventCx.notify(); },
        onActivate: id => this.activate(id), onClose: () => closeOverlay(this.props.overlay),
      }));
  }
}

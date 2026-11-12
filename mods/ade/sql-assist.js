import { div } from "gpui-kit";
import { ADE, adeSize, MenuController, adeCompletionPopup } from "./idea-design.js";
import { completionBounds } from "./editor-completion.js";
import { completeSQL, referencedTables } from "./sql-completion.js";

export class SQLAssist {
  constructor(cx, { input, owner, current, catalog, driver = "" }) {
    this.input = input; this.owner = owner; this.current = current; this.catalog = catalog; this.driver = driver;
    this.alive = true; this.generation = 0; this.menu = new MenuController(cx);
  }
  release() { this.alive = false; this.clear(); this.menu.release(); this.menu.focus.release(); }
  clear() { this.generation++; this.timer?.cancel(); this.timer = null; this.pending = null; this.popup = null; }
  valid(request) { return this.alive && this.current() && !this.input.hasPendingText && this.input.revision === request.revision && this.input.selection().start === this.input.selection().end && this.input.selection().head === request.offset; }
  selection(selection, cx) {
    const request = this.popup ?? this.pending;
    if (request && (request.offset !== selection.head || selection.start !== selection.end)) { this.clear(); cx?.notify(); }
  }
  trigger(cx) {
    this.clear();
    if (this.accepting || !this.alive || !this.current() || this.input.hasPendingText || this.input.selection().start !== this.input.selection().end) return;
    const offset = this.input.selection().head, text = this.input.value();
    if (!/[\p{L}\p{N}_$."`\[\s]$/u.test(text.slice(0, offset))) return;
    const request = this.pending = { offset, revision: this.input.revision };
    this.timer = cx.timer.after(160, eventCx => { this.timer = null; this.request(request, eventCx); }, { owner: this.owner });
  }
  request(request, cx) {
    if (!this.valid(request)) return;
    this.clear(); const generation = this.generation; this.pending = request;
    const text = this.input.value(), current = () => generation === this.generation && this.valid(request);
    cx.spawn(async taskCx => {
      try {
        const tables = this.catalog ? await this.catalog.resolve(referencedTables(text, request.offset, this.driver), taskCx, current) : [];
        if (!current()) return;
        const result = completeSQL(text, request.offset, { tables, driver: this.driver });
        this.pending = null;
        const items = result.items?.length ? result.items.slice(0, 100) : this.catalog?.error ? [{ label: "스키마 확인 필요", detail: this.catalog.error, disabled_reason: this.catalog.error }] : [];
        if (!items.length) { this.popup = null; taskCx.notify(); return; }
        this.popup = { ...request, ...result, items }; const at = items.findIndex(item => !item.disabled_reason);
        this.selected = at < 0 ? null : String(at); this.menu.at = at; this.menu.ensureVisible(); taskCx.notify();
      } catch (_) { if (current()) { this.popup = null; this.pending = null; taskCx.notify(); } }
    }, { owner: this.owner });
  }
  accept(id, cx) {
    const popup = this.popup, item = popup?.items[Number(id)];
    if (!popup || !item || item.disabled_reason || !this.valid(popup)) return false;
    this.accepting = true; this.clear();
    try {
      const head = popup.from + item.insertText.length;
      this.input.applyEdits([{ from: popup.from, to: popup.to, insert: item.insertText }], cx, { expectedRevision: popup.revision, selection: { anchor: head, head } });
      this.input.focus(); return true;
    } finally { this.accepting = false; cx.notify(); }
  }
  command(command, cx) {
    if (!this.popup || !this.valid(this.popup)) return false;
    if (command === "escape") { this.clear(); cx.notify(); return true; }
    if (command === "newline" || command === "tab") return this.accept(this.selected, cx);
    if (!["up", "down", "pageup", "pagedown"].includes(command)) return false;
    this.menu.key({ keystroke: command }, cx, this.rows(), { closeOnActivate: false }); this.selected = String(this.menu.at); cx.notify(); return true;
  }
  rows() { return (this.popup?.items ?? []).map((item, at) => ({ id: String(at), label: item.label, detail: item.detail, disabled: Boolean(item.disabled_reason) })); }
  render(cx) {
    if (!this.popup || !this.valid(this.popup)) return div().h(0);
    const close = (_event, eventCx) => { this.clear(); this.input.focus(); eventCx.notify(); };
    const bounds = completionBounds(this.input.completionViewport ?? this.input.viewport, this.popup.items.length, Math.max(ADE.rowHeight, adeSize() + 12));
    return { bounds, element: adeCompletionPopup("ade-sql-completion", this.rows(), this.menu, cx, {
      bounds,
      title: this.catalog?.error ? "SQL 자동완성 · 스키마 확인 필요" : "SQL 자동완성 · Enter/Tab 적용 · Esc 닫기", hint: this.catalog?.error, selectedId: this.selected,
      onSelect: (id, _event, eventCx) => { this.selected = id; eventCx.notify(); }, onActivate: (id, _event, eventCx) => this.accept(id, eventCx), onClose: close,
    }) };
  }
}

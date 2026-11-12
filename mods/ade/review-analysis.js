import { backend } from "./backend.js";
import { LspSession } from "./lsp-session.js";
import { GutterNavigation } from "./gutter-navigation.js";

// Review snapshots are immutable. Historical rows get syntax only; language
// requests are allowed only where the reviewed new line matches current text.
export function reviewPosition(row, column, text) {
  if (!Number.isInteger(row?.b) || row.kind === "-" || row.kind === "@") return null;
  const lines = text.split("\n"), line = row.b - 1;
  if (lines[line]?.replace(/\r$/, "") !== row.text) return null;
  return lines.slice(0, line).reduce((n, value) => n + value.length + 1, 0) + Math.max(0, Math.min(row.text.length, column));
}
export function reviewSegments(text, tokens = []) {
  const bounds = new Set([0, text.length]); let offset = 0;
  const spans = tokens.map(([length, category]) => { const from = offset; offset = Math.min(text.length, offset + length); bounds.add(from); bounds.add(offset); return { from, to: offset, category }; });
  for (const match of text.matchAll(/[\p{ID_Continue}$]+|[^\p{ID_Continue}$]+/gu)) { bounds.add(match.index); bounds.add(match.index + match[0].length); }
  const positions = [...bounds].filter(n => n >= 0 && n <= text.length).sort((a, b) => a - b);
  return positions.slice(0, -1).map((from, index) => ({ from, text: text.slice(from, positions[index + 1]), category: spans.find(span => from >= span.from && from < span.to)?.category }));
}
export class ReviewAnalysis {
  init({ owner, beforeOpen, onUpdate, onNavigate }) {
    this.owner = owner; this.beforeOpen = beforeOpen; this.onUpdate = onUpdate; this.onNavigate = onNavigate;
    this.alive = true; this.generation = 0; this.closing = Promise.resolve(); this.state = {}; this.oldTokens = [];
  }
  close(cx) {
    this.gutter?.release(); this.gutter = null;
    this.generation++; const session = this.session; this.session = null; this.target = null; this.state = {}; this.newTokens = []; this.oldTokens = [];
    if (session) this.closing = Promise.allSettled([this.closing, session.close(cx)]).then(() => {});
    return this.closing;
  }
  release(cx) { this.alive = false; return this.close(cx); }
  async load({ context, path, text, oldText, historical = false }, cx) {
    const closing = this.close(cx), generation = this.generation;
    const current = () => this.alive && generation === this.generation;
    await closing; if (!current()) return;
    this.text = text; this.path = path; this.context = context; this.historical = historical; this.oldTokens = [];
    if (!historical && text != null && !context.machine) {
      this.gutter = new GutterNavigation({ path, context, owner: this.owner, onUpdate: (_markers, eventCx) => { if (current()) this.onUpdate(eventCx); } });
      this.gutter.sync(text, 0, cx);
    }
    if (context.machine) { this.state = { status: "unavailable", message: "원격 리뷰는 로컬 LSP를 사용하지 않습니다." }; return; }
    // Tokenizing explicit historical text is pure and never replaces an open document.
    void backend("tokens", { path, text: oldText ?? "" }, cx).then(tokens => { if (current()) { this.oldTokens = tokens; this.onUpdate(cx); } }).catch(() => {});
    void backend("tokens", { path, text: text ?? "" }, cx).then(tokens => { if (current()) { this.newTokens = tokens; this.onUpdate(cx); } }).catch(() => {});
    if (historical || text == null) { this.state = { status: "unsupported", message: "이전 소스 · 현재 LSP 탐색 제외" }; return; }
    const released = await this.beforeOpen?.(path, cx); if (!current()) return;
    if (released === false) {
      this.state = { status: "error", error: "이 파일의 이전 분석 세션을 정리하지 못했습니다. 소스 파일을 다시 열어 분석을 확인한 뒤 리뷰를 다시 선택하세요." };
      this.onUpdate(cx); return;
    }
    const info = await backend("info", { path }, cx); if (!current()) return;
    if (!info?.lang || info.library) { this.state = { status: "unsupported", message: "이 파일 형식은 언어 서버를 사용하지 않습니다." }; this.onUpdate(cx); return; }
    const session = this.session = new LspSession();
    session.init(cx, { owner: this.owner, onUpdate: (state, eventCx) => { if (current()) { this.state = state; this.onUpdate(eventCx); } }, onNavigate: (location, eventCx) => { if (current()) this.onNavigate(location, eventCx); } });
    session.setActive(true, cx);
    session.sync({ project: context, path, text, revision: 0, selection: { head: 0, anchor: 0 } }, cx);
  }
  select(row, column, cx) {
    const offset = !this.historical && this.session && reviewPosition(row, column, this.text);
    if (offset === null || offset === false || offset === undefined) return false;
    this.target = { row, column, offset };
    this.session.sync({ project: this.context, path: this.path, text: this.text, revision: 0, selection: { head: offset, anchor: offset } }, cx);
    return true;
  }
  async request(kind, cx) { if (this.target && this.session) return this.session.request(kind, cx); }
  marker(row) {
    if (reviewPosition(row, 0, this.text ?? "") === null || this.historical) return null;
    const marker = this.gutter?.at(row.b - 1);
    return marker?.kind === "http" ? null : marker;
  }
  async requestMarker(row, marker, cx) {
    if (this.marker(row) !== marker) return;
    if (!marker.kind.startsWith("spring")) { if (this.select(row, marker.col, cx)) return this.request(marker.kind, cx); return; }
    const generation = this.generation, locations = await this.gutter.resolve(marker, cx);
    if (!this.alive || generation !== this.generation || !locations) return;
    if (locations.length === 1) this.onNavigate(locations[0], cx);
    else { this.state = { ...this.state, locations, message: locations.length ? null : "이동할 Spring 위치가 없습니다." }; this.onUpdate(cx); }
  }
  tokens(row) { return row.kind === "-" ? this.oldTokens?.[row.a - 1] : this.state.tokens?.[row.b - 1] ?? this.newTokens?.[row.b - 1]; }
  diagnostics(row) { return reviewPosition(row, 0, this.text ?? "") === null ? [] : (this.state.diagnostics ?? []).filter(item => (item.line ?? item.range?.start?.line) === row.b - 1); }
}

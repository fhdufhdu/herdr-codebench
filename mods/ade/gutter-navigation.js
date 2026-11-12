import { navigationMarkers } from "./navigation-markers.js";
import { httpRequests, isHttp } from "./http-client.js";
import { backend } from "./backend.js";

export const gutterIcon = marker => marker.kind === "http" ? "play" : marker.kind.startsWith("spring") ? "layers" : marker.kind === "implementation" ? "arrow-down" : "arrow-up";
export function sourceGutterMarkers(path, text) {
  const lines = text.split("\n");
  if (isHttp(path)) return httpRequests(lines).map((request, index) => ({ kind: "http", line: request.line, col: 0, requestIndex: index, title: "이 HTTP 요청 실행…" }));
  const markers = navigationMarkers(lines, path).map(marker => ({ ...marker, title: "상위 선언·인터페이스로 이동" }));
  if (/\.(java|kt|kts|ts|tsx)$/i.test(path)) lines.forEach((text, line) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(text)) return;
    const match = /\binterface\s+([\p{ID_Start}_$][\p{ID_Continue}$]*)/u.exec(text);
    if (match) markers.push({ kind: "implementation", line, col: match.index + match[0].lastIndexOf(match[1]), title: "이 인터페이스의 구현 찾기" });
  });
  return markers;
}

// Markers always describe one exact text revision. Late scans cannot attach
// a clickable target to a different line after typing, reload or release.
export class GutterNavigation {
  constructor({ path, context, owner, onUpdate }) { this.path = path; this.context = context; this.owner = owner; this.onUpdate = onUpdate; this.alive = true; this.generation = 0; this.markers = []; }
  sync(text, revision, cx) {
    if (!this.alive || this.text === text && this.revision === revision) return;
    this.text = text; this.revision = revision; const generation = ++this.generation;
    this.timer?.cancel(); this.markers = sourceGutterMarkers(this.path, text); this.onUpdate(this.markers, cx);
    if (this.context.machine || !/\.(java|kt|kts)$/i.test(this.path)) return;
    this.timer = cx.timer.after(300, eventCx => {
      this.timer = null;
      eventCx.spawn(async taskCx => {
        try {
          const spring = await backend("spring_markers", { path: this.path, root: this.context.root, text }, taskCx);
          if (!this.alive || generation !== this.generation) return;
          const repositories = new Set((spring ?? []).filter(marker => marker.kind === "spring-bean" && marker.title?.includes("dynamic proxy")).map(marker => marker.line));
          // A generated repository has no project implementation class. Its
          // gutter action finds injection uses instead of promising one.
          this.markers = [...this.markers.filter(marker => marker.kind !== "implementation" || !repositories.has(marker.line)), ...(spring ?? []).map(marker => ({ ...marker, title: marker.kind === "spring-bean" ? repositories.has(marker.line) ? `Spring Data 저장소 사용 위치 · ${marker.name} · 실행 시 구현 생성` : `Spring 빈 사용 위치 · ${marker.name}` : marker.kind === "spring-property" ? `Spring 설정 위치 · ${marker.key}` : `주입된 Spring 빈으로 이동 · ${marker.name || marker.type}` }))];
          this.onUpdate(this.markers, taskCx);
        } catch (_) { /* Syntax/LSP navigation remains usable without Spring indexing. */ }
      }, { owner: this.owner });
    }, { owner: this.owner });
  }
  at(line) { return this.markers.find(marker => marker.line === line); }
  async resolve(marker, cx) {
    if (!this.alive || !this.markers.includes(marker) || !marker.kind.startsWith("spring")) return null;
    const generation = this.generation;
    const result = await backend("related", { ...marker, path: this.path, root: this.context.root, text: this.text }, cx);
    return this.alive && this.generation === generation ? result : null;
  }
  release() { this.alive = false; this.generation++; this.timer?.cancel(); }
}

export function editOffset(text, point) {
  if (!Number.isInteger(point?.line) || !Number.isInteger(point?.character) || point.line < 0 || point.character < 0) throw new Error("편집 위치가 올바르지 않습니다.");
  const lines = text.split("\n"); if (point.line >= lines.length || point.character > lines[point.line].replace(/\r$/, "").length) throw new Error("편집 위치가 현재 버퍼를 벗어납니다.");
  const offset = lines.slice(0, point.line).reduce((sum, line) => sum + line.length + 1, 0) + point.character;
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) throw new Error("편집 위치가 Unicode 문자를 나눕니다.");
  return offset;
}
export function textEdits(text, edits) {
  if (!Array.isArray(edits)) throw new Error("편집 배열이 필요합니다.");
  const result = edits.map(edit => {
    if (typeof edit?.newText !== "string" || edit.uri || edit.textDocument) throw new Error("현재 문서의 일반 텍스트 편집만 지원합니다.");
    const from = editOffset(text, edit.range?.start), to = editOffset(text, edit.range?.end);
    if (to < from) throw new Error("편집 범위가 뒤집혀 있습니다.");
    return { from, to, insert: edit.newText };
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < result.length; i++) if (result[i].from < result[i - 1].to || result[i].from === result[i - 1].from) throw new Error("겹치거나 모호한 편집은 적용할 수 없습니다.");
  return result;
}
export function completionEdits(text, item, offset) {
  if (item?.disabled_reason) throw new Error(item.disabled_reason);
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error("자동완성 위치가 현재 버퍼를 벗어납니다.");
  const insert = item?.insert_text ?? item?.label;
  if (typeof insert !== "string") throw new Error("일반 텍스트 자동완성만 지원합니다.");
  const prefix = /[\p{L}\p{N}_$]+$/u.exec(text.slice(0, offset))?.[0] ?? "";
  const primary = item.text_edit ?? { range: null, newText: insert };
  const main = item.text_edit ? textEdits(text, [primary])[0] : { from: offset - prefix.length, to: offset, insert };
  const additional = textEdits(text, item.additional_text_edits ?? []), edits = [...additional, main].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < edits.length; i++) if (edits[i].from < edits[i - 1].to || edits[i].from === edits[i - 1].from) throw new Error("자동완성/추가 편집 범위가 겹칩니다.");
  const caret = main.from + main.insert.length + additional.filter(edit => edit.to <= main.from).reduce((sum, edit) => sum + edit.insert.length - (edit.to - edit.from), 0);
  return { edits, selection: { anchor: caret, head: caret } };
}
export function lineCommentPrefix(path) {
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|java|kt|kts|go|rs|swift|c|h|cpp|hpp|cs)$/i.test(path)) return "//";
  if (/\.(?:py|pyi|sh|bash|zsh|rb|yaml|yml|toml|properties)$/i.test(path)) return "#";
  return /\.sql$/i.test(path) ? "--" : null;
}

export function completionCandidates(text, offset, items) {
  const prefix = /[\p{L}\p{N}\p{M}_$]+$/u.exec(text.slice(0, offset))?.[0]?.toLowerCase();
  if (!prefix) return items.slice(0, 100);
  return items.filter(item => String(item.filter_text || item.label || "").replace(/^["'`]+/, "").toLowerCase().startsWith(prefix)).slice(0, 100);
}

export function completionBounds(viewport, count, rowHeight) {
  const width = Math.max(0, Math.min(460, (Number(viewport?.width) || 0) - 24));
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  const caretTop = Math.max(0, Math.min(viewportHeight, Number(viewport?.caretTop) || 0));
  const below = Math.max(0, viewportHeight - caretTop - (Number(viewport?.caretHeight) || 0) - 4);
  const above = Math.max(0, caretTop - 4), desired = Math.min(320, 32 + count * rowHeight);
  const flip = below < desired && above > below;
  const height = Math.max(0, Math.min(desired, flip ? above : below));
  return { width, height, anchor: flip ? "bottom_left" : "top_left", headerHeight: Math.min(32, height) };
}

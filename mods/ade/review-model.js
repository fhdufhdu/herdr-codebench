export const REVIEW_LIMIT = 20000;
export function reviewFiles(names, stats = "", untracked = "") {
  const counts = new Map();
  for (const record of stats.split("\0")) {
    if (!record) continue;
    const first = record.indexOf("\t"), second = record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const add = record.slice(0, first), remove = record.slice(first + 1, second);
    counts.set(record.slice(second + 1), { add: add === "-" ? null : Number(add), remove: remove === "-" ? null : Number(remove) });
  }
  const parts = names.split("\0"), files = new Map();
  for (let i = 0; i + 1 < parts.length && files.size < REVIEW_LIMIT; i += 2) {
    const status = parts[i], path = parts[i + 1]; if (!status || !path) continue;
    files.set(path, { id: path, path, status: status[0], ...counts.get(path) });
  }
  for (const path of untracked.split("\0")) if (path && !path.endsWith("/") && !files.has(path) && files.size < REVIEW_LIMIT) files.set(path, { id: path, path, status: "?", untracked: true });
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}
export function reviewRows(patch) {
  const rows = []; let oldLine = 0, newLine = 0, active = false;
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { active = true; oldLine = Number(hunk[1]); newLine = Number(hunk[2]); rows.push({ kind: "@", text }); }
    else if (active && text.startsWith("+")) rows.push({ kind: "+", b: newLine++, text: text.slice(1) });
    else if (active && text.startsWith("-")) rows.push({ kind: "-", a: oldLine++, text: text.slice(1) });
    else if (active && text.startsWith(" ")) rows.push({ kind: " ", a: oldLine++, b: newLine++, text: text.slice(1) });
    if (rows.length >= REVIEW_LIMIT) break;
  }
  return rows;
}
export function newFileRows(text) {
  if (!text || text.includes("\0")) return [];
  return text.replace(/\n$/, "").split("\n").slice(0, REVIEW_LIMIT).map((text, index) => ({ kind: "+", b: index + 1, text }));
}
export function differenceIndex(rows, current, direction) {
  const starts = rows.map((row, index) => ["+", "-"].includes(row.kind) && !["+", "-"].includes(rows[index - 1]?.kind) ? index : -1).filter(index => index >= 0);
  if (!starts.length) return null;
  return direction > 0 ? starts.find(index => index > (current ?? -1)) ?? starts[0]
    : starts.reverse().find(index => index < (current ?? rows.length)) ?? starts[0];
}
export function sourceLine(rows, index = 0) {
  return rows[index]?.b ?? rows.slice(index).find(row => row.b !== undefined)?.b ?? rows.slice(0, index).reverse().find(row => row.b !== undefined)?.b ?? 1;
}
export function reviewRange(rows, from, to, path) {
  const range = rows.slice(Math.min(from, to), Math.max(from, to) + 1).filter(row => row.kind !== "@");
  if (!range.length) return null;
  const fresh = range.filter(row => row.b !== undefined), side = fresh.length ? "new" : "old";
  const lines = (fresh.length ? fresh : range).map(row => side === "new" ? row.b : row.a);
  return { path, side, start: Math.min(...lines), end: Math.max(...lines), code: range.slice(0, 30).map(row => `${row.kind} ${row.text}`) };
}
export function reviewMessage(state, comments) {
  return [`코드 리뷰 · ${state.head || "현재 checkout"} ← ${state.base || "HEAD"}${state.mode === "head" || state.head ? " · 커밋만" : " · 작업 트리 포함"}`, "",
    [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start).map((comment, index) => [
      `${index + 1}. ${comment.path}:${comment.start}${comment.end !== comment.start ? `–${comment.end}` : ""}${comment.side === "old" ? " · 삭제된 줄" : ""}${comment.base !== undefined && (comment.base !== state.base || (comment.head ?? null) !== (state.head ?? null) || comment.mode !== state.mode) ? ` · 이전 비교 범위 (${comment.base} → ${comment.head || "checkout"})` : ""}`,
      ...(comment.code?.length ? ["```", ...comment.code.slice(0, 30), "```"] : []), comment.body,
    ].join("\n")).join("\n\n")].join("\n");
}

// Changed files only; directory nodes do not read or mutate the working tree.
export function reviewFileTree(files, collapsed = new Set()) {
  const root = { children: new Map() };
  for (const file of files) {
    if (!file.path || file.path.endsWith("/")) continue;
    const parts = file.path.split("/"); let parent = root, path = "";
    parts.forEach((name, index) => {
      path = path ? `${path}/${name}` : name;
      const key = `${index === parts.length - 1 ? "file" : "directory"}:${name}`;
      if (!parent.children.has(key)) parent.children.set(key, { id: index === parts.length - 1 ? file.path : `${path}/`, path, name, children: new Map() });
      parent = parent.children.get(key);
      if (index === parts.length - 1) parent.file = file;
    });
  }
  const rows = [];
  function visit(parent, depth) {
    const children = [...parent.children.values()].sort((a, b) => Number(!a.file) === Number(!b.file) ? a.name.localeCompare(b.name) : a.file ? 1 : -1);
    for (const node of children) {
      const folder = !node.file; rows.push({ ...node, folder, depth, expanded: folder && !collapsed.has(node.path) });
      if (folder && !collapsed.has(node.path)) visit(node, depth + 1);
    }
  }
  visit(root, 0); return rows;
}

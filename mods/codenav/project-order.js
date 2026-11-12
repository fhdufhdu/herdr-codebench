// space.move uses a one-based position in spaces(), as the shipped spaces mod does.
// Do not keep another persistent order: the core owns it.
export const PROJECT_SORT_KEY = "codenav.projectSort";
export const PROJECT_RECENT_KEY = "codenav.projectRecent";
export const PROJECT_SORTS = [
  { id: "name", label: "Name Order" },
  { id: "recent", label: "Recently Used" },
  { id: "manual", label: "Custom Order" },
];

export function projectSortMode(value) {
  return PROJECT_SORTS.some(mode => mode.id === value) ? value : "manual";
}

export function rememberProject(list, recent, id) {
  const live = new Set(list.map(space => space.id));
  const previous = Array.isArray(recent) ? recent : [];
  return [...new Set([id, ...previous])].filter(key => live.has(key));
}

export function sortedProjects(list, mode, recent) {
  if (mode !== "name" && mode !== "recent") return list;
  const ranks = new Map((Array.isArray(recent) ? recent : []).map((id, index) => [id, index]));
  const groups = new Map();
  for (const space of list) {
    const machine = space.machine ?? null;
    if (!groups.has(machine)) groups.set(machine, []);
    groups.get(machine).push(space);
  }
  return [...groups.values()].flatMap(group => group.sort((a, b) => mode === "name"
    ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    : (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER)));
}

export function projectMove(list, id, direction) {
  if (!id || (direction !== -1 && direction !== 1)) return null;
  const from = list.findIndex(space => space.id === id);
  if (from < 0) return null;
  const target = list[from + direction];
  if (!target || (target.machine ?? null) !== (list[from].machine ?? null)) return null;
  return { id, index: from + direction + 1 };
}

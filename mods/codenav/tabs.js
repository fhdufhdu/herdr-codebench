// The strip above the editor area: one tab per open file and per reviewed file,
// like VS Code's editor tabs, kept per space in shared "codenav.tabs". It also
// keeps the editor stack on the right child: the code view for source files,
// the activity editor for pictures, PDFs and edits, or the review.
// Right-click a tab for Close / Close Others / Close All; Cmd+W in the code
// view closes the shown tab (the status item takes the command).
// Back / forward (Ctrl+- / Ctrl+Shift+-) walk the tabs shown before, per space: the
// last 10, skipping tabs closed since. IDEA keeps its navigation arrows after
// the tabs so the first file starts at the editor island's left edge.
import { div } from "gpui-kit";
import { T } from "./i18n.js";
import { h_flex, v_flex } from "gpui-base";
import { theme, shared, setShared, layout, run, spaces, openOverlay, closeOverlay, props } from "herdr";
import { icon, iconButton, find, STACK, AREA, CHILD, editorSpec, editorKey, setEditorSpec, wantedChild, showReview, basename, location } from "./common.js";
import { ideaImage } from "./ideaicons.js";
import { IDEA, isIdea, uiSize, ideaUI, uiColors, popupSurface, uiTab, uiTabStrip, TabViewport, uiMenu, uiPopupSize, MenuController, uiNotify } from "./idea-design.js";
import { fileTabId as fileId, recentFileTabs, visitFile, tabAfterClose } from "./editor-history.js";

const KEY = "codenav.tabs";
const MAX = 100;
const reviewId = (r) => `r:${r.rkey}:${r.path}`;
function fileGraphic(spec, size) {
  if (spec.kind === "database") return icon(spec.database?.kind === "table" ? "table" : "code", size);
  return ideaImage(spec.path, false, size);
}

// -- the open tabs of the shown space ----------------------------------------------
const tabsNow = () => (shared(KEY) ?? {})[editorKey()] ?? [];
// Reviews only belong to the repository currently shown by this space.
const visibleTabs = () => {
  const { cwd, on } = location();
  return tabsNow().filter((x) => {
    if (x.type !== "review") return true;
    const at = x.rkey.indexOf(":"), host = x.rkey.slice(0, at), root = x.rkey.slice(at + 1);
    return host === (on ?? "") && Boolean(cwd) && (cwd + "/").startsWith(root + "/");
  });
};
function setTabs(list) {
  const all = { ...(shared(KEY) ?? {}) };
  all[editorKey()] = list.slice(-MAX);
  setShared(KEY, all);
}
function databaseState(spec) {
  if (spec?.kind !== "database" || !find(layout(), CHILD.database)) return {};
  const states = Object.values(shared("codenav.databaseState") || {})
    .filter(owner => owner.layout === shared("layout")).map(owner => owner.documents?.[spec.path]);
  return { dirty: states.some(state => state?.dirty), busy: states.some(state => state?.busy) };
}
const reviewing = () => shared("codenav.area") === "review";
// The reviewed file, if it belongs to the shown space (each space has its own repository).
function current() {
  const r = shared("codenav.review.current");
  if (!r || r.space !== spaces().find((s) => s.active)?.id) return null;
  const { cwd, on } = location(), at = r.rkey.indexOf(":"), root = r.rkey.slice(at + 1);
  return r.rkey.slice(0, at) === (on ?? "") && cwd && (cwd + "/").startsWith(root + "/") ? r : null;
}
function activeId() {
  if (reviewing()) { const r = current(); if (r?.path) return reviewId(r); }
  const s = editorSpec();
  return s ? fileId(s) : null;
}

function openTab(tab) {
  // A click/history callback can outlive the tab it was created for.
  if (!tabsNow().some(x => x.id === tab.id)) return;
  if (tab.type === "file") {
    if (reviewing()) setShared("codenav.area", null);
    const cur = editorSpec();
    if (!cur || fileId(cur) !== tab.id) setEditorSpec(editorKey(), tab.spec);
    return;
  }
  const all = { ...(shared("codenav.reviews") ?? {}) };
  if (all[tab.rkey]?.selected !== tab.path) { all[tab.rkey] = { ...all[tab.rkey], selected: tab.path }; setShared("codenav.reviews", all); }
  showReview();
}

// Closes the tabs with these ids; when the shown one goes, its neighbour shows,
// and with none left IDEA keeps its empty editor island.
function closeTabs(ids) {
  const list = tabsNow(), gone = new Set(ids), active = activeId();
  const key = editorKey(), h = historyNow();
  const editorState = (shared("activity.editorState") ?? {})[key];
  if (isIdea() && editorState?.path && (editorState.dirty || editorState.saving) && gone.has(fileId(editorState))) {
    const requests = shared("activity.closeRequest") ?? {}, previous = requests[key];
    if (!previous || previous.status !== "pending" || JSON.stringify(previous.ids) !== JSON.stringify(ids)) {
      setShared("activity.closeRequest", { ...requests, [key]: { token: `${Date.now()}-${Math.random()}`, key, ids, path: editorState.path, on: editorState.on ?? null, status: "pending" } });
    }
    run("layout.select", { stack: STACK, child: CHILD.text });
    if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
    return false;
  }
  const currentSpec = editorSpec();
  const candidates = [...list, ...(currentSpec ? [{ id: fileId(currentSpec), type: "file", spec: currentSpec }] : [])];
  const protectedTab = candidates.find(tab => {
    if (!gone.has(tab.id) || tab.type !== "file") return false;
    const state = databaseState(tab.spec); return state.dirty || state.busy;
  });
  if (protectedTab) {
    const state = databaseState(protectedTab.spec);
    if (reviewing()) setShared("codenav.area", null);
    setEditorSpec(key, protectedTab.spec);
    run("layout.select", { stack: STACK, child: CHILD.database });
    if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
    uiNotify({ title: T("Database tab kept open"), body: T(state.busy
      ? "Wait for the database operation to finish, or cancel the running query, then close again."
      : "Save or discard the SQL draft, or apply or revert table changes, then close again."), level: "warning" });
    return false;
  }
  const recent = recentFileTabs((shared("codenav.recentFiles") ?? {})[key], h.list, list);
  if (isIdea() && list.some(tab => gone.has(tab.id) && tab.type === "file")) {
    setShared("codenav.recentFiles", { ...(shared("codenav.recentFiles") ?? {}), [key]: recent });
  }
  const next = tabAfterClose(isIdea() ? visibleTabs() : list, active, gone, [...recent.map(tab => tab.id), ...h.list.slice().reverse().map(tab => tab.id)], isIdea());
  const rest = list.filter((x) => !gone.has(x.id));
  if (isIdea()) {
    const closed = list.filter(tab => gone.has(tab.id) && tab.type === "file");
    if (closed.length) setShared("codenav.closedTabs", { ...(shared("codenav.closedTabs") ?? {}), [key]: [...closed.slice().reverse(), ...((shared("codenav.closedTabs") ?? {})[key] ?? [])].slice(0, 20) });
  }
  setTabs(rest);
  // The editor's file goes with its tab, or the strip would bring the tab back.
  const spec = editorSpec();
  if (spec && gone.has(fileId(spec))) setEditorSpec(editorKey(), null);
  if (!gone.has(active) && (!isIdea() || visibleTabs().length)) return;
  if (gone.has(active) && next) return openTab(next);
  setEditorSpec(editorKey(), null);
  if (reviewing()) setShared("codenav.area", null);
  if (isIdea()) {
    run("layout.select", { stack: STACK, child: CHILD.code });
    if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
  } else run("layout.hide", { id: AREA });
}
// Cmd+Shift+] / Cmd+Shift+[ (and Ctrl+→ / Ctrl+←): the editor tab beside the shown one.
export function stepTab(dir) {
  const list = tabsNow(), at = list.findIndex((x) => x.id === activeId());
  if (list.length) openTab(list[(at + dir + list.length) % list.length]);
}
export const closeTab = (id) => closeTabs([id ?? activeId() ?? (isIdea() ? visibleTabs().slice(-1)[0]?.id : null)].filter(Boolean));
export const closeOthers = (id) => { const keep = tabsNow().find((x) => x.id === id); if (closeTabs(tabsNow().filter((x) => x.id !== id && (!isIdea() || !x.pinned)).map((x) => x.id)) !== false && keep) openTab(keep); };
export const closeAll = () => closeTabs([...tabsNow().map(x => x.id), activeId()].filter(Boolean));
export function pinTab(id, pinned) { setTabs(tabsNow().map(tab => tab.id === id ? { ...tab, pinned: pinned ?? !tab.pinned } : tab)); }
export function reopenClosedTab() {
  const key = editorKey(), all = shared("codenav.closedTabs") ?? {}, closed = all[key] ?? [];
  if (!closed.length) return false;
  const [tab, ...rest] = closed; setShared("codenav.closedTabs", { ...all, [key]: rest });
  if (!tabsNow().some(open => open.id === tab.id)) setTabs([...tabsNow(), tab]);
  openTab(tab);
  if (find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
  return true;
}
export function resumeClose({ key, token }) {
  const requests = shared("activity.closeRequest") ?? {}, request = requests[key];
  if (key !== editorKey() || request?.token !== token || request.status !== "approved") return false;
  const state = (shared("activity.editorState") ?? {})[key];
  if (state?.path === request.path && (state.on ?? null) === request.on && (state.dirty || state.saving)) return false;
  const rest = { ...requests }; delete rest[key]; setShared("activity.closeRequest", rest);
  closeTabs(request.ids); return true;
}

// -- where the space's tabs have been: shared "codenav.history" ----------------------------
const HISTORY = 10;
const historyNow = () => (shared("codenav.history") ?? {})[editorKey()] ?? { list: [], at: -1 };
function setHistory(h) { setShared("codenav.history", { ...(shared("codenav.history") ?? {}), [editorKey()]: h }); }
// A tab that shows becomes the newest place, dropping the places ahead of it.
function noteShown(tab) {
  const h = historyNow();
  if (h.list[h.at]?.id === tab.id) return false;
  if (h.going && Date.now() - h.going < 1500) return false;
  const list = [...h.list.slice(0, h.at + 1).filter((x) => x.id !== tab.id), tab].slice(-HISTORY);
  setHistory({ list, at: list.length - 1 });
  return true;
}
// The nearest place that way whose tab is still open, or -1.
function nextOpen(h, dir) {
  const open = new Set(tabsNow().map((x) => x.id));
  for (let i = h.at + dir; i >= 0 && i < h.list.length; i += dir) if (open.has(h.list[i].id)) return i;
  return -1;
}
function step(dir) {
  const h = historyNow(), i = nextOpen(h, dir);
  if (i < 0) return;
  // Until it shows (a review tab takes a moment), what shows isn't a new place.
  setHistory({ ...h, at: i, going: Date.now() });
  openTab(h.list[i]);
}
export const tabBack = () => step(-1);
export const tabForward = () => step(1);
export const canStep = (dir) => nextOpen(historyNow(), dir) >= 0;

// The always-visible status view owns routing, including while the tab strip
// or editor area is hidden. A new explorer file must be able to restore tabs.
export function routeEditor(self, cx) {
    if (!find(layout(), STACK)) return;
    const key = editorKey();
    const closing = (shared("activity.closeRequest") ?? {})[key];
    if (closing?.status === "approved" && self.approving !== closing.token) {
      self.approving = closing.token;
      cx.timer.after(0, () => { self.approving = null; resumeClose({ key, token: closing.token }); });
    }
    const spec = editorSpec();
    const at = spec?.at ?? 0;
    if (self.routeKey === key && self.lastAt !== undefined && at > self.lastAt && reviewing()) {
      cx.timer.after(0, () => { if (editorKey() === key && JSON.stringify(editorSpec()) === JSON.stringify(spec)) setShared("codenav.area", null); });
    }
    self.routeKey = key;
    self.lastAt = at;
    const ids = new Set(tabsNow().map((x) => x.id));
    const add = [];
    if (spec && !ids.has(fileId(spec))) add.push({ id: fileId(spec), type: "file", spec: spec.kind === "database"
      ? { kind: "database", path: spec.path, rel: spec.rel, database: spec.database, on: null }
      : { kind: "file", path: spec.path, root: spec.root, rel: spec.rel, on: spec.on ?? null } });
    const r = current();
    if (reviewing() && r?.path && !ids.has(reviewId(r))) add.push({ id: reviewId(r), type: "review", rkey: r.rkey, path: r.path });
    const sig = JSON.stringify([key, add.map(x => x.id)]);
    if (add.length && self.adding !== sig) {
      self.adding = sig;
      cx.timer.after(0, () => {
        self.adding = null;
        if (editorKey() !== key) return;
        const file = editorSpec(), review = current();
        const live = add.filter(x => x.type === "file" ? file && fileId(file) === x.id
          : reviewing() && review?.path && reviewId(review) === x.id);
        if (live.length) setTabs([...tabsNow().filter(x => !live.some(a => a.id === x.id)), ...live]);
      });
    }
    const shown = tabsNow().find((x) => x.id === activeId());
    const h = historyNow();
    // The MRU is independent of back/forward history and survives tab close.
    // The visible Status remains its owner; render only schedules the write.
    if (isIdea() && shown?.type === "file" && (shared("codenav.recentFiles") ?? {})[key]?.[0]?.id !== shown.id && self.remembering !== shown.id) {
      self.remembering = shown.id;
      cx.timer.after(0, () => {
        self.remembering = null;
        if (editorKey() !== key || activeId() !== shown.id || !tabsNow().some(tab => tab.id === shown.id)) return;
        const all = shared("codenav.recentFiles") ?? {};
        setShared("codenav.recentFiles", { ...all, [key]: visitFile(recentFileTabs(all[key], historyNow().list, tabsNow()), shown) });
      });
    }
    if (shown && h.list[h.at]?.id !== shown.id && self.noting !== shown.id && !(h.going && Date.now() - h.going < 1500)) {
      self.noting = shown.id;
      cx.timer.after(0, () => { self.noting = null; if (editorKey() === key && activeId() === shown.id && tabsNow().some(x => x.id === shown.id)) noteShown(shown); });
    }
    const want = wantedChild(), now = find(layout(), STACK)?.active;
    if (want !== now && self.routing !== want) {
      self.routing = want;
      cx.timer.after(0, () => { self.routing = null; if (editorKey() === key && wantedChild() === want) run("layout.select", { stack: STACK, child: want }); });
    }
    const strip = find(layout(), "editor-tabs");
    const empty = isIdea() && !spec && !(reviewing() && current()?.path) && !visibleTabs().length;
    if (isIdea() && find(layout(), AREA)?.hidden && !self.areaSyncing) {
      self.areaSyncing = true;
      cx.timer.after(0, () => {
        self.areaSyncing = false;
        if (editorKey() === key && isIdea() && find(layout(), AREA)?.hidden) run("layout.show", { id: AREA });
      });
    }
    if (strip && Boolean(strip.hidden) !== empty && !self.stripSyncing) {
      self.stripSyncing = true;
      cx.timer.after(0, () => {
        self.stripSyncing = false;
        if (editorKey() !== key) return;
        const hide = isIdea() && !editorSpec() && !(reviewing() && current()?.path) && !visibleTabs().length;
        if (Boolean(find(layout(), "editor-tabs")?.hidden) !== hide) run(hide ? "layout.hide" : "layout.show", { id: "editor-tabs" });
      });
    }
}

export default class Tabs {
  init() { this.viewport = new TabViewport(); }

  render(cx) {
    const t = theme(), active = activeId();
    const comments = new Map();
    for (const [rkey, st] of Object.entries(shared("codenav.reviews") ?? {}))
      for (const c of st.comments ?? []) comments.set(`${rkey}:${c.path}`, (comments.get(`${rkey}:${c.path}`) ?? 0) + 1);
    const tab = (x, i) => {
      const on = x.id === active;
      const name = x.type === "file" ? basename(x.spec.rel ?? x.spec.path) : basename(x.path);
      const dirty = x.type === "file" && databaseState(x.spec).dirty;
      const count = x.type === "review" ? comments.get(`${x.rkey}:${x.path}`) ?? 0 : 0;
      // Opens on press: the close button stops its press, so closing never reopens the tab.
      const idea = shared("layout") === "idea";
      if (idea) return uiTab(`cn-tab-${x.id}`, [
        x.type === "file" ? fileGraphic(x.spec, IDEA.iconSize) : icon("git-branch", IDEA.iconSize).text_color(t.accent),
        div().max_w(180).truncate().when(on, el => el.font_semibold()).child(name),
        ...(dirty ? [div().text_color(uiColors().warning).tooltip(T("Unsaved database changes")).child("●")] : []),
        ...(x.pinned ? [div().text_size(10).tooltip(T("Pinned Tab")).child("•")] : []),
        ...(count > 0 ? [div().px(5).h(15).flex().items_center().rounded(8).bg(t.accent).text_color(t.accent_foreground).text_size(10).font_bold().child(String(count))] : []),
      ], { selected: on, onSelect: () => openTab(x), onClose: () => closeTab(x.id), closeIcon: icon("x", 11),
        tip: x.type === "file" ? x.spec.rel ?? x.spec.path : `${T("Review")} · ${x.path}` })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "codenav", props: { view: "tabmenu", id: x.id }, kind: "popup", frame: "none", ...uiPopupSize(6, { width: 210 }) });
        });
      return h_flex().id(`cn-tab-${i}`).flex_none().pl(12).pr(6).gap(6).items_center().text_size(12).cursor_pointer()
        .h_full().border_b(2).border_color(on ? t.accent : "#00000000").when(on, el => el.bg(t.background))
        .text_color(on ? t.foreground : t.muted).hover((e) => e.text_color(t.foreground))
        .tooltip(x.type === "file" ? x.spec.rel ?? x.spec.path : `${T("Review")} · ${x.path}`)
        .on_mouse_down("left", () => openTab(x))
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); closeTab(x.id); })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "codenav", props: { view: "tabmenu", id: x.id }, kind: "popup", width: 210, height: 112 });
        })
        .child(x.type === "file" && shared("layout") === "idea" ? ideaImage(x.spec.path, false, 14)
          : icon(x.type === "file" ? "file-text" : "git-branch", 13).text_color(x.type === "review" ? t.accent : on ? t.foreground : t.muted))
        .child(div().max_w(180).truncate().child(name))
        .when(dirty, el => el.child(div().text_color(t.working).tooltip(T("Unsaved database changes")).child("●")))
        .when(count > 0, (e) => e.child(div().px(5).h(15).flex().items_center().rounded(8).bg(t.accent).text_color(t.accent_foreground).text_size(10).font_bold().child(String(count))))
        .child(iconButton(`cn-tab-x-${i}`, "x", T("Close (Cmd+W)"), () => closeTab(x.id), { size: 16, icon: 11 }));
    };
    const list = visibleTabs();
    const ideaLook = shared("layout") === "idea";
    const navigation = () => h_flex().flex_none().h_full().px(4).gap(2).items_center().when(!ideaLook, (e) => e.border_r(1).border_color(t.border))
      .child(iconButton("cn-tabs-back", "chevron-left", T(ideaLook ? "Back (Cmd+[)" : "Previous tab (Ctrl+-)"), () => ideaLook ? run("codenav.nav-back") : tabBack(), { color: ideaLook || canStep(-1) ? t.muted : t.dim }))
      .child(iconButton("cn-tabs-fwd", "chevron-right", T(ideaLook ? "Forward (Cmd+])" : "Next tab (Ctrl+Shift+-)"), () => ideaLook ? run("codenav.nav-forward") : tabForward(), { color: ideaLook || canStep(1) ? t.muted : t.dim }));
    return ideaUI(h_flex()).id("codenav-tabs").size_full().pr(6).items_center().bg(ideaLook ? uiColors().editor : t.chrome).when(!ideaLook, (e) => e.border_b(1).border_color(t.border)).when(ideaLook, (e) => e.rounded_t(IDEA.islandRadius))
      .when(!ideaLook, e => e.child(navigation()))
      .child(ideaLook ? uiTabStrip("cn-tabs-scroll", list.map((x, i) => ({ id: x.id, content: tab(x, i) })), active, this.viewport)
        : h_flex().id("cn-tabs-scroll").flex_1().min_w(0).h_full().overflow_x_scrollbar()
          .children(list.length ? list.map(tab) : [div().px(12).text_size(12).text_color(t.dim).child(T("Editor"))]))
      .when(ideaLook, e => e.child(navigation()))
      .when(!ideaLook, (e) => e.child(iconButton("cn-area-x", "x", T("Hide the editor area (Ctrl+Alt+E)"), () => run("layout.hide", { id: AREA }))))
      .when(ideaLook, (e) => e.child(iconButton("cn-tabs-list", "chevron-down", T("Open Tabs"), () => openOverlay({ mod: "codenav", props: { view: "tablist" }, kind: "popup", frame: "none", ...uiPopupSize(Math.max(1, list.length), { width: 360, maxHeight: 360 }) }))));
  }
}

// The right-click menu of a tab (a popup).
export class TabMenu {
  init(_p, cx) { this.menu = new MenuController(cx); this.menu.focus.focus(); }
  release() { this.menu.release(); }
  render(cx) {
    const t = theme(), { id, overlay } = props() ?? {};
    const actions = [() => closeTab(id), () => closeOthers(id), () => closeAll()];
    const rows = ["Close", "Close Others", "Close All"].map((label, i) => ({ id: String(i), label: T(label), action: actions[i] }));
    if (isIdea()) rows.push({ separator: true }, { id: "pin", label: T(tabsNow().find(tab => tab.id === id)?.pinned ? "Unpin Tab" : "Pin Tab"), action: () => pinTab(id) },
      { id: "reopen", label: T("Reopen Closed Tab"), disabled: !((shared("codenav.closedTabs") ?? {})[editorKey()] ?? []).length, action: () => reopenClosedTab() });
    if (isIdea()) return uiMenu("cn-tabmenu", rows, this.menu, cx, { width: 210, onClose: () => closeOverlay(overlay) });
    const choose = (i) => { closeOverlay(overlay); actions[i]?.(); };
    const item = (key, label, i) => div().id(`cn-tm-${key}`).h(isIdea() ? IDEA.rowHeight : 30).px(12).flex().items_center().rounded(isIdea() ? IDEA.selectionRadius : 5).text_size(isIdea() ? uiSize() : 12.5).cursor_pointer()
      .when(i === this.menu.at, (e) => e.bg(t.selected))
      .hover((e) => e.bg(t.hover))
      .on_click(() => choose(i))
      .child(label);
    return popupSurface(v_flex()).size_full().p(4).gap(2).bg(t.popover).text_color(t.foreground)
      .track_focus(this.menu.focus).on_key_down((event, eventCx) => this.menu.key(event, eventCx, rows, { onClose: () => closeOverlay(overlay) }))
      .child(item("close", T("Close"), 0))
      .child(item("others", T("Close Others"), 1))
      .child(item("all", T("Close All"), 2));
  }
}

export class TabList {
  init(_p, cx) { this.menu = new MenuController(cx, Math.max(0, visibleTabs().findIndex(x => x.id === activeId()))); this.menu.focus.focus(); }
  release() { this.menu.release(); }
  render(cx) {
    const t = theme(), tabs = visibleTabs(), done = (x) => { closeOverlay(props().overlay); if (x) openTab(x); };
    const rows = tabs.map(x => {
      const path = x.type === "file" ? x.spec.path : x.path;
      return { id: x.id, label: basename(x.type === "file" ? x.spec.rel ?? path : path),
        icon: () => x.type === "file" ? fileGraphic(x.spec, IDEA.iconSize) : ideaImage(path, false, IDEA.iconSize),
        shortcut: path, action: () => openTab(x) };
    });
    this.menu.normalize(rows);
    if (isIdea()) return uiMenu("cn-tablist", rows, this.menu, cx, { width: 360, maxHeight: 360, onClose: () => closeOverlay(props().overlay) });
    return popupSurface(v_flex()).size_full().p(4).text_color(t.foreground).track_focus(this.menu.focus)
      .on_key_down((event, eventCx) => this.menu.key(event, eventCx, rows, { onClose: () => closeOverlay(props().overlay) }))
      .child(v_flex().id("cn-tablist").flex_1().min_h(0).overflow_y_scrollbar()
        .children(tabs.map((x, i) => {
          const path = x.type === "file" ? x.spec.path : x.path;
          return h_flex().id(`cn-tablist-${i}`).h(IDEA.rowHeight).px(8).gap(6).items_center().rounded(4).cursor_pointer()
            .bg(i === this.menu.at ? t.selected : "#00000000").hover((e) => e.bg(t.hover)).on_click(() => done(x))
            .child(ideaImage(path, false, 16)).child(div().flex_1().truncate().child(basename(path))).tooltip(path);
        })));
  }
}

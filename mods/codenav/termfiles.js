import { uiIcon } from "./ui-icons.js";
// Files named in a terminal, opened in the code view: the terminal's right-click
// menu ("Open in code view" for the selected path, plus Herdr's own pane items)
// and a picker of the paths in its screen and recent output (Cmd+Shift+O).
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, terminals, panes, exec, hc, keys, shared } from "herdr";
import { uiNotify as notify } from "./idea-design.js";
import { T } from "./i18n.js";
import { IDEA, isIdea, uiSize, popupSurface, MenuController, uiMenu, uiInputBox, uiListRow } from "./idea-design.js";
import { openPath, tilde, basename, uiFontFamily } from "./common.js";
import { ideaImage, toolImage } from "./ideaicons.js";
import { actionShortcut } from "./actions.js";

import { parsePath, pathsIn, placeOf, resolve } from "./terminal-paths.js";

const openAt = (f, on) => openPath(`${f.abs}${f.line ? `:${f.line}${f.col ? `:${f.col}` : ""}` : ""}`, on);

export function showTerminalFiles(terminal) {
  if (!terminal) return;
  openOverlay({ mod: "codenav", props: { view: "termfiles", terminal }, kind: "dialog", width: 820, height: 520 });
}

// Copies the terminal's selection and opens the path in it.
async function openSelection(target, sleep) {
  run("pane.focus", { pane: target.pane });
  const before = await exec("pbpaste").catch(() => null);
  run("terminal.copy");
  await sleep(120);
  const after = await exec("pbpaste").catch(() => null);
  const text = (after?.stdout ?? "").trim();
  const place = await placeOf(target.terminal);
  const found = text && text.length < 2000 ? await resolve(pathsIn(text).slice(0, 5).concat(parsePath(text) ? [parsePath(text)] : []), place) : [];
  if (!found.length) {
    notify({ title: T("Select a file path first"), body: before?.stdout === after?.stdout ? T("Nothing new was selected in the terminal") : text.slice(0, 80), level: "warning", timeout: 3000 });
    return;
  }
  openAt(found[0], place.on);
}

// -- the terminal's right-click menu ----------------------------------------------
export class TermMenu {
  init(_p, cx) {
    this.menu = new MenuController(cx);
    this.menu.focus.focus();
  }

  // An item is [label, icon, action(sleep), key hint]; null draws a separator.
  items() {
    const tg = props()?.target ?? {};
    const all = terminals();
    const term = all.find((t) => t.address === tg.terminal);
    const parent = term?.parent && all.find((t) => t.address === term.parent);
    const toProgram = term?.labels?.["herdr.right-click"] === "program";
    return [
      [T("Open selected path in code view"), "file-text", (sleep) => openSelection(tg, sleep)],
      [T("Files in this terminal…"), "search", () => showTerminalFiles(tg.terminal), actionShortcut("terminal-files", keys(), { layout: shared("layout"), terminal: true })],
      null,
      [T("Split right"), "split-right", () => run("pane.split", { direction: "right", pane: tg.pane })],
      [T("Split down"), "split-down", () => run("pane.split", { direction: "down", pane: tg.pane })],
      [T("Zoom"), "maximize", () => run("pane.zoom", { pane: tg.pane })],
      ...(term ? [toProgram
        ? [T("Use Herdr right-click menu"), "terminal", () => run("terminal.right_click", { terminal: term.address, to: "menu" })]
        : [T("Send right-clicks to pane"), "terminal", () => run("terminal.right_click", { terminal: term.address, to: "program" })]] : []),
      ...(parent ? [[`${T("Send back to")} ${parent.name || parent.address}`, "terminal", () => run("terminal.park", { terminal: term.address })]] : []),
      null,
      [T("Close pane"), "x", () => run("pane.close", { pane: tg.pane })],
    ];
  }

  // The popup closes once the item is done: closing it first would cancel
  // work that waits (copying the selection).
  choose(it, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try { await it[2]((ms) => cx.sleep(ms)); }
      finally { closeOverlay(props()?.overlay); }
    });
  }

  release() { this.menu.release(); }
  render(cx) {
    const rows = this.items().map((it, i) => !it ? { separator: true } : { id: `cn-tm-${i}`, label: it[0],
      icon: () => uiIcon(it[1], 14), shortcut: it[3], disabled: Boolean(this.busy), action: (_event, eventCx) => this.choose(it, eventCx) });
    return uiMenu("cn-termmenu", rows, this.menu, cx, { width: 320, maxHeight: 400, closeOnActivate: false, onClose: () => closeOverlay(props()?.overlay) });
  }
}

// -- the picker of files named in a terminal ----------------------------------------
export class TermFiles {
  init(_p, cx) {
    this.focus = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.files = null; this.at = 0;
    this.filter = InputState.new({ placeholder: T("Filter files") });
    this.filter.on("change", (_e, cx) => { this.at = 0; this.scroll.scroll_to_item(0, "center"); cx.notify(); });
    this.filter.on("submit", (_e, cx) => { const f = this.shown()[this.at]; if (f) this.open(f); });
    this.filter.focus();
    const terminal = props()?.terminal;
    cx.spawn(async (cx) => {
      try {
        const place = await placeOf(terminal);
        this.place = place;
        const r = await hc(["read", terminal, "--lines", "800"]);
        const files = await resolve(pathsIn(r.stdout ?? "").slice(0, 400), place);
        if (this.released) return;
        this.files = files;
      } catch (e) { this.error = String(e.message ?? e); this.files = []; }
      if (this.released) return;
      cx.notify();
    });
  }
  release() { this.released = true; this.scroll.release(); }

  shown() {
    const q = this.filter.value().toLowerCase();
    return (this.files ?? []).filter((f) => !q || f.abs.toLowerCase().includes(q)).slice(0, 200);
  }

  open(f) {
    closeOverlay(props()?.overlay);
    openAt(f, this.place?.on ?? null);
  }

  // Like IntelliJ's Go to File popup: a title row, a framed query, file icons,
  // the folder dimmed and the project on the right, the selected path below.
  render(cx) {
    const t = theme(), list = this.shown(), repo = this.place?.repo;
    const where = (abs) => repo && abs.startsWith(repo + "/") ? abs.slice(repo.length + 1).replace(/\/?[^/]*$/, "") : tilde(abs).replace(/\/[^/]*$/, "");
    const sel = list[this.at];
    const fileKey = f => JSON.stringify([f.abs, f.line ?? null, f.col ?? null]);
    return v_flex().id("cn-termfiles").size_full().bg(t.popover).text_color(t.foreground).text_size(uiSize(13)).font_family(uiFontFamily())
      .when(isIdea(), (e) => popupSurface(e).p(4))
      .track_focus(this.focus)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = Math.max(0, Math.min(this.at + 1, list.length - 1));
        else if (e.key === "up") this.at = Math.max(this.at - 1, 0);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        this.scroll.scroll_to_item(this.at, "center");
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(40).flex_none().px(14).gap(10).items_center()
        .child(toolImage("terminal", 16))
        .child(div().flex_none().font_semibold().child(T("Files in this terminal")))
        .child(div().flex_1().min_w(0).truncate().text_size(uiSize(12)).text_color(t.dim).child(this.place?.cwd ? tilde(this.place.cwd) : ""))
        .child(div().flex_none().text_size(uiSize(12)).text_color(t.dim).child(this.files ? T("{n} files", { n: list.length }) : "")))
      .child(uiInputBox(h_flex().w_full().min_w(0).gap(8).items_center()
        .child(toolImage("search", 15))
        .child(div().flex_1().min_w(0).child(Input.new(this.filter)))
        .child(div().flex_none().text_size(uiSize(11.5)).text_color(t.dim).child(T("Newest first"))), { focused: true }).mx(10).flex_none())
      .child(v_flex().flex_1().min_h(0).mt(6).relative()
        .when(this.files === null, (e) => e.child(div().px(16).py(10).text_color(t.dim).child(T("Loading…"))))
        .when(this.files !== null && !list.length, (e) => e.child(div().px(16).py(10).text_color(t.dim).child(this.error ?? T("No file paths in this terminal's output"))))
        .when(Boolean(list.length), el => el.child(v_virtual_list("cn-tf-list", list.length, Math.max(IDEA.rowHeight, uiSize() + 8), i => fileKey(list[i]), range => list.slice(range.start, range.end).map((f, n) => {
          const i = range.start + n;
          return uiListRow(`cn-tf-${i}`, [], { selected: i === this.at, interactive: true }).mx(4)
          .child(ideaImage(f.abs, false, 16))
          .child(div().flex_none().max_w(320).truncate().text_size(uiSize(13.5)).child(basename(f.abs)))
          .when(Boolean(f.line), (e) => e.child(div().flex_none().text_size(uiSize(12.5)).text_color(t.accent).child(`:${f.line}`)))
          .child(div().flex_1().min_w(0).truncate().text_size(uiSize(12.5)).text_color(t.dim).child(where(f.abs)))
          .when(Boolean(repo) && f.abs.startsWith((repo ?? "") + "/"), (e) => e
            .child(div().flex_none().max_w(200).truncate().text_size(uiSize(12.5)).text_color(t.dim).child(basename(repo)))
            .child(ideaImage(repo, true, 14)));
        })).size_full().track_scroll(this.scroll).on_item_click((key) => {
          const index = list.findIndex(f => fileKey(f) === key); if (index < 0) return;
          this.at = index; this.open(list[index]);
        })).child(Scrollbar.vertical("cn-tf-list").absolute().inset_0())))
      .child(h_flex().h(30).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border).text_size(uiSize(12))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(sel ? tilde(sel.abs) + (sel.line ? `:${sel.line}` : "") : ""))
        .child(div().flex_none().text_color(t.accent).child(T("Enter to open"))));
  }
}

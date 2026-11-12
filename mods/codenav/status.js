// A status-bar item: language servers the engine is running, and the language.
// Always on screen, so it also takes the mod's commands: `review`, `lang[:ko|en]`,
// `terminal-files` (the focused terminal's paths), `close-tab` (Cmd+W),
// `tab-back` / `tab-forward` (Ctrl+- / Ctrl+Shift+-), the idea layout's
// `tool-<name>`, `move-<name>:<left|right|bottom>`, `tool-settings`, `tool-reset`, `hide-tools`, `hide-active`, `run-configs`, `find-<all|class|file|symbol|action|recent>[:query]`,
// `nav-back` / `nav-forward`, and
// `open:<absolute path>[:line]` (herdr-app do codenav.open:/repo/src/a.go:42).
import { div } from "gpui-kit";
import { T, lang, setLang } from "./i18n.js";
import { h_flex } from "gpui-base";
import { theme, nextCommand, focused, run, shared, setShared, agents, openOverlay, hc, layout, keys, pickFolder, spaces } from "herdr";
import { uiNotify as notify } from "./idea-design.js";
import { showTerminalFiles } from "./termfiles.js";
import { closeTab, tabBack, tabForward, stepTab, routeEditor, resumeClose } from "./tabs.js";
import { toggleTool, toggleAllTools, hideActiveTool, moveTool, arrange, savedSides, TOOLS } from "./tool-windows.js";
import { openEverywhere } from "./everywhere.js";
import { restartPending, openRunConfigs, runStore, runConfig, stopConfig } from "./run.js";
import { showReview, openPath, openFiles, find, editorSnapshot, editorSpec, wantedChild } from "./common.js";
import { followSpace } from "./memory.js";
import { peek } from "./lsp.js";
import { openLspSetup } from "./lsp-setup.js";
import { handleDiagnosticAttachment } from "./diagnostics.js";
import { openDatabaseDocument } from "./database-editor.js";
import { openDatabaseManager } from "./database.js";
import { isIdea, uiSize, ideaUI } from "./idea-design.js";
import { openIdeaSettings } from "./settings.js";
import { recordLocation } from "./locations.js";
import { rememberProject, PROJECT_RECENT_KEY } from "./project-order.js";
import { actionForTerminalKey, bindingForTerminalKey, actionPresentation, normalizeChord } from "./actions.js";

// Keys bound in keys.json's terminal section (programs in Kitty keyboard mode
// would get them otherwise): what each does in the shown layout.
const TERM_KEYS = {
  codebench: { "cmd-shift-o": "terminal-files" },
};

// Direct commands and terminal key bindings open the same views.
function openCommand(command) {
  if (command === "terminal-files") showTerminalFiles(focused()?.terminal);
  else if (command === "settings") openIdeaSettings();
  else if (command === "lsp-setup") openLspSetup();
  else if (command?.startsWith("find-")) {
    const [kind, ...query] = command.slice(5).split(":");
    openEverywhere({ all: "all", class: "classes", file: "files", symbol: "symbols", action: "actions", recent: "recent", locations: "locations" }[kind] ?? "all", query.join(":"));
  } else return false;
  return true;
}

async function termKey(key) {
  key = normalizeChord(key);
  const review = shared("codenav.review.current"), area = shared("codenav.area"), shownLayout = shared("layout");
  const reviewActive = shownLayout === "idea" && area === "review" && Boolean(review?.path && review.rkey)
    && find(layout(), "editor-stack")?.active === "editor-review" && wantedChild() === "editor-review";
  const separator = review?.rkey?.indexOf(":") ?? -1;
  const document = reviewActive ? { kind: "file", path: `${review.rkey.slice(separator + 1)}/${review.path}`, on: review.rkey.slice(0, separator) || null } : editorSpec();
  const context = { layout: shownLayout, mod: document?.edit ? "activity" : "codenav",
    document, area, terminal: focused()?.terminal };
  const bindings = keys(), binding = bindingForTerminalKey(key, bindings, context), action = actionForTerminalKey(key, bindings, context);
  const c = action ? action.command.replace(/^codenav\./, "") : TERM_KEYS[shared("layout")]?.[key];
  if (openCommand(c)) return;
  if (c === "app.settings") run("app.settings");
  else if (action) {
    // Source/review/edit commands go to their real shown owner. They are not
    // terminal text, and an unavailable editor action must not type a shortcut.
    const reviewUsages = action.id === "codenav.usages" && reviewActive && separator === 0;
    const presentation = actionPresentation(action, context);
    if (reviewUsages || !["code", "review", "activity"].includes(action.owner) || presentation.enabled) run(presentation.command);
  }
  else if (binding && binding.action !== "terminal" && !binding.action.startsWith("send:")) run(binding.action);
  // Forward keys that only idea claims, preserving terminal input in the other
  // layouts. hc encodes named keys for the program's negotiated keyboard mode.
  else if (key === "shift shift") return; // Modifier taps have no terminal text to replay in other layouts.
  else if (key === "cmd-,") run("app.settings");
  else if (key === "cmd-shift-,") return;
  else if (focused()?.terminal) {
    try {
      const r = await hc(binding?.action.startsWith("send:")
        ? ["send", focused().terminal, binding.action.slice(5)]
        : ["keys", focused().terminal, ...key.split(" ").map(stroke => stroke === "-" ? "-"
          : stroke.endsWith("--") ? `${stroke.slice(0, -1).replace(/-/g, "+")}-` : stroke.replace(/-/g, "+"))]);
      if (r.code) notify({ title: T("Could not send key"), body: r.stderr || key, level: "error" });
    } catch (e) { notify({ title: T("Could not send key"), body: String(e), level: "error" }); }
  }
}

// Herdr's agent notifications, kept for the Notifications tool window: an agent
// that finished while you weren't looking ("done") or waits for you ("blocked").
function recordAgents(self, cx) {
  const now = {};
  const add = [];
  for (const a of agents()) {
    now[a.address] = a.status;
    const was = self.agentStatus?.[a.address];
    if (self.agentStatus && was !== a.status && (a.status === "done" || a.status === "blocked")) {
      const name = a.program?.name ?? a.app ?? a.title;
      add.push({ at: Date.now(), level: a.status, terminal: a.address, space: a.space,
        title: a.status === "blocked" ? T("{name} needs you", { name }) : T("{name} finished", { name }), where: `${a.space_name} / ${a.tab_name}` });
    }
  }
  self.agentStatus = now;
  if (add.length) cx.timer.after(0, () => add.forEach(note => notify({ ...note, group: "herdr.agents" })));
}

function recordProjectUse(self, cx) {
  const id = spaces().find(space => space.active)?.id ?? null;
  if (id === self.projectSpace) return;
  self.projectSpace = id;
  if (!id) return;
  cx.timer.after(0, () => {
    setShared(PROJECT_RECENT_KEY, rememberProject(spaces(), shared(PROJECT_RECENT_KEY), id));
  });
}

export default class Status {
  init(_p, cx) {
    this.servers = [];
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (openCommand(c)) { cx.notify(); continue; }
        if (c === "review") showReview();
        else if (c.startsWith("notify:")) { try { notify(JSON.parse(c.slice(7))); } catch {} }
        else if (c.startsWith("attach-diagnostics:")) {
          try { handleDiagnosticAttachment(JSON.parse(c.slice(19)), cx); }
          catch (error) { notify({ title: T("Could not attach diagnostics"), body: String(error.message ?? error), level: "error" }); }
        }
        else if (c.startsWith("open:")) openPath(c.slice(5));
        else if (c.startsWith("database-open:")) { try { await openDatabaseDocument(JSON.parse(c.slice(14))); } catch (error) { notify({ title: T("Database operation failed"), body: String(error), level: "error" }); } }
        else if (c === "database-settings") openDatabaseManager();
        else if (c === "open-folder") this.openFolder(cx);
        else if (c.startsWith("open-files:")) { try { const data = JSON.parse(c.slice(11)); openFiles(data.paths ?? [], data.on ?? null); } catch (error) { notify({ title: T("Could not open files"), body: String(error), level: "error" }); } }
        else if (c === "close-tab") closeTab();
        else if (c.startsWith("close-approved:")) { try { resumeClose(JSON.parse(c.slice(15))); } catch {} }
        else if (c === "tab-back") tabBack();
        else if (c === "tab-forward") tabForward();
        // IntelliJ's navigation uses locations, including while a terminal has focus.
        else if (c === "nav-back" || c === "nav-forward") {
          const forward = c === "nav-forward";
          if (isIdea() && find(layout(), "editor-stack")?.active === "editor-code") run(forward ? "codenav.editor-forward" : "codenav.editor-back");
          else if (!isIdea() && focused()?.terminal) run(forward ? "agent.next" : "agent.prev");
          else forward ? tabForward() : tabBack();
        }
        else if (c.startsWith("tool-") && TOOLS[c.slice(5)]) toggleTool(c.slice(5));
        else if (c === "hide-tools") toggleAllTools();
        else if (c === "hide-active") hideActiveTool();
        else if (c === "tool-last") { const last = shared("codenav.lastTool"); if (last) toggleTool(last, true); }
        else if (c === "tab-next" || c === "tab-prev") focused()?.terminal ? run(c === "tab-next" ? "tab.next" : "tab.prev") : stepTab(c === "tab-next" ? 1 : -1);
        else if (c === "run" || c === "rerun") { const st = runStore(); runConfig(st.configs[st.selected] ?? st.configs[0], () => toggleTool(isIdea() ? "run-results" : "terminal", true)); }
        else if (c === "stop") { const st = runStore(); stopConfig(st.configs[st.selected] ?? st.configs[0]); }
        else if (c === "run-choose") openOverlay({ mod: "codenav", props: { view: "runmenu" }, kind: "popup", width: 320, height: 240 });
        else if (c === "run-configs") openRunConfigs();
        else if (c === "design-system") openOverlay({ mod: "codenav", props: { view: "designpreview" }, kind: "dialog", frame: "none", width: 820, height: 680 });
        else if (c.startsWith("settings:")) openIdeaSettings(c.slice(9));
        else if (c === "new-terminal-menu") openOverlay({ mod: "codenav", props: { view: "newterminal" }, kind: "popup", frame: "none", width: 300, height: 400 });
        else if (c === "show-terminal") toggleTool("terminal", true);
        else if (c === "run-restart") restartPending(() => toggleTool(isIdea() ? "run-results" : "terminal", true));
        else if (c.startsWith("key:")) await termKey(c.slice(4));
        else if (c.startsWith("move-")) { const [name, side] = c.slice(5).split(":"); if (TOOLS[name]) moveTool(name, side); }
        else if (c === "tool-settings") openIdeaSettings("windows");
        else if (c === "tool-reset") arrange(savedSides());
        else if (["problems-errors-only", "problems-autoscroll", "problems-group-source"].includes(c)) {
          const option = { "problems-errors-only": "errorsOnly", "problems-autoscroll": "autoscroll", "problems-group-source": "groupSource" }[c];
          const options = shared("codenav.problemsOptions") ?? {};
          setShared("codenav.problemsOptions", { ...options, [option]: !options[option] });
        }
        else if (c === "notifications-clear") { setShared("codenav.notifications", []); setShared("codenav.noticeQueue", []); }
        else if (c === "lang") setLang(lang() === "ko" ? "en" : "ko");
        else if (c.startsWith("lang:")) setLang(c.slice(5));
        cx.notify();
      }
    });
    const poll = async (cx) => {
      // Only asks an engine that is already running; never starts one.
      const next = await peek("status");
      if (JSON.stringify(next) !== JSON.stringify(this.servers)) { this.servers = next; cx.notify(); }
    };
    cx.timer.after(500, (cx) => poll(cx));
    cx.timer.every(4000, (cx) => poll(cx));
  }

  openFolder(cx) {
    if (this.openingFolder) return;
    this.openingFolder = true;
    cx.spawn(async () => {
      try {
        const folder = await pickFolder({ prompt: T("Open Folder…") });
        // A native folder picker always returns a path on this machine.
        if (folder) run("space.new", { folder, machine: "" });
      } catch (error) {
        notify({ group: "codenav.files", title: T("Could not open folder"), body: String(error), level: "error" });
      } finally { this.openingFolder = false; }
    });
  }

  render(cx) {
    const queue = shared("codenav.noticeQueue") ?? [];
    if (queue.length && !(Date.now() - (Number(this.showingNotices) || 0) < 1000)) {
      const viewport = globalThis.window.viewport_size();
      this.showingNotices = Date.now();
      cx.timer.after(0, () => {
        this.showingNotices = false;
        const ids = new Set(queue.map(note => note.id));
        setShared("codenav.noticeQueue", (shared("codenav.noticeQueue") ?? []).filter(note => !ids.has(note.id)));
        queue.slice(-3).forEach((note, i) => openOverlay({ mod: "codenav", props: { view: "notice", note }, kind: "window", frame: "none", width: 340, height: 110,
          key: `idea-notice-${i}`, at: { x: Math.max(0, viewport.width - 388), y: Math.max(0, viewport.height - 150 - i * 118) } }));
      });
    }
    recordAgents(this, cx);
    recordProjectUse(this, cx);
    followSpace(this, cx);
    routeEditor(this, cx);
    if (isIdea()) recordLocation(this, cx);
    const t = theme();
    const caret = isIdea() ? editorSnapshot("codenav.caret") : null;
    const servers = this.servers ?? [];
    const busy = servers.some((s) => s.busy?.length || s.state === "starting");
    const tip = this.servers === null ? T("LSP bridge not running (starts when a source file opens)")
      : servers.length ? servers.map((s) => `${s.command} · ${s.state}${s.busy?.length ? ` (${s.busy.join(", ")})` : ""} · ${s.root}`).join("\n") : T("No language server running");
    return ideaUI(h_flex()).id("codenav-status").size_full().pl(8).pr(14).gap(10).items_center().justify_end().bg(isIdea() ? t.canvas : t.chrome).when(!isIdea(), (e) => e.border_t(1).border_color(t.border)).text_size(uiSize(12)).text_color(t.muted)
      .when(Boolean(caret), el => el.child(h_flex().id("cn-st-position").flex_none().gap(5).items_center()
        .child(`${caret.line + 1}:${caret.col + 1}`).child("LF").child("UTF-8")))
      .child(h_flex().id("cn-st-lsp").min_w(0).gap(5).items_center().cursor_pointer().tooltip(`${tip}\n${T("Language Server Setup")}`)
        .on_click(() => openLspSetup())
        .child(div().size(7).rounded_full().bg(this.servers === null ? t.dim : busy ? t.ansi3 : servers.length ? t.ansi2 : t.dim))
        .child(div().min_w(0).truncate().child(servers.length ? servers.map((s) => s.command).filter((v, i, a) => a.indexOf(v) === i).join(" · ") : "LSP")))
      .child(div().id("cn-st-lang").flex_none().px(6).h(20).flex().items_center().rounded(4).cursor_pointer().hover((e) => e.bg(t.hover).text_color(t.foreground))
        .tooltip(T("Language: English (click for 한국어)"))
        .on_click(() => setLang(lang() === "ko" ? "en" : "ko"))
        .child(lang() === "ko" ? "한국어" : "EN"));
  }
}

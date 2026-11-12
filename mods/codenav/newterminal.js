import { uiIcon } from "./ui-icons.js";
// Adapted from Herdr shipped mods/new-menu/main.js; commands and machine lookup preserved.
import { div, svg, image } from "gpui-kit";

import { IDEA, MenuController, uiMenu } from "./idea-design.js";
import { T } from "./i18n.js";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewTerminal {
  init(p, cx) {
    this.p = p; this.loading = true;
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.menu = new MenuController(cx);
    this.menu.focus.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      this.loading = false;
      if (this.released) return;
      cx.notify();
    });
  }
  release() { this.released = true; this.menu.release(); }
  render(cx) {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    const startAgent = (a) => run("tab.new", { name: a.name, space: space?.id, argv: a.run });
    const terminal = { id: "terminal", action: () => run("tab.new", { space: space?.id }) };
    const newSpace = { id: "space", action: () => run("space.new") };
    const worktree = (action) => openOverlay({ mod: "worktree", kind: "dialog", width: action === "new" ? 460 : 560, height: action === "new" ? 280 : 480,
      props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action } });
    const rows = [
      { id: "terminal", icon: () => uiIcon("terminal", 16), label: T("Terminal"), shortcut: shortcut("tab.new"), action: terminal.action },
      { separator: true }, { id: "agent-caption", label: T("Start an agent"), disabled: true },
      ...choices.map((a, i) => ({ id: `agent-${a.key}`, label: a.name,
        icon: () => a.tint ? svg(a.icon).size(IDEA.iconSize).text_color(t.foreground) : image(a.icon).size(IDEA.iconSize),
        shortcut: a.installed ? (i < 9 ? String(i + 1) : "") : T("not installed"), disabled: !a.installed, action: () => startAgent(a) })),
      ...(this.loading || this.failed || !this.agents.length ? [{ id: "agent-status", label: T(this.failed ? "Could not load agents" : this.loading ? "Checking installed agents…" : "No agents found"), disabled: true }] : []),
      { separator: true },
      { id: "space", label: T("New space"), icon: () => uiIcon("newSpace", 16), shortcut: shortcut("space.new"), action: newSpace.action },
      { id: "worktree", label: T("New worktree…"), icon: () => uiIcon("branch", 16), disabled: !space, action: () => worktree("new") },
      { id: "worktree-open", label: T("Open worktree…"), icon: () => uiIcon("branch", 16), disabled: !space, action: () => worktree("open") },
    ];
    return uiMenu("new-menu", rows, this.menu, cx, { width: 300, maxHeight: 400, onClose: () => closeOverlay((props() ?? this.p)?.overlay) });
  }
}

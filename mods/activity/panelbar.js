import { uiIcon } from "./ui-icons.js";
// The header of the workbench's terminal panel, like VS Code's: the space's
// tabs as terminal tabs, then new / split / maximize / hide.
import { div, svg, image } from "gpui-kit";
import { T } from "./i18n.js";
import { h_flex } from "gpui-base";
import { run, theme, spaces, panes, layout, openOverlay } from "herdr";
import { find, AREA, iconButton, icon } from "./common.js";

export default class PanelBar {
  init() {}

  tabName(c) {
    const program = panes().find((p) => p.tab === c.id && p.program?.agent)?.program ?? panes().find((p) => p.tab === c.id)?.program;
    return { name: /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name, program };
  }

  item(c, t) {
    const { name, program } = this.tabName(c);
    return h_flex().id(`ptab-${c.id}`).h_full().px(10).gap(6).flex_none().items_center().text_size(12).cursor_pointer()
      .border_b(2).border_color(c.active ? t.accent : "#00000000").text_color(c.active ? t.foreground : t.muted)
      .hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); if (e.click_count === 2) run("tab.rename", { id: c.id }); })
      .on_click(() => run("tab.select", { id: c.id }))
      .child(program?.icon ? (program.tint ? svg(program.icon).size(13).text_color(t.muted) : image(program.icon).size(13)) : icon("terminal", 13))
      .child(div().max_w(160).truncate().child(c.zoomed ? `${name} (zoomed)` : name))
      .when(c.status === "working", (el) => el.child(uiIcon("spinner", 11).flex_none().text_color(t.working).spin(900)))
      .when(c.status === "blocked" || c.status === "done", (el) => el.child(div().size(6).rounded(3).bg(t[c.status])))
      .when(c.active, (el) => el.child(iconButton(`pclose-${c.id}`, "x", "Close tab", () => run("tab.close", { id: c.id }), { size: 16, icon: 11 })));
  }

  render() {
    const t = theme(), root = layout();
    const tabs = spaces().find((s) => s.active)?.tabs ?? [];
    const area = find(root, AREA), maximized = !area || area.hidden;
    return h_flex().size_full().min_w(0).pl(12).pr(6).gap(2).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(div().flex_none().pr(8).text_size(11).font_semibold().text_color(t.muted).child(T("TERMINAL")))
      .child(h_flex().id("ptabs").flex_1().min_w(0).h_full().items_center().overflow_x_scrollbar().children(tabs.map((c) => this.item(c, t))))
      .child(iconButton("p-new", "plus", T("New Terminal or Agent"), () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .child(iconButton("p-split", "split", T("Split Terminal"), () => run("pane.split", { direction: "right" })))
      .child(iconButton("p-max", maximized ? "chevron-down" : "chevron-up", maximized ? "Restore Editor Area" : "Maximize Panel",
        () => run(maximized ? "layout.show" : "layout.hide", { id: AREA })))
      .child(iconButton("p-hide", "x", T("Hide Panel (Ctrl+`)"), () => run("layout.hide", { id: "terminal-panel" })));
  }
}

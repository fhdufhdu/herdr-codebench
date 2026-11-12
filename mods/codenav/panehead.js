import { uiIcon } from "./ui-icons.js";
// A terminal pane's header (the layout's pane "header", revealed on hover):
// the program, its folder and status, and split / zoom / close for this pane.
// Herdr shows the header only while the pointer is on the pane, so the buttons
// are always drawn, and they act on press: nothing has to notice the hover first.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme } from "herdr";
import { T } from "./i18n.js";
import { tilde } from "./common.js";

export default class PaneHead {
  init() {}

  button(t, id, iconName, tip, command, args) {
    return div().id(id).p(3).rounded(4).flex_none().text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(uiIcon(iconName, 16));
  }

  render() {
    const t = theme(), pane = props()?.pane;
    const p = panes().find((x) => x.pane === pane);
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = !p.program?.icon ? null : p.program.tint ? svg(p.program.icon).size(14).flex_none().text_color(t.dim) : image(p.program.icon).w(14).h(14).flex_none();
    const st = p.status;
    return h_flex().id(`cn-ph-${pane}`).size_full().px(10).gap(8).items_center().bg(t.background).border_b(1).border_color(t.border).text_size(12)
      .on_mouse_down("left", () => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tilde(p.cwd ?? "")))
      .when(st === "working", (el) => el.child(uiIcon("spinner", 12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child(T("Needs you"))))
      .when(st === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .child(this.button(t, `cn-ph-r-${pane}`, "split-right", T("Split right"), "pane.split", { direction: "right", pane }))
      .child(this.button(t, `cn-ph-d-${pane}`, "split-down", T("Split down"), "pane.split", { direction: "down", pane }))
      .child(this.button(t, `cn-ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", T("Zoom"), "pane.zoom", { pane }))
      .child(this.button(t, `cn-ph-x-${pane}`, "close", T("Close pane"), "pane.close", { pane }));
  }
}

import { uiIcon } from "./ui-icons.js";
// The spaces column's foot: Settings and Add machine, like the shipped
// workspace-chrome footer, but centered when the column is folded to a rail.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, theme, layout, updates } from "herdr";
import { T } from "./i18n.js";
import { find } from "./common.js";

export default class Footer {
  init() {}
  render() {
    const t = theme(), rail = (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
    const row = (id, icon, label, dim, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8).cursor_pointer()
      .when(rail, (el) => el.justify_center().px(0)).tooltip(label)
      .text_color(dim ? t.dim : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(action).child(uiIcon(icon, 14))
      .when(!rail, (el) => el.child(label));
    return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
      .child(row("settings", "settings", T("Settings"), false, () => run("app.settings"))
        .when(Boolean(updates().app.ready), (el) => el.child(div().size(6).rounded_full().bg(t.accent))))
      .child(row("machine", "plus", T("Add machine"), true, () => run("mod.open", { name: "machine-add" })));
  }
}

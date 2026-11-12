// IntelliJ's HTTP Client for .http files in the code view: a green ▶ beside each
// request, and above the file "Run All" and "Run with: <environment ▾>". Requests
// run with the ijhttp CLI in their own terminal tab ("▶ HTTP"), from a hidden
// copy beside the .http file (its scripts' relative paths keep working) that
// carries client.global over from earlier runs; the copy is removed after.
// Environments come from http-client.env.json and http-client.private.env.json,
// looked for from the file's folder up to the repository; the chosen one is kept per folder in shared "codenav.httpEnv".
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared, setShared, props, closeOverlay, openOverlay, run } from "herdr";
import { T } from "./i18n.js";
import { IDEA, isIdea, uiSize, ideaUI, MenuController, uiMenu, uiNotify, uiIconButton } from "./idea-design.js";
import { basename } from "./common.js";
import { toolImage } from "./ideaicons.js";
import { runConfig } from "./run.js";
import { ACTION_GROUPS, getAction, actionPresentation } from "./actions.js";
import { groupItems } from "./toolbar-model.js";

import { isHttp, httpRequests, httpEnvs, chosenEnv, runHttp as executeHttp } from "./http-client.js";
export { isHttp, httpRequests, httpEnvs, chosenEnv };
const store = () => shared("codenav.httpEnv") ?? {};
const dirOf = path => path.replace(/\/[^/]*$/, "");
export const runHttp = (path, lines, envs, req, after) => executeHttp(path, lines, envs, req, after, { launch: runConfig, notify: value => uiNotify({ ...value, title: T(value.title), ...(value.body ? { body: T(value.body) } : {}) }) });

// Above the file: Run All, and the environment.
export function httpBar(t, view, cx) {
  const h = view.http;
  if (!h) return null;
  const env = chosenEnv(view.shown.path, h.envs);
  const btn = (id, children, tip, action) => h_flex().id(id).h(26).px(7).gap(6).flex_none().items_center().rounded(5).cursor_pointer()
    .hover((s) => s.bg(t.hover)).tooltip(tip).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(() => action()).children(children);
  const defaultActions = [
    btn("http-all", [toolImage("runAll", 16)], T("Run All Requests in File"), () => runHttp(view.shown.path, view.lines, h.envs, null, () => view.showTerminal())),
    div().w(1).h(16).mx(4).bg(t.input),
  ];
  const toolbarItems = isIdea() ? groupItems("HTTP.toolbar", shared("codenav.customization") ?? {}, ACTION_GROUPS).map(item => {
    if (item.kind === "separator") return div().w(1).h(16).mx(4).bg(t.input);
    const action = getAction(item.action);
    if (!action) return div();
    const presentation = actionPresentation(action, { layout: "idea", document: view.shown, hasWorkspace: true });
    return uiIconButton(`http-custom-${item.id}`, toolImage(item.icon ?? action.icon, 16), () => run(action.command),
      { tip: T(action.label), disabled: !presentation.enabled, active: presentation.selected });
  }) : defaultActions;
  return h_flex().h(isIdea() ? IDEA.toolHeaderHeight : 34).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border).bg(isIdea() ? t.surface : t.chrome).text_size(uiSize(12.5))
    .when(isIdea(), (e) => ideaUI(e))
    .children(toolbarItems)
    .child(div().text_color(t.muted).child(T("Run with:")))
    .child(btn("http-env", [div().text_color(t.foreground).child(env ?? T("No environment")), toolImage("chevronDown", 14)], T("Environment"),
      () => openOverlay({ mod: "codenav", props: { view: "httpenv", dir: dirOf(view.shown.path), names: h.envs.names }, kind: "popup", width: 220, height: Math.min(300, 50 + h.envs.names.length * 30) })))
    .child(div().flex_1())
    .child(div().text_size(uiSize(11.5)).text_color(t.dim).child(h.envs.pub ? basename(h.envs.pub) + (h.envs.priv ? ` + ${basename(h.envs.priv)}` : "") : T("No http-client.env.json")));
}

// The environment picker.
export class HttpEnvMenu {
  init(_p, cx) {
    const { dir, names = [] } = props() ?? {};
    this.menu = new MenuController(cx, Math.max(0, names.indexOf(store()[dir] ?? names[0])));
    this.menu.focus.focus();
  }
  release() { this.menu.release(); }
  render(cx) {
    const { dir, names = [], overlay } = props() ?? {}, cur = store()[dir] ?? names[0];
    const rows = names.map((n, i) => ({ id: `he-${i}`, label: n, icon: () => n === cur ? toolImage("show", 12) : div().w(12),
      action: () => setShared("codenav.httpEnv", { ...store(), [dir]: n }) }));
    if (!rows.length) rows.push({ id: "he-empty", label: T("No http-client.env.json"), disabled: true });
    return uiMenu("http-env-menu", rows, this.menu, cx, { width: 220, maxHeight: 300, onClose: () => closeOverlay(overlay) });
  }
}

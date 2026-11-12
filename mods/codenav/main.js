// Code navigation and branch review for Herdr. One mod, several views, chosen
// by the block's props: { view: "code" | "review" | "tabs" | "status" | ... }.
//   code      — source view with language-server help (shared Go engine client)
//   review    — diff against a base branch, line comments, sent to a terminal
//   tabs      — the editor area's strip; keeps its stack on the right child
//   status    — status-bar item: running language servers, language
//   tabmenu   — a tab's right-click popup: Close / Close Others / Close All
//   termfiles — the paths named in a terminal, to open in the code view
//   termmenu  — the terminal right-click menu (the layout's "terminal_menu"),
//               opened by Herdr with props { tab: "pane", target }
//   panehead  — a terminal pane's header: split / zoom / close
//   the idea layout (tools.js, everywhere.js): stripe, toolmenu, settings, toolempty, toolheader, toolbar,
//   structure, problems, crumbs, projects, everywhere
import { View, div } from "gpui-kit";
import { props as herdrProps, shared, setShared, closeOverlay } from "herdr";
import CodeView, { EditorContextMenu } from "./code.js";
import EditableCode from "./editable-code.js";
import { DiagnosticTargets } from "./diagnostics.js";
import { Database, DatabaseManager } from "./database.js";
import { DatabaseEditor, DatabaseQueryMenu, DatabaseTransfer, RunResults } from "./database-editor.js";
import Review from "./review.js";
import Tabs, { TabMenu, TabList } from "./tabs.js";
import Status from "./status.js";
import { TermMenu, TermFiles } from "./termfiles.js";
import PaneHead from "./panehead.js";
import { Stripe, ToolMenu, ToolEmpty, ToolHeader, IslandBottom, Notifications, Toolbar, Structure, Problems, Crumbs, Projects } from "./tools.js";
import { Everywhere } from "./everywhere.js";
import { RunMenu, RunConfigs } from "./run.js";
import { HttpEnvMenu } from "./http.js";
import IdeaSettings from "./settings.js";
import Agents from "./agents.js";
import NewTerminal from "./newterminal.js";
import RecentFiles from "./recent.js";
import DesignPreview from "./design-preview.js";
import Notice from "./notice.js";
import LspSetup from "./lsp-setup.js";
import { isIdea } from "./idea-design.js";

const VIEWS = { code: CodeView, "custom-editor": EditableCode, review: Review, tabs: Tabs, status: Status, tabmenu: TabMenu, termfiles: TermFiles, termmenu: TermMenu, panehead: PaneHead,
  stripe: Stripe, notifications: Notifications, toolmenu: ToolMenu, toolempty: ToolEmpty, toolheader: ToolHeader, islandbottom: IslandBottom, toolbar: Toolbar, structure: Structure, problems: Problems, crumbs: Crumbs,
  projects: Projects, everywhere: Everywhere, runmenu: RunMenu, runconfigs: RunConfigs, httpenv: HttpEnvMenu,
  "lsp-setup": LspSetup, "diagnostic-targets": DiagnosticTargets, database: Database, "database-manager": DatabaseManager,
  "run-results": RunResults, "database-editor": DatabaseEditor, "database-query": DatabaseQueryMenu, "database-transfer": DatabaseTransfer,
  settings: IdeaSettings, agents: Agents, newterminal: NewTerminal, tablist: TabList,
  recent: RecentFiles, designpreview: DesignPreview, notice: Notice, editorcontext: EditorContextMenu };

export default class CodeNav extends View {
  init(initProps, cx) {
    const ghost = shared("codenav.dragGhost");
    if (ghost) { closeOverlay(ghost); setShared("codenav.dragGhost", null); }
    if (shared("codenav.drag")) setShared("codenav.drag", null);
    if (shared("codenav.shortcutTrace")) setShared("codenav.shortcutTrace", null);
    const p = { ...(initProps ?? {}), ...(herdrProps() ?? {}) };
    this.view = p.view ?? (p.tab === "pane" && p.target ? "termmenu" : "review");
    const Impl = this.view === "code" && isIdea() ? EditableCode : VIEWS[this.view] ?? null;
    this.impl = Impl ? new Impl() : null;
    this.impl?.init(p, cx);
  }
  render(cx) {
    return this.impl ? this.impl.render(cx) : div().p(12).child(`codenav: unknown view "${this.view}"`);
  }
  async close() { await this.impl?.release?.(); }
}

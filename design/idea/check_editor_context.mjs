// node --experimental-vm-modules design/idea/check_editor_context.mjs
// Exercise real view methods at async/context boundaries without a native UI.
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

let slot = "@area:a", current, state = {}, queued = [], jobs = [], opened = [], writes = [];
let response, saveWrite = async () => {}, idea = true, notifications = [], bindings = [], wordResult = null, tabsVisible = false, reviewToolbarOverride = null;
const context = vm.createContext({ console });
const shared = key => structuredClone(state[key]);
const setShared = (key, value) => { state[key] = structuredClone(value); writes.push(key); };
// Record the few render branches under test without relying on a native window.
function element() {
  const data = { attributes: {}, nodes: [] };
  const el = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key === "child") return child => { data.nodes.push(child); return el; };
    if (key === "children") return children => { data.nodes.push(...children); return el; };
    return (...args) => { data.attributes[key] = args; return el; };
  } });
  return el;
}
const values = {
  shared, setShared, editorKey: () => slot, editorSpec: () => current,
  find: (_tree, id) => id === "view-structure" ? {} : id === "editor-tabs" ? { hidden: !tabsVisible } : null, layout: () => ({}),
  lsp: async () => response, T: value => value, isIdea: () => idea,
  IDEA: { editorGutterInset: 8, editorMarkerWidth: 18, editorTextInset: 4, islandRadius: 8, editorBreadcrumbHeight: 22,
    editorChangeMarkerWidth: 4, editorChangeMarkerRadius: 2 },
  offsetAt: (text, col) => Math.min(text.length, col), wordAt: () => wordResult,
  div: element, h_flex: element, v_flex: element, ideaUI: el => el, uiSize: (size = 13) => size,
  uiColors: () => ({ editor: "#editor", canvas: "#canvas", guide: "#guide", lineAdded: "#line-added", lineModified: "#line-modified", lineDeleted: "#line-deleted" }), button: element,
  uiDiagnosticColors: severity => ({ effect: severity === 1 ? "#error-wave" : "#warning-wave", stripe: severity === 1 ? "#error-stripe" : severity === 2 ? "#warning-stripe" : null }),
  uiDiagnosticUnderline: (el, options) => el.diagnostic_wave(options),
  uiDiagnosticTooltip: (id, trigger, diagnostics, options) => element().id(id).diagnostics(diagnostics).diagnostic_options(options).child(trigger),
  diagnosticCardOptions: entries => ({ entries, actions: ["copy", "attach"] }),
  iconButton: (id, graphic, tip, action) => element().id(id).graphic(graphic).tip(tip).on_click(action), sectionHeader: element,
  uiIconButton: (id, graphic, action, options = {}) => element().id(id).child(graphic).options(options).on_click(action),
  uiModeSwitch: (id, items, current, onChange) => element().id(id).children(items.map(item => element().id(`${id}-${item.id}`).selected(item.id === current).child(item.label)
    .on_click((event, cx) => { if (item.id !== current) onChange(item.id, event, cx); }))),
  uiCheckbox: (id, label, action, options = {}) => element().id(id).child(label).options(options).on_click(action),
  uiEditorFooter: children => element().id("editor-footer").children(Array.isArray(children) ? children : [children]),
  TextView: { markdown: element }, uiNotify: value => notifications.push(value),
  theme: () => ({}), codeFont: () => ({ family: "Mono", size: 13, row: 20 }), islandBottom: el => el,
  PathBuilder: { fill: element }, keys: () => bindings,
  groupItems: group => group === "Review.toolbar" ? reviewToolbarOverride ?? actions.namespace.ACTION_GROUPS[group].items : [],
  icon: (name, size) => element().graphic(name).size(size), toolImage: (name, size) => element().graphic(name).size(size),
  displayWidth: text => text.length, expandTabs: text => text, colorize: text => [element().child(text)], syntaxColors: () => ({}),
  location: () => ({ cwd: "/repo", on: null, space: "a" }), spaces: () => [{ id: "a", active: true }],
  emptyEditor: () => element().id("empty-editor"),
  Editor: { new: state => element().id("native-editor").editor_state(state) }, h_resizable: element, resizable_panel: element,
  openEverywhere: mode => opened.push(["everywhere", mode]),
  run: (name, args) => opened.push([name, args]), setEditorSpec: (key, spec) => { opened.push([key, spec]); current = spec; state["activity.editor"] = { ...(state["activity.editor"] ?? {}), [key]: spec }; },
  writeTextFile: (...args) => saveWrite(...args), writeRemoteText: (...args) => saveWrite(...args),
};
const cx = { timer: { after(_ms, fn) { queued.push(fn); } }, spawn(fn) { const job = fn(cx); jobs.push(job); }, notify() {} };
context.window = { paint_path: (path, color) => element().paint_path(path, color) };
const modelSource = await readFile(new URL("../../mods/codenav/editor-model.js", import.meta.url), "utf8");
const model = new vm.SourceTextModule(modelSource, { context }); await model.link(() => {}); await model.evaluate();
async function pureModule(path) {
  const mod = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), "utf8"), { context });
  await mod.link(() => {}); await mod.evaluate(); return mod;
}
const actions = await pureModule("../../mods/codenav/actions.js");
const reviewModel = await pureModule("../../mods/codenav/review-model.js");
const surfaceSource = await readFile(new URL("../../mods/codenav/editor-surface.js", import.meta.url), "utf8");
const surface = new vm.SourceTextModule(surfaceSource, { context });
function mockImports(source, id) {
  const all = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)].filter(m => m[2] === id);
  const names = [...new Set(all.flatMap(m => m[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0])))];
  return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, values[name] ?? (() => {})); }, { context });
}
await surface.link(id => mockImports(surfaceSource, id)); await surface.evaluate();
async function viewModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const module = new vm.SourceTextModule(source, { context });
  await module.link(id => {
    if (id === "./editor-model.js") return model;
    if (id === "./actions.js") return actions;
    if (id === "./review-model.js") return reviewModel;
    if (id === "./editor-surface.js") return surface;
    return mockImports(source, id);
  });
  await module.evaluate(); return module.namespace.default;
}
const Code = await viewModule("../../mods/codenav/code.js");
const Review = await viewModule("../../mods/codenav/review.js");
const Tabs = await viewModule("../../mods/codenav/tabs.js");
const Native = await viewModule("../../mods/activity/editor.js");
const spec = (path = "/repo/App.kt", on = null) => ({ kind: "file", path, on, root: "/repo", at: 1 });
function code() {
  const view = new Code(); current = spec(); slot = "@area:a"; state = {}; queued = []; jobs = []; writes = []; opened = [];
  Object.assign(view, { shown: current, documentSpace: slot, seq: 1, symbols: [], diags: [{ line: 1 }],
    sel: { line: 1, col: 2, word: "App" }, info: { installed: true }, scope: () => [] });
  return view;
}
let view = code(); view.publish(cx); slot = "@area:b"; current = spec();
queued.forEach(fn => fn(cx));
assert.equal(writes.length, 0, "a deferred snapshot from another workspace cannot publish into the new workspace");
view = code(); view.publish(cx); queued.splice(0).forEach(fn => fn(cx));
assert.equal(state["codenav.problems"].space, "@area:a");
slot = "@area:b"; current = spec(); view.documentSpace = slot; view.publish(cx); queued.splice(0).forEach(fn => fn(cx));
assert.equal(state["codenav.problems"].space, "@area:b", "same path and same diagnostic array publish again in a new namespace");
assert.equal(Object.keys(state["codenav.problemFiles"]).length, 2);

view=code();response=[{path:'/repo/Bean.kt',line:2,col:6,detail:'bean · @Primary'}];
view.springList('beans',cx);await Promise.all(jobs);
assert.equal(view.refs.title,'Spring Beans');assert.equal(view.refs.items[0].path,'/repo/Bean.kt');
view=code();let springResolve;response=new Promise(done=>springResolve=done);
view.springList('endpoints',cx);current=spec('/repo/Other.kt');springResolve([{path:'/repo/Endpoint.kt',line:1,col:0}]);await Promise.all(jobs);
assert.equal(view.refs.items,null,'late Spring index never replaces results for another document');

view = code(); let resolve; response = new Promise(done => { resolve = done; });
view.references(cx); current = spec("/repo/Other.kt"); resolve([{ path: "/repo/App.kt", line: 1 }]);
await Promise.all(jobs);
assert.equal(view.refs.items, null, "late references do not replace the new document's results");
view = code(); response = new Promise(done => { resolve = done; });
view.definition(cx); slot = "@area:b"; current = spec(); resolve([{ path: "/repo/Base.kt", line: 2 }]);
await Promise.all(jobs); assert.equal(opened.length, 0, "late definition cannot open a file in another workspace");
view = code(); view.shown = spec("/repo/App.kt", "host-a"); current = view.shown;
view.goTo({ spec: spec("/repo/App.kt", "host-b"), line: 5 }, cx);
assert.equal(opened.at(-1)[1].on, "host-b", "same path on two remote hosts is not an in-file navigation");
view = code(); view.lines = ["first", "second", "last"]; view.focus = { focus() {} }; view.gutter = () => 60;
let comments = 0; view.commentLines = () => comments++;
view.press(0, { local_position: { x: 10 }, modifiers: {} }, cx);
assert.equal(view.selectedText(), "first\n", "IDEA line-number click selects the whole line");
view.dragTo(1, { local_position: { x: 10 } }, cx);
assert.equal(view.selectedText(), "first\nsecond\n", "line-number drag extends full-line selection");
assert.equal(comments, 0);
view.pointerRelease(1, cx);
view.press(2, { local_position: { x: 10 }, modifiers: { alt: true } }, cx);
assert.equal(comments, 1, "review comments remain available through an explicit Alt gutter gesture");

view = code(); view.lines = ["first second"]; view.cw = 8;
for (const layout of ["idea", "codebench"]) {
  idea = layout === "idea";
  assert.equal(view.textOrigin(), view.gutter() + (idea ? 4 : 12), `${layout} preserves its own text inset`);
  const x = view.textOrigin() + view.cw * 6 + 0.1;
  assert.equal(view.pointAt(0, x).col, 6, `${layout} drag uses the drawn text origin`);
  assert.equal(view.pick(0, x, cx).col, 6, `${layout} click uses the same origin as dragging`);
}
idea = true;

view = code(); view.lines = ["short"]; view.cw = 8; view.scroll = { left: 0, top: 0 };
const textOrigin = view.textOrigin(), boundary = view.gutter() - 1;
const gutterGuide = () => surface.namespace.editorGuide(view.gutter(), view.scroll);
let guide = gutterGuide();
assert.equal(guide.attributes.left[0], boundary);
assert.equal(guide.attributes.top[0], 0); assert.equal(guide.attributes.bottom[0], 0);
assert.equal(guide.attributes.w[0], 1, "one viewport guide extends below a short file");
view.scroll.left = 12; view.scroll.top = 100;
assert.equal(gutterGuide().attributes.left[0], boundary - 12, "guide follows horizontal source scrolling only");
view.scroll.left = boundary;
assert.equal(gutterGuide().attributes.left[0], 0, "guide can reach the viewport's left edge");
view.scroll.left = boundary + 1;
assert.equal(gutterGuide(), null, "guide clips away when the gutter scrolls beyond the viewport");
assert.equal(view.textOrigin(), textOrigin, "viewport decoration does not change click/drag text coordinates");
idea = false; assert.equal(gutterGuide(), null, "codebench has no new viewport decoration"); idea = true;

// Exercise attachment to the actual source render branch, including its clips.
view.scroll = { left: 0, view: () => element().id("test-source-scroll") };
view.sync = view.httpLines = view.publish = () => {};
view.items = view.fileComments = () => [];
view.comment = { panel: () => null };
view.diags = [];
const rendered = view.render(cx);
function allElements(node) {
  return node?.nodes ? [node, ...node.nodes.flatMap(allElements)] : [];
}
const viewport = allElements(rendered).find(node => node.nodes.some(child => child?.attributes?.id?.[0] === "test-source-scroll"));
assert(viewport?.attributes.relative, "the source viewport owns guide positioning");
assert(viewport.attributes.overflow_hidden, "the source viewport clips the guide at its bounds");
assert.equal(viewport.nodes.length, 2, "one guide is attached once beside the scrolling content");
assert.equal(viewport.nodes[1].attributes.bottom[0], 0, "guide spans the viewport rather than the rendered rows");
assert(!Object.keys(viewport.nodes[1].attributes).some(name => name.startsWith("on_")), "guide cannot consume pointer/selection gestures");
view.comment = { draft: null }; view.sel = null;
const row = view.row(0, {}, {});
assert.equal(row.nodes[0].attributes.border_r, undefined, "rows no longer terminate a separate gutter border at EOF");
assert.equal(rendered.attributes.on_drop, undefined, "source surface no longer receives file drops");

const diagnosticView = code();
Object.assign(diagnosticView, { lines: ["abcdef", "ghijk"], cw: 8, sel: null, comment: { draft: null },
  toks: [[[3, "keyword"], [3, "string"]]],
  diags: [{ line: 0, col: 1, end_line: 1, end_col: 3, severity: 2, message: "Spans two lines" },
    { line: 0, col: 2, end_line: 0, end_col: 4, severity: 1, message: "Overlapping error" }] });
const diagnosticOrigin = diagnosticView.textOrigin();
const diagnosticRow = diagnosticView.row(0, paintsForGit(), { keyword: "#keyword", string: "#string" });
const diagnosticNodes = allElements(diagnosticRow);
assert.ok(!diagnosticNodes.some(node => node.attributes.id?.[0]?.startsWith("cn-dg-")), "IDEA diagnostics never occupy the breakpoint gutter");
const waves = diagnosticNodes.filter(node => node.attributes.diagnostic_wave).map(node => node.attributes.diagnostic_wave[0]);
assert.deepEqual(waves.map(w => [w.offset, w.width, w.severity]), [[8, 8, 2], [16, 8, 1], [24, 8, 1], [32, 16, 2]], "UTF-16 ranges are clipped to syntax runs; overlapping errors win over warnings");
assert.equal(diagnosticNodes.find(node => node.attributes.diagnostic_wave?.[0].offset === 16).attributes.text_color[0], "#keyword");
assert.equal(diagnosticNodes.find(node => node.attributes.diagnostic_wave?.[0].offset === 24).attributes.text_color[0], "#string");
assert.equal(diagnosticView.textOrigin(), diagnosticOrigin, "diagnostics leave gutter and pointer coordinates unchanged");
const sourceCard = diagnosticNodes.find(node => node.attributes.diagnostic_options).attributes.diagnostic_options[0];
assert.equal(sourceCard.entries[0].path, diagnosticView.shown.path);
assert.deepEqual(Array.from(sourceCard.actions), ["copy", "attach"], "source diagnostic hover gets the same copy/AI actions as Problems");
assert.equal(allElements(diagnosticView.row(1, paintsForGit(), {})).find(node => node.attributes.diagnostic_wave).attributes.diagnostic_wave[0].width, 24, "multiline underline stops at its LSP end column");
const pointView = code();
Object.assign(pointView, { lines: ["", "end"], cw: 8, sel: null, comment: { draft: null }, diags: [
  { line: 0, col: 0, end_line: 0, end_col: 0, severity: 1, message: "Missing declaration" },
  { line: 1, col: 3, end_line: 1, end_col: 3, severity: 1, message: "Missing punctuation" },
] });
for (const line of [0, 1]) assert.equal(allElements(pointView.row(line, paintsForGit(), {})).filter(node => node.attributes.diagnostic_wave).length, 1, "point diagnostics retain an inline hover target on empty lines and at EOF");
assert.deepEqual(pointView.lines, ["", "end"], "point diagnostic targets never change source text");
idea = false;
const classicDiagnostics = allElements(diagnosticView.row(0, paintsForGit(), {}));
assert.ok(classicDiagnostics.some(node => node.attributes.id?.[0] === "cn-dg-0"), "codebench retains its existing diagnostic gutter");
assert.ok(!classicDiagnostics.some(node => node.attributes.diagnostic_wave), "codebench's existing straight underline is preserved");
idea = true;

const gitView = code();
Object.assign(gitView, { lines: ["first", "second", "third"], cw: 8, diags: [], comment: { draft: null }, sel: null,
  changes: new Map([[0, "mod"], [1, "mod"], [2, "add"]]), navigation: [{ line: 0, title: "Related declaration" }] });
const gitOrigin = gitView.textOrigin(), modifiedStart = gitView.row(0, paintsForGit(), {}), modifiedEnd = gitView.row(1, paintsForGit(), {}), addedLine = gitView.row(2, paintsForGit(), {});
function paintsForGit() { return { ansi1: "#red", ansi2: "#green", ansi4: "#blue" }; }
const startMark = modifiedStart.nodes[0].nodes.at(-1), endMark = modifiedEnd.nodes[0].nodes.at(-1), addedMark = addedLine.nodes[0].nodes.at(-1);
assert.equal(startMark.attributes.right[0], 1); assert.equal(startMark.attributes.w[0], 4);
assert.equal(startMark.attributes.bg[0], "#line-modified", "edge marks use semantic Git modified color");
assert.equal(startMark.attributes.rounded_t[0], 2); assert.equal(startMark.attributes.rounded_b[0], 0);
assert.equal(endMark.attributes.rounded_t[0], 0); assert.equal(endMark.attributes.rounded_b[0], 2, "a contiguous change has rounded caps only at its outer ends");
assert.equal(addedMark.attributes.bg[0], "#line-added");
assert.equal(addedMark.attributes.rounded_t[0], 2); assert.equal(addedMark.attributes.rounded_b[0], 2);
assert.equal(modifiedStart.nodes[0].nodes[1].attributes.w[0], 4, "old rail space remains reserved");
assert.equal(modifiedStart.nodes[0].nodes[3].attributes.id[0], "cn-navigation-0", "edge paint never displaces the navigation slot");
assert.equal(gitView.textOrigin(), gitOrigin);
assert.equal(surface.namespace.editorEdgeMark({ kind: "del" }).attributes.bg[0], "#line-deleted");
assert(!Object.keys(startMark.attributes).some(name => name.startsWith("on_")), "Git edge decoration does not consume line selection");
idea = false;
assert.equal(gitView.changeMark(0, paintsForGit()).attributes.bg[0], "#blue", "codebench retains its existing Git rail");
idea = true;

const mdSource = code();
Object.assign(mdSource, { shown: { ...spec("/repo/README.md"), rel: "README.md" }, lines: ["# Hello"], text: "# Hello", cw: 8, width: 7, diags: [],
  sync() {}, httpLines() {}, publish() {}, items: () => [], fileComments: () => [], comment: { panel: () => null },
  scroll: { left: 0, view: () => element() }, focus: {} });
const markdownRoot = mdSource.render(cx), sourceHeader = mdSource.header({});
assert(!allElements(markdownRoot).some(node => node.attributes.id?.[0] === "editor-footer"), "Markdown has no bottom preview bar");
const editIndex = sourceHeader.nodes.findIndex(node => node.attributes?.id?.[0] === "idea-edit");
assert.equal(sourceHeader.nodes[editIndex - 1].attributes.id[0], "cn-md", "Markdown modes sit immediately left of the separate Edit action");
assert.equal(allElements(markdownRoot).filter(node => node.attributes.id?.[0] === "cn-md").length, 1);
const sourceModes = sourceHeader.nodes[editIndex - 1];
assert.deepEqual(sourceModes.nodes.map(node => node.nodes[0]), ["Source", "Preview"]);
assert.equal(sourceModes.nodes[0].attributes.selected[0], true);
sourceModes.nodes[0].attributes.on_click[0]({}, cx);
assert.equal(mdSource.richView(), false, "choosing the current source mode is a no-op");
sourceModes.nodes[1].attributes.on_click[0]({}, cx);
sourceModes.nodes[1].attributes.on_click[0]({}, cx);
assert.equal(mdSource.richView(), true, "choosing Preview explicitly is idempotent");
mdSource.command("rich-view", cx);
assert.equal(mdSource.richView(), false, "the existing source preview command still toggles modes");
idea = false;
assert.equal(mdSource.markdownButton({}).attributes.graphic[0], "eye", "codebench keeps the existing preview icon");
idea = true;
mdSource.shown = spec("/repo/App.kt"); assert.equal(mdSource.markdownButton({}), null, "non-Markdown source has no preview eye");
current = { ...spec("/repo/App.kt"), edit: true };
const tabsRoot = new Tabs().render(cx);
assert.equal(allElements(tabsRoot).filter(node => node.attributes.graphic?.[0] === "eye").length, 0, "native file tabs no longer offer the generic upper eye that bypassed the owning editor");

// Both real callers assemble the same viewport/gutter/line components; review
// supplies two number columns and keeps diff-side/comment semantics separate.
const review = new Review(), paints = { background: "#111111", ansi1: "#ff0000", ansi2: "#00ff00", accent: "#4444ff" };
Object.assign(review, { part: "main", root: "/repo", selected: "App.kt", base: "main", mode: "worktree", context: ":/repo", cw: 8,
  rows: [{ kind: "@", text: "@@ -10 +10 @@", ctx: "App" }, { kind: "-", a: 10, text: "old text" }, { kind: "+", b: 10, text: "new text" }],
  files: [{ path: "App.kt", status: "M" }], columns: 8, focus: { focus() {} }, comment: { draft: null, panel: () => null, key: () => false },
  comments: () => [], rkey: () => ":/repo", syncStore() {},
  scroll: { left: 0, setHeights(heights) { this.heights = heights; }, view(id, _theme, _width, render) { return element().id(id).children([0, 1, 2].map(render)); } } });
// Check the real source and review click paths, including Ctrl/Meta's layout boundary.
wordResult = { start: 3, end: 7, word: "text" };
for (const useIdea of [true, false]) {
  idea = useIdea;
  for (let bits = 0; bits < 8; bits++) {
    const modifiers = { platform: Boolean(bits & 1), control: Boolean(bits & 2), alt: Boolean(bits & 4) };
    const expected = modifiers.platform ? useIdea && modifiers.alt ? "implementation" : "definition"
      : !useIdea && modifiers.control ? "definition" : null;
    const clicked = code(); clicked.lines = ["new text"]; clicked.cw = 8;
    const sourceCalls = [], reviewCalls = [];
    clicked.definition = (_cx, kind) => sourceCalls.push(kind);
    clicked.hoverAt = () => sourceCalls.push("hover");
    clicked.dragging = { x: clicked.textOrigin() + 24, mods: modifiers, moved: false };
    clicked.pointerRelease(0, cx);
    assert.equal(sourceCalls[0], expected ?? "hover");
    review.lspOk = true;
    review.lspDefinition = (_cx, kind) => reviewCalls.push(kind);
    review.lspHover = () => reviewCalls.push("hover");
    review.pickWord({ i: 2, r: review.rows[2] }, review.textOrigin() + 24, modifiers, cx);
    assert.equal(reviewCalls[0], expected ?? (useIdea ? undefined : "hover"));
  }
}
idea = true; review.lspSel = null;
review.lspDefinition = Review.prototype.lspDefinition; review.lspHover = Review.prototype.lspHover;
const reviewDiff = review.diff(paints);
const reviewHeader = reviewDiff.nodes[0], toolbarNodes = allElements(reviewHeader);
assert.equal(toolbarNodes.filter(node=>node.attributes.id?.[0] === "rv-action-open-source.action").length,1);
assert.ok(!toolbarNodes.some(node=>node.attributes.id?.[0] === "rv-open"),"source opening is not duplicated by a fixed external-open action");
assert.equal(allElements(toolbarNodes.find(node=>node.attributes.id?.[0] === "rv-action-previous-diff.action"))[1].attributes.graphic[0],"chevron-up");
assert.ok(!toolbarNodes.some(node=>node.attributes.graphic?.[0] === "eye"),"whole-file context has a named toggle instead of an ambiguous preview eye");
assert.equal(toolbarNodes.find(node=>node.attributes.id?.[0] === "rv-full").nodes[0],"Whole File");
reviewToolbarOverride=[...actions.namespace.ACTION_GROUPS["Review.toolbar"].items,{id:"duplicate-open",kind:"action",action:"codenav.review-open-source"}];
assert.equal(allElements(review.diff(paints).nodes[0]).filter(node=>node.attributes.id?.[0]?.startsWith("rv-action-")).length,3,"custom duplicated commands render once without mutating saved customization");
reviewToolbarOverride=null;
let sourceOpened;
review.openFile=(path,line)=>{sourceOpened={path,line}};review.cur=1;review.openSelectedSource();
assert.deepEqual(sourceOpened,{path:"App.kt",line:10},"old-only row opens its nearby new-side source position");
review.files[0].status="D";sourceOpened=null;review.openSelectedSource();assert.equal(sourceOpened,null,"deleted source never opens a missing working-tree file");
assert.equal(allElements(review.diff(paints).nodes[0]).find(node=>node.attributes.id?.[0] === "rv-action-open-source.action").attributes.options[0].disabled,true);
review.files[0].status="M";review.binary=true;
assert.equal(allElements(review.diff(paints).nodes[0]).find(node=>node.attributes.id?.[0] === "rv-action-next-diff.action").attributes.options[0].disabled,true);
review.binary=false;delete review.cur;
const reviewViewport = allElements(reviewDiff).find(node => node.nodes.some(child => child?.attributes?.id?.[0] === "rv-diff"));
assert.equal(reviewViewport.attributes.font_family[0], viewport.attributes.font_family[0]);
assert.equal(reviewViewport.attributes.text_size[0], viewport.attributes.text_size[0]);
assert.equal(reviewViewport.attributes.bg[0], viewport.attributes.bg[0]);
assert.equal(reviewViewport.nodes[1].attributes.left[0], review.gutter() - 1, "review uses the same full-height scroll-origin guide");
assert.deepEqual(Array.from(review.scroll.heights), [26, 20, 20], "diff hunk and source line heights match their assembled rows");
const removed = review.item({ type: "row", i: 1, r: review.rows[1] }, paints, () => false);
const added = review.item({ type: "row", i: 2, r: review.rows[2] }, paints, () => false);
assert.equal(removed.attributes.h[0], row.attributes.h[0], "source and review use the same line assembler");
assert.equal(added.nodes[1].attributes.pl[0], row.nodes[1].attributes.pl[0], "source and review share text inset assembly");
assert.equal(removed.nodes[0].nodes[0].nodes[0].nodes[0], "10");
assert.equal(removed.nodes[0].nodes[0].nodes[1].nodes[0], "", "removed row retains only its old-side number");
assert.equal(added.nodes[0].nodes[0].nodes[0].nodes[0], "");
assert.equal(added.nodes[0].nodes[0].nodes[1].nodes[0], "10", "added row retains only its new-side number");
assert.equal(removed.attributes.bg[0], "#ff00001f"); assert.equal(added.attributes.bg[0], "#00ff001f");
assert.equal(removed.nodes[0].nodes.at(-1).nodes[0], "-"); assert.equal(added.nodes[0].nodes.at(-1).nodes[0], "+");
wordResult = { start: 3, end: 7, word: "text" }; let hoverRequests = 0;
review.lspOk = true; review.lspHover = () => hoverRequests++;
review.pickWord({ i: 2, r: review.rows[2] }, review.textOrigin() + 3 * review.cw + 0.1, {}, cx);
assert.equal(review.lspSel.col, 3, "review pointer columns use the same drawn text origin");
assert.equal(hoverRequests, 0); assert.equal(review.lspPanel(paints), null, "ordinary review selection adds no action/LSP strip");
review.pickWord({ i: 1, r: review.rows[1] }, review.textOrigin() + 3 * review.cw, {}, cx);
assert.equal(review.lspSel, null, "old-only rows cannot query the new-side language server");
let draft;
review.comment.open = value => { draft = value; };
review.selectRows(1, 2, cx); assert.equal(draft.side, "new"); assert.equal(draft.start, 10);
review.selectRows(1, 1, cx); assert.equal(draft.side, "old"); assert.equal(draft.start, 10);
review.pressRow({ type: "row", i: 2, r: review.rows[2] }, { local_position: { x: review.gutter() - 1 }, modifiers: {} }, cx);
assert.equal(draft.side, "new", "review comments still start on the drawn number-gutter side of its shared boundary");
review.lspHover = Review.prototype.lspHover;
review.pickWord({ i: 2, r: review.rows[2] }, review.textOrigin() + 3 * review.cw, {}, cx);
jobs = []; response = { markdown: "Review docs" }; review.lspHover(cx); await Promise.all(jobs);
assert(review.lspPanel(paints), "explicit review documentation remains available");
jobs = []; response = []; review.lspReferences(cx); await Promise.all(jobs);
assert.equal(review.lspSel.explicit, "refs"); assert.equal(review.lspSel.hover, null);
assert(review.lspPanel(paints), "explicit empty reference results remain visible without stale documentation");
const reviewRoot = review.render(cx);
assert.equal(reviewRoot.attributes.on_drop, undefined, "review surface no longer receives file drops");
assert.equal(reviewRoot.attributes.on_mouse_up, undefined, "review root no longer consumes file DnD releases");
const reviewKey = reviewRoot.attributes.on_key_down[0]; let reviewRefs = 0, reviewDocs = 0, reviewMoves = 0;
review.lspReferences = () => reviewRefs++; review.lspHover = () => reviewDocs++; review.moveDifference = () => reviewMoves++;
const reviewKeyCx = { ...cx, stop_propagation() {} };
bindings = []; reviewKey({ keystroke: "alt-f7", key: "f7", modifiers: { alt: true } }, reviewKeyCx);
assert.equal(reviewRefs + reviewMoves, 0, "removed usages shortcut cannot revive usages or fall through to local F7 diff navigation");
bindings = [{ section: "mod:codenav", keys: "alt-f7", action: "codenav.usages" }];
reviewKey({ keystroke: "alt-f7", key: "f7", modifiers: { alt: true } }, reviewKeyCx);
reviewKey({ keystroke: "f1", key: "f1" }, reviewKeyCx);
assert.equal(reviewRefs, 1); assert.equal(reviewDocs, 1, "review retains explicit references/documentation gestures");
state["codenav.area"] = "review";
review.command("usages", cx); assert.equal(reviewRefs, 2, "natively consumed usages reaches the active main review consumer");
review.part = "side"; review.command("usages", cx); assert.equal(reviewRefs, 2, "sidebar copy cannot run main editor usages");
review.part = "main"; review.lspOk = false; review.command("usages", cx); assert.equal(reviewRefs, 2, "read-only/remote/removed review side cannot query local usages");
review.lspOk = true; state["codenav.area"] = "code"; review.command("usages", cx); assert.equal(reviewRefs, 2, "inactive review cannot consume source usages");
bindings = [];
const masks = surface.namespace.editorCornerMasks();
assert.equal(masks.length, 2); assert.equal(masks[0].attributes.paint_path[1], "#canvas");
assert(masks.every(mask => mask.attributes.size[0] === 8 && mask.attributes.top[0] === 0), "actual canvas cutouts own both top corners");
assert.equal(rendered.nodes.at(-1).attributes.paint_path[1], "#canvas", "source masks paint after child backgrounds");
assert.equal(reviewRoot.nodes.at(-1).attributes.paint_path[1], "#canvas", "review uses the same shell mask");
assert.equal(surface.namespace.editorSurface(element(), { topCorners: false }).nodes.length, 0, "tabs retain ownership of top corners when present");
const emptyView = new Code();
Object.assign(emptyView, { shown: null, lines: [], cw: 8, diags: [], sync() {}, httpLines() {}, publish() {}, items: () => [], fileComments: () => [], focus: {} });
const emptyRoot = emptyView.render(cx);
assert.equal(emptyRoot.nodes.filter(node => node?.attributes?.paint_path).length, 2, "empty source retains actual top-corner masks after its blank child");
tabsVisible = true;
assert.equal(emptyView.render(cx).nodes.filter(node => node?.attributes?.paint_path).length, 0, "visible tabs own the top edge rather than a second editor mask");
tabsVisible = false;
idea = false;
assert.equal(review.gutter(), 111); assert.equal(review.textOrigin(), 135, "codebench diff hit coordinates remain unchanged");
assert.equal(surface.namespace.editorCornerMasks().length, 0);
assert.equal(review.item({ type: "row", i: 2, r: review.rows[2] }, paints, () => false).attributes.gap[0], 8, "codebench retains its original diff assembly");
idea = true; wordResult = null;

view = code(); view.outline = true; view.symbols = [{ kind: "class", name: "App", depth: 0 }];
view.note = "stale note"; view.hover = { markdown: "stale hover" };
assert.equal(view.outlinePanel({}), null, "IDEA never renders an internal Outline even with stale enabled state");
assert.equal(view.infoBar({}), null, "IDEA selection/note/old hover cannot resurrect the bottom action strip");
idea = false;
assert(view.outlinePanel({}), "codebench retains its internal Outline");
assert(view.infoBar({}), "codebench retains its selection/actions strip");
idea = true;

view = code(); response = { markdown: "Explicit documentation" };
view.hoverAt(cx);
assert.equal(jobs.length, 0, "ordinary IDEA selection does not start an invisible documentation request");
assert.equal(view.infoBar({}), null);
view.hoverAt(cx, true); await Promise.all(jobs);
assert.equal(view.hover.markdown, "Explicit documentation");
assert.equal(view.infoBar({}).attributes.id[0], "cn-documentation", "explicit documentation retains a dedicated content body");
view.closeInfo(); assert.equal(view.infoBar({}), null, "Escape/close removes explicitly requested documentation");
view = code(); view.comment = { typing: false }; let documentationCalls = [];
view.hoverAt = (_cx, explicit) => documentationCalls.push(explicit);
const keyCx = { ...cx, stop_propagation() {} };
view.keyDown({ keystroke: "f1" }, keyCx); view.keyDown({ keystroke: "ctrl-j" }, keyCx);
assert.deepEqual(documentationCalls, [true, true], "both documentation keys remain explicit");
view.command("file-structure", cx);
assert.equal(opened.at(-1)[1], "structure", "the File Structure popup is independent of the removed internal Outline");
view = code(); view.comment = { typing: false }; let definitions = 0, copied = 0;
view.definition = () => definitions++; view.copy = () => copied++;
bindings = [{ section: "mod:codenav", keys: "cmd-b", action: "codenav.definition" }];
view.keyDown({ keystroke: "cmd-b" }, keyCx); assert.equal(definitions, 1);
bindings = []; view.keyDown({ keystroke: "cmd-b" }, keyCx);
assert.equal(definitions, 1, "removing a binding disables the raw editor fallback");
bindings = [{ section: "mod:codenav", keys: "cmd-b", action: "codenav.implementation" }];
view.keyDown({ keystroke: "cmd-b" }, keyCx);
assert.equal(definitions, 1, "reassigning a chord cannot execute the previous raw editor action");
bindings = [{ section: "mod:codenav", keys: "cmd-O", action: "codenav.find-file" }];
view.keyDown({ keystroke: "cmd-shift-o" }, keyCx);
assert.equal(opened.at(-1)[1], "files", "normalized effective key aliases still execute the current registered action");
bindings = []; view.keyDown({ keystroke: "cmd-c" }, keyCx); assert.equal(copied, 1, "local text copy is independent of registry shortcuts");
idea = false; view.keyDown({ keystroke: "cmd-b" }, keyCx); assert.equal(definitions, 2, "codebench retains its original local shortcuts"); idea = true;
notifications = []; view = code(); response = [];
view.definition(cx); await Promise.all(jobs);
assert.equal(notifications.length, 1, "missing definition retains visible feedback without a selection strip");
notifications = []; view = code(); response = [];
view.related({ kind: "super", title: "Super" }, cx); await Promise.all(jobs);
assert.equal(notifications.length, 1, "missing related target retains visible feedback");
notifications = []; view = code(); response = Promise.reject(Error("navigation unavailable"));
view.definition(cx); await Promise.all(jobs);
assert.equal(notifications[0].level, "error", "navigation errors remain visible after removing the action strip");
notifications = []; view = code(); view.commentLines(0, 0, cx);
assert.equal(notifications.length, 1, "a comment outside a repository retains visible failure feedback");
idea = false; view = code(); response = { markdown: "Codebench hover" };
view.hoverAt(cx); await Promise.all(jobs);
assert.equal(view.hover.markdown, "Codebench hover", "codebench ordinary selection still loads its existing hover content");
idea = true;

function native() {
  slot = "@area:a"; current = spec(); state = { "activity.editor": { [slot]: current } }; opened = []; jobs = [];
  const view = new Native();
  let text = "changed";
  const editor = { value: () => text, release() { this.released = true; } };
  Object.assign(view, { slot: true, shownKey: slot, shown: current, code: editor, original: "original", dirty: true,
    workspaceBuffers: new Map(), key: JSON.stringify({ slot, spec: current }), seq: 1, readonly: false });
  view.watch = () => {};
  view.setText = value => { text = value; }; view.publishState(); return view;
}
const mdNative = native(), nativeBuffer = mdNative.code;
Object.assign(mdNative, { shown: { ...spec("/repo/README.md"), rel: "README.md" }, mdMode: "edit", sync() {} });
for (const next of ["preview", "edit"]) {
  const nativeRoot = mdNative.render(cx), modes = allElements(nativeRoot.nodes[0]).find(node => node.attributes.id?.[0] === "ed-mode");
  assert(modes, "native Markdown text modes are in the upper header");
  assert(!allElements(nativeRoot).some(node => node.attributes.id?.[0] === "editor-footer"));
  assert.equal(allElements(nativeRoot).filter(node => node.attributes.id?.[0] === "ed-mode").length, 1, "native Markdown has exactly one mode group");
  assert.deepEqual(modes.nodes.map(node => node.nodes[0]), ["Edit", "Preview"]);
  const selectedMode = modes.nodes.find(node => node.attributes.selected[0]);
  const before = mdNative.mdMode;
  selectedMode.attributes.on_click[0]({}, cx); assert.equal(mdNative.mdMode, before, "current native mode is a no-op");
  modes.nodes.find(node => node.attributes.id[0] === `ed-mode-${next}`).attributes.on_click[0]({}, cx);
  assert.equal(mdNative.mdMode, next); assert.equal(mdNative.code, nativeBuffer); assert.equal(mdNative.code.value(), "changed"); assert.equal(mdNative.dirty, true);
}
idea = false;
mdNative.mdMode = "split";
assert.equal(mdNative.markdownButton({}).attributes.graphic[0], "eye", "codebench native preview keeps its icon");
for (const next of ["preview", "edit", "split"]) {
  mdNative.toggleMarkdown();
  assert.equal(mdNative.mdMode, next, "codebench retains the split preview cycle");
  assert.equal(mdNative.code, nativeBuffer);
}
idea = true;
mdNative.shown = spec("/repo/App.kt");
assert.equal(mdNative.markdownButton({}), null, "ordinary native editor has no preview eye");
view = native();
let request = { key: slot, token: "close-a", ids: ["f::/repo/App.kt"], path: current.path, on: null, status: "pending" };
state["activity.closeRequest"] = { [slot]: request };
saveWrite = async () => { throw Error("external file changed"); };
view.save(cx, request); await Promise.all(jobs);
assert.equal(view.dirty, true); assert.equal(state["activity.closeRequest"][slot].status, "pending");
assert.equal(opened.length, 0, "failed optimistic save cannot approve close");
saveWrite = () => new Promise(done => { resolve = done; }); jobs = [];
view.save(cx, request); view.setText("edited while save runs"); resolve(); await Promise.all(jobs);
assert.equal(view.dirty, true, "edits made while saving remain dirty");
assert.equal(state["activity.closeRequest"][slot].status, "pending");
saveWrite = async () => {}; jobs = [];
view.save(cx, request); await Promise.all(jobs);
assert.equal(state["activity.editorState"][slot].dirty, false);
assert.equal(state["activity.closeRequest"][slot].status, "approved");
assert.match(opened.at(-1)[0], /^codenav\.close-approved:/);

view = native();
request = { key: slot, token: "cancel-close", ids: ["f::/repo/App.kt"], path: current.path, on: null, status: "pending" };
state["activity.closeRequest"] = { [slot]: request };
saveWrite = () => new Promise(done => { resolve = done; });
view.save(cx, request); view.cancelPending(cx);
resolve(); await Promise.all(jobs);
assert.equal(state["activity.closeRequest"][slot], undefined);
assert.equal(opened.length, 0, "a completed save cannot approve a cancelled close token");

view = native(); const buffer = view.code;
current = { ...current, at: 99, line: 20 }; state["activity.editor"][slot] = current; view.sync(cx);
assert.equal(view.code, buffer); assert.equal(view.hasPending, false, "same document re-selection preserves buffer and undo");
view.load = () => { view.code = { value: () => "B", release() {} }; };
slot = "@area:b"; current = spec("/repo/B.kt"); state["activity.editor"][slot] = current; view.sync(cx);
assert.equal(view.workspaceBuffers.get("@area:a").code, buffer); assert.equal(buffer.released, undefined);
slot = "@area:a"; current = spec(); state["activity.editor"][slot] = current; view.sync(cx);
assert.equal(view.code, buffer); assert.equal(view.dirty, true, "returning to a workspace restores its in-memory dirty editor");

// A write owns its native buffer until completion, even after undo clears dirty.
view = native();
const savingBuffer = view.code;
saveWrite = () => new Promise(done => { resolve = done; });
view.save(cx);
view.setText("original"); view.dirty = false;
current = spec("/repo/Next.md"); state["activity.editor"][slot] = current;
let loads = 0;
view.load = () => { loads++; view.code.release(); view.code = null; };
view.sync(cx);
assert.equal(view.code, savingBuffer); assert.equal(loads, 0, "pending save prevents release after undo");
view.cancelPending(cx);
assert.equal(view.hasPending, false);
resolve(); await Promise.all(jobs);
assert.equal(view.code, savingBuffer); assert.equal(view.original, "changed"); assert.equal(view.dirty, true);

// Background save completion and failure belong to the parked workspace.
for (const fail of [false, true]) {
  view = native(); const source = view.code;
  let finish;
  saveWrite = () => new Promise((done, reject) => { finish = () => fail ? reject(Error("offline")) : done(); });
  view.save(cx);
  const finishA = finish;
  const pendingWrite = jobs[0];
  slot = "@area:b"; current = spec("/repo/B.md"); state["activity.editor"][slot] = current;
  view.load = () => { view.code = { value: () => "B", release() {} }; view.original = "B original"; view.note = null; };
  view.sync(cx);
  assert.equal(source.released, undefined);
  assert.equal(view.saving, false, "workspace B has its own save state");
  assert.equal(view.mdMode, "edit", "new IDEA Markdown document starts in edit mode");
  view.dirty = true;
  view.save(cx);
  const finishB = finish;
  assert.equal(view.saving, true);
  const parked = view.workspaceBuffers.get("@area:a");
  assert.equal(parked.saving, true);
  finishA(); await pendingWrite;
  assert.equal(view.saving, true, "A completion cannot clear B saving state");
  assert.equal(view.original, "B original"); assert.equal(view.note, null);
  assert.equal(parked.saving, false); assert.equal(parked.dirty, fail);
  assert.equal(source.released, undefined);
  if (fail) assert.match(parked.note, /offline/);
  else assert.equal(parked.original, "changed");
  finishB(); await jobs[1];
  slot = "@area:a"; current = spec(); state["activity.editor"][slot] = current;
  view.sync(cx);
  assert.equal(view.code, source);
  assert.equal(view.saving, false); assert.equal(view.dirty, fail);
  if (fail) assert.match(view.note, /offline/);
}
view = native();
const pendingBuffer = view.code;
saveWrite = () => new Promise(done => { resolve = done; });
view.save(cx);
slot = "@area:b"; current = spec("/repo/B.md"); state["activity.editor"][slot] = current;
view.load = () => { view.code?.release(); view.code = { value: () => "B", release() {} }; };
view.sync(cx);
slot = "@area:a"; current = spec("/repo/Next.md"); state["activity.editor"][slot] = current;
view.sync(cx);
assert.equal(view.code, pendingBuffer); assert.equal(view.hasPending, true);
resolve(); await Promise.all(jobs);
assert.equal(view.shown.path, "/repo/Next.md", "a pending target resumes after restoring a saving buffer");
assert.equal(pendingBuffer.released, true);
console.log("PASS editor workspace/machine snapshots, late navigation cancellation, independent publishing, dirty save/close handshake, concurrent edits and buffer retention");
console.log("PASS IDEA Outline/action-strip guards, codebench preservation, explicit documentation and navigation failure feedback");
console.log("PASS viewport gutter guide height, horizontal clipping, source attachment, pointer pass-through and unchanged text origin");
console.log("PASS shared source/review viewport, gutter and line assembly, diff-side/comment semantics, 16 modifier/layout click cases, explicit docs/refs, canvas masks, no file DnD and effective keymap edits");
console.log("PASS semantic Git edge bars/caps without coordinate shifts, ordinary eye removal and source/native upper Markdown controls with dirty buffer retention");

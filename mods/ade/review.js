import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { exec, readTextFile, shared, setShared, agents, openOverlay, run } from "herdr";
import { adeUI, adeColors, adeButton, adeInputBox, adeGutterAction, adeManagedList, adeNote, MenuController } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, projectKey, openDocument } from "./workspace.js";
import { REVIEW_LIMIT, reviewFileTree, reviewFiles, reviewRows, newFileRows, differenceIndex, sourceLine, reviewRange, reviewMessage } from "./review-model.js";
import { ReviewAnalysis, reviewSegments } from "./review-analysis.js";
import { IDEA_TOKENS } from "./idea-tokens.js";
import { gutterIcon } from "./gutter-navigation.js";

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const repoKey = context => JSON.stringify([context.machine ?? null, context.root]);
const stateOf = context => object(object(shared("ade.reviews"))[repoKey(context)] ?? object(shared("codenav.reviews"))[`${context.machine ?? ""}:${context.root}`]);
const saveState = (context, patch) => setShared("ade.reviews", { ...object(shared("ade.reviews")), [repoKey(context)]: { ...stateOf(context), ...patch } });
const absolute = (root, path) => `${root.replace(/\/$/, "")}/${path}`;
const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const icon = name => uiIcon(name, 16);
export function openReview(context = currentProject()) {
  const key = projectKey(context);
  setShared("ade.review-open", { ...object(shared("ade.review-open")), [key]: true });
  setShared("ade.editor-mode", { ...object(shared("ade.editor-mode")), [key]: "review" });
}
export class ReviewService {
  async git(context, args, allowFailure = false) {
    const result = await exec("git", ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", ...args], { cwd: context.root, on: context.machine });
    if (result.code && !allowFailure) throw new Error(result.stderr || result.stdout || `Git 오류 ${result.code}`);
    return result;
  }
  async repository(context) {
    const top = (await this.git(context, ["rev-parse", "--show-toplevel"])).stdout.replace(/\r?\n$/, "");
    const prefix = (await this.git(context, ["rev-parse", "--show-prefix"])).stdout.trim();
    const scoped = { ...context, root: top, sourceRoot: prefix ? top : context.root };
    const [branch, refs, origin] = await Promise.all([
      this.git(scoped, ["rev-parse", "--abbrev-ref", "HEAD"]),
      this.git(scoped, ["for-each-ref", "--format=%(refname)%09%(refname:short)", "refs/heads", "refs/remotes"]),
      this.git(scoped, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], true),
    ]);
    return { context: scoped, branch: branch.stdout.trim(), origin: origin.stdout.trim(), refs: refs.stdout.split("\n").filter(Boolean).map(line => { const [id, label] = line.split("\t"); return { id, label }; }).filter(ref => !ref.id.endsWith("/HEAD")) };
  }
  async files(context, base, head, mode) {
    const compared = head || (mode === "head" ? "HEAD" : null), merged = await this.git(context, ["merge-base", base, compared || "HEAD"], true);
    if (merged.code || !merged.stdout.trim()) throw new Error("기준과 비교 브랜치의 공통 커밋을 찾지 못했습니다. 비교 대상을 확인하세요.");
    const mergeBase = merged.stdout.trim();
    const scope = [mergeBase, ...(compared ? [compared] : [])], flags = ["--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"];
    const [names, stats, untracked] = await Promise.all([
      this.git(context, ["diff", ...flags, "--name-status", "-z", ...scope, "--"]),
      this.git(context, ["diff", ...flags, "--numstat", "-z", ...scope, "--"]),
      compared ? Promise.resolve({ stdout: "" }) : this.git(context, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    return { mergeBase, files: reviewFiles(names.stdout, stats.stdout, untracked.stdout) };
  }
  async diff(context, file, mergeBase, head, mode, full) {
    if (file.untracked) {
      const text = await readTextFile(absolute(context.root, file.path), { on: context.machine });
      if (text === null) throw new Error("파일을 읽지 못했습니다.");
      return { rows: newFileRows(text), binary: text.includes("\0"), text, oldText: "" };
    }
    const compared = head || (mode === "head" ? "HEAD" : null);
    const result = await this.git(context, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", `--unified=${full ? 100000 : 3}`, mergeBase, ...(compared ? [compared] : []), "--", file.path]);
    const binary = /(?:Binary files|GIT binary patch)/.test(result.stdout);
    if (binary) return { rows: reviewRows(result.stdout), binary };
    const [oldSource, newSource] = await Promise.all([
      this.git(context, ["show", `${mergeBase}:${file.path}`], true),
      file.status === "D" ? Promise.resolve(null) : compared ? this.git(context, ["show", `${compared}:${file.path}`], true).then(result => result.code ? null : result.stdout) : readTextFile(absolute(context.root, file.path), { on: context.machine }),
    ]);
    return { rows: reviewRows(result.stdout), binary, oldText: oldSource.code ? "" : oldSource.stdout, text: newSource };
  }
  fetch(context) { return this.git(context, ["fetch", "--all", "--prune", "--quiet"]); }
}

export class ReviewView {
  init(props, cx) {
    this.analysis = new ReviewAnalysis(); this.analysis.init({ owner: props.owner, beforeOpen: props.beforeAnalysis, onUpdate: eventCx => eventCx.notify(), onNavigate: (location, eventCx) => this.navigate(location, eventCx) });
    this.asyncCx = cx;
    this.context = props.context ?? currentProject(); this.service = props.service ?? new ReviewService(); this.alive = true; this.sequence = 0; this.diffSequence = 0;
    this.refsMenu = new MenuController(cx); this.focus = cx.focus_handle();
    this.filter = InputState.new({ placeholder: "브랜치 검색" }); this.filter.on("change", (_event, eventCx) => eventCx.notify());
    this.comment = TextareaState.new({ rows: 3, placeholder: "리뷰 코멘트 · Cmd/Ctrl+Enter로 저장" });
    this.files = []; this.rows = []; this.refs = []; this.mode = "worktree"; this.base = "HEAD"; this.head = null; this.selected = null;
    this.cursor = null; this.anchor = null; this.windowStart = 0; this.viewportHeight = 400; this.viewportWidth = 800; this.full = false; this.section = "files"; this.target = null; this.jobs = [];
    this.worker = cx.timer.every(25, taskCx => { if (this.alive && this.jobs.length) { const context = this.jobs.pop(); this.jobs.length = 0; this.refresh(taskCx, context); } }, { owner: props.owner });
    this.refresh(cx, this.context);
  }
  release(cx) {
    this.alive = false; this.sequence++; this.diffSequence++; this.jobs.length = 0; const wake = this.wake; this.wake = null; wake?.(); this.worker?.cancel();
    for (const menu of [this.refsMenu]) { menu.release(); menu.focus.release(); }
    this.focus.release(); this.filter.release(); this.comment.release();
    return this.analysis.release(cx ?? this.asyncCx);
  }
  current(context = this.context) { return this.alive && projectKey(currentProject()) === projectKey(context); }
  setActive(active, cx) { this.analysisActive = active; return active ? undefined : this.analysis.close(cx); }
  navigate(location, cx) {
    if (!this.current() || !location?.path) return;
    const key = projectKey(this.context);
    if (location.external) setShared("ade.external-sources", { ...object(shared("ade.external-sources")), [key]: { ...object(shared("ade.external-sources"))?.[key], [location.path]: true } });
    setShared("ade.navigation", { ...object(shared("ade.navigation")), [key]: { path: location.path, line: (location.line ?? 0) + 1, column: (location.col ?? 0) + 1, at: Date.now() } });
    openDocument(location.path, this.context); cx.notify();
  }
  semantic(kind, cx) { cx.spawn(async taskCx => { try { await this.analysis.request(kind, taskCx); } catch (error) { this.note = String(error); taskCx.notify(); } }); }
  codeLine(row, cx) {
    const c = adeColors(), palette = IDEA_TOKENS["herdr.ux"].syntax;
    return h_flex().flex_none().children(reviewSegments(row.text || " ", this.analysis.tokens(row)).map((span, index) =>
      div().id(`review-code-${row.a ?? ""}-${row.b ?? ""}-${index}`).flex_none().text_color(palette[span.category] || c.foreground).child(span.text.replace(/\t/g, "    "))
        .on_mouse_down("left", (event, eventCx) => {
          if ((event.modifiers?.platform || event.modifiers?.command || event.modifiers?.control) && this.analysis.select(row, span.from, eventCx)) { eventCx.stop_propagation(); this.semantic("definition", eventCx); }
        })
        .on_mouse_down("right", (_event, eventCx) => { if (this.analysis.select(row, span.from, eventCx)) { eventCx.stop_propagation(); eventCx.notify(); } })
    ));
  }
  publishSidebar() {
    if (!this.current()) return;
    const key = projectKey(this.context);
    setShared("ade.review-files", { ...object(shared("ade.review-files")), [key]: {
      files: this.files, repository: this.repository, version: this.filesRevision ?? 0, loading: this.loading, error: this.error,
      staleComments: this.comments().filter(comment => this.commentStale(comment)).map(comment => comment.id),
    } });
  }
  state() { return this.repository ? stateOf(this.repository) : {}; }
  comments() { return Array.isArray(this.state().comments) ? this.state().comments : []; }
  save(patch) { if (this.repository) { saveState(this.repository, patch); this.publishSidebar(); } }
  dirty() { return Boolean(this.draft && (this.draft.id ? this.comment.value().trim() !== this.draft.body : this.comment.value().trim())); }
  requestClose(after, cx) { if (!this.dirty()) { after(cx); return; } this.pendingClose = after; cx.notify(); }
  canSaveComment() { return Boolean(this.draft && this.comment.value().trim() && this.current() && this.repository && repoKey(this.draftContext) === repoKey(this.repository)); }
  closeDraft(action, cx) {
    if (action === "cancel") { this.pendingClose = null; cx.notify(); return; }
    if (action === "save") { if (!this.canSaveComment()) return; this.saveComment(cx); if (this.dirty()) return; }
    else { this.draft = null; this.comment.set_value(""); this.note = ""; }
    const after = this.pendingClose; this.pendingClose = null; after?.(cx);
  }
  refresh(cx, context = currentProject()) {
    if (!this.alive) return;
    if (projectKey(context) !== projectKey(this.context)) { this.files = []; this.rows = []; this.repository = null; this.selected = null; }
    this.context = context; const sequence = ++this.sequence; this.diffSequence++; this.loading = true; this.error = ""; this.publishSidebar(); cx.notify();
    cx.spawn(async taskCx => {
      try {
        if (!context.root) throw new Error("프로젝트 폴더를 먼저 선택하세요.");
        const result = await this.service.repository(context, taskCx);
        if (sequence !== this.sequence || !this.current(context)) return;
        this.repository = result.context; this.branch = result.branch; this.refs = result.refs;
        const state = this.state(), resolve = value => this.refs.find(ref => ref.id === value || ref.label === value)?.id;
        this.base = (state.base === "HEAD" ? "HEAD" : resolve(state.base)) || resolve(result.origin) || resolve("origin/main") || resolve("main") || this.refs.find(ref => ref.label !== result.branch)?.id || "HEAD";
        this.head = null; this.mode = state.mode === "head" ? "head" : "worktree"; this.selected = state.selected ?? null;
        await this.readFiles(taskCx, sequence);
      } catch (error) { if (sequence === this.sequence && this.current(context)) { this.error = String(error); this.files = []; this.rows = []; this.diffLoading = false; } }
      finally { if (sequence === this.sequence && this.current(context)) { this.loading = false; this.publishSidebar(); taskCx.notify(); } }
    });
  }
  async readFiles(cx, sequence = this.sequence) {
    const context = this.context, result = await this.service.files(this.repository, this.base, this.head, this.mode, cx);
    if (sequence !== this.sequence || !this.current(context)) return;
    this.mergeBase = result.mergeBase; this.files = result.files; this.filesRevision = (this.filesRevision ?? 0) + 1; this.error = "";
    this.selected = this.files.some(file => file.path === this.selected) ? this.selected : this.files[0]?.path ?? null;
    this.save({ base: this.base, head: this.head, mode: this.mode, selected: this.selected });
    if (this.selected) await this.readDiff(cx); else { this.rows = []; this.diffLoading = false; this.binary = false; this.cursor = null; }
  }
  reloadFiles(cx) {
    const sequence = ++this.sequence; this.diffSequence++; this.loading = true; this.error = ""; this.publishSidebar(); this.save({ base: this.base, head: this.head, mode: this.mode }); cx.notify();
    cx.spawn(async taskCx => { try { await this.readFiles(taskCx, sequence); } catch (error) { if (sequence === this.sequence && this.current()) { this.error = String(error); this.files = []; this.rows = []; this.selected = null; this.diffLoading = false; } } finally { if (sequence === this.sequence && this.current()) { this.loading = false; this.publishSidebar(); taskCx.notify(); } } });
  }
  async readDiff(cx) {
    const file = this.files.find(file => file.path === this.selected), context = this.context, sequence = ++this.diffSequence;
    this.diffLoading = true; this.rows = []; this.cursor = null; this.windowStart = 0;
    await this.analysis.close(cx);
    try {
      const result = file ? await this.service.diff(this.repository, file, this.mergeBase, this.head, this.mode, this.full, cx) : { rows: [], binary: false };
      if (sequence !== this.diffSequence || !this.current(context)) return;
      this.rows = result.rows; this.binary = result.binary; this.cursor = differenceIndex(this.rows, null, 1); this.reveal(this.cursor);
      if (this.analysisActive !== false && file && !result.binary && result.text !== undefined) await this.analysis.load({ context, path: absolute(this.repository.sourceRoot ?? this.repository.root, file.path), text: result.text, oldText: result.oldText, historical: this.mode === "head" }, cx);
      if (this.commentId) this.revealComment(this.comments().find(comment => comment.id === this.commentId));
    } catch (error) { if (sequence === this.diffSequence && this.current(context)) this.error = String(error); }
    finally { if (sequence === this.diffSequence && this.current(context)) { this.diffLoading = false; this.publishSidebar(); cx.notify(); } }
  }
  selectFile(path, cx) {
    if (this.loading || !this.current() || !this.files.some(file => file.path === path)) return;
    this.selected = path; this.anchor = null; this.error = ""; this.save({ selected: path });
    cx.spawn(async taskCx => { await this.readDiff(taskCx); }); cx.notify();
  }
  pick(kind, cx) { if (kind !== "base") return; this.picking = this.picking ? null : "base"; this.pickId = this.base; this.filter.set_value(""); if (this.picking) this.filter.focus(); cx.notify(); }
  chooseRef(id, cx) {
    if (this.picking !== "base") return;
    this.base = id; this.picking = null; this.reloadFiles(cx);
  }
  fetch(cx) {
    if (this.fetching || !this.repository || !this.current()) return;
    this.fetching = true; const context = this.context, repository = this.repository; cx.notify();
    cx.spawn(async taskCx => { try { await this.service.fetch(repository, taskCx); if (this.current(context)) this.refresh(taskCx, context); } catch (error) { if (this.current(context)) this.error = String(error); } finally { if (this.alive) { this.fetching = false; taskCx.notify(); } } });
  }
  reveal(index) { if (index === null || index === undefined) return; const count = this.rowCount(); if (index < this.windowStart) this.windowStart = index; else if (index >= this.windowStart + count) this.windowStart = index - count + 1; this.clampWindow(); }
  rowCount() { return Math.max(1, Math.min(80, Math.floor((this.viewportHeight - 16) / 24))); }
  clampWindow() { this.windowStart = Math.max(0, Math.min(this.windowStart, Math.max(0, this.rows.length - this.rowCount()))); }
  moveDifference(direction, cx) { this.cursor = differenceIndex(this.rows, this.cursor, direction); this.reveal(this.cursor); cx.notify(); }
  openSelectedSource() {
    const file = this.files.find(file => file.path === this.selected); if (!file || file.status === "D" || this.loading || this.diffLoading || !this.current()) return;
    const path = absolute(this.repository.sourceRoot ?? this.repository.root, file.path); openDocument(path, this.context);
    setShared("ade.navigation", { ...object(shared("ade.navigation")), [projectKey(this.context)]: { path, line: sourceLine(this.rows, this.cursor ?? 0), column: 1, at: Date.now() } });
  }
  selectRange(from, to, cx, focus = true) {
    if (!this.repository || !this.current() || this.loading || this.diffLoading) return;
    if (this.draft && repoKey(this.draftContext) !== repoKey(this.repository)) { this.note = "이전 프로젝트의 코멘트 초안을 저장하거나 취소하세요."; cx.notify(); return; }
    if (this.draft?.id && this.comment.value().trim() !== this.draft.body) { this.note = "작성 중인 코멘트를 먼저 저장하거나 취소하세요."; cx.notify(); return; }
    const draft = reviewRange(this.rows, from, to, this.selected); if (!draft) return;
    if (!this.draft || this.draft.id) this.comment.set_value("");
    this.draft = { ...draft, base: this.base, head: this.head, mode: this.mode }; this.draftContext = { ...this.repository }; this.cursor = to; if (focus) this.comment.focus(); cx.notify();
  }
  saveComment(cx) {
    const body = this.comment.value().trim(); if (!this.draft || !body) return;
    if (!this.current() || repoKey(this.draftContext) !== repoKey(this.repository)) { this.note = "원래 프로젝트로 돌아가 이 코멘트를 저장하거나 취소하세요."; cx.notify(); return; }
    const comment = { ...this.draft, body, id: this.draft.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
    this.save({ comments: [...this.comments().filter(item => item.id !== comment.id), comment] }); this.draft = null; this.comment.set_value(""); this.note = ""; cx.notify();
  }
  editComment(id, cx) {
    if (!this.current()) return;
    const comment = this.comments().find(item => item.id === id); if (!comment) return;
    if (this.dirty()) { this.note = "작성 중인 코멘트를 먼저 저장하거나 취소하세요."; cx.notify(); return; }
    this.draft = { ...comment }; this.draftContext = { ...this.repository }; this.comment.set_value(comment.body); this.comment.focus(); cx.notify();
  }
  removeComment(id, cx) { if (!this.current()) return; this.save({ comments: this.comments().filter(comment => comment.id !== id) }); if (this.draft?.id === id) { this.draft = null; this.comment.set_value(""); } if (this.commentId === id) this.commentId = null; cx.notify(); }
  revealComment(comment) { if (!comment || comment.path !== this.selected) return; const index = this.rows.findIndex(row => (comment.side === "old" ? row.a : row.b) >= comment.start); if (index >= 0) { this.cursor = index; this.reveal(index); } }
  showComment(id, cx) { this.commentId = id; const comment = this.comments().find(item => item.id === id); if (comment && this.files.some(file => file.path === comment.path)) { if (comment.path !== this.selected) this.selectFile(comment.path, cx); else this.revealComment(comment); } cx.notify(); }
  commentStale(comment) {
    return !this.files.some(file => file.path === comment.path)
      || comment.base !== undefined && (comment.base !== this.base || (comment.head ?? null) !== this.head || comment.mode !== this.mode)
      || comment.path === this.selected && !this.loading && !this.diffLoading && !this.rows.some(row => { const line = comment.side === "old" ? row.a : row.b; return line >= comment.start && line <= comment.end; });
  }
  message() { return reviewMessage({ base: this.base, head: this.head, mode: this.mode }, this.comments()); }
  attach() {
    const choices = agents().filter(agent => agent.space === this.context.id), target = choices.find(agent => agent.address === this.target) ?? choices[0];
    if (!target || !this.current() || !this.comments().length) return;
    openOverlay({ mod: "ade", kind: "dialog", frame: "none", width: 760, height: 560, props: { view: "attachment", address: target.address, context: this.context, text: this.message() } });
  }
  key(event, cx) {
    if (event.keystroke === "enter" && this.cursor !== null) { cx.stop_propagation(); this.selectRange(this.cursor, this.cursor, cx); return; }
    const key = event.key ?? event.keystroke, steps = { up: -1, down: 1, pageup: -this.rowCount(), pagedown: this.rowCount() };
    if (!["home", "end", ...Object.keys(steps)].includes(key) || !this.rows.length) return;
    cx.stop_propagation(); const before = this.cursor ?? 0, next = key === "home" ? 0 : key === "end" ? this.rows.length - 1 : Math.max(0, Math.min(this.rows.length - 1, before + steps[key]));
    this.cursor = next; this.reveal(next); if (event.modifiers?.shift) { this.anchor ??= before; this.selectRange(this.anchor, next, cx, false); } else this.anchor = next; cx.notify();
  }
  render(cx) {
    const current = currentProject();
    if (projectKey(current) !== projectKey(this.context) && !this.jobs.length) { this.jobs.push(current); const wake = this.wake; this.wake = null; wake?.(); }
    const c = adeColors(), comments = this.comments(), selectedFile = this.files.find(file => file.path === this.selected), selectedComment = comments.find(comment => comment.id === this.commentId), agentChoices = agents().filter(agent => agent.space === this.context.id);
    this.clampWindow(); const start = this.windowStart, end = Math.min(this.rows.length, start + this.rowCount());
    const contentWidth = Math.max(this.viewportWidth, ...this.rows.slice(start, end).map(row => row.text.replace(/\t/g, "    ").length * 14 + 120));
    const refLabel = id => this.refs.find(ref => ref.id === id)?.label || id || "현재 checkout";
    const refs = [{ id: "HEAD", label: "HEAD · 현재 커밋" }, ...this.refs].filter(ref => ref.label.toLowerCase().includes(this.filter.value().toLowerCase()));
    const button = (id, label, action, options = {}) => adeButton(`review-${id}`, label, action, options);
    const toolbar = h_flex().flex_none().min_h(36).items_center().gap(4).px(8).border_b(1).border_color(c.separator)
      .child(button("base", div().max_w(180).truncate().child(`기준 · ${refLabel(this.base)}`), (_event, eventCx) => this.pick("base", eventCx), { icon: icon("chevron-down"), tip: `기준 · ${refLabel(this.base)}`, disabled: this.loading }))
      .child(div().text_color(c.secondary).child("→"))
      .child(div().px(8).text_color(c.foreground).child("현재 프로젝트"))
      .child(button("mode", this.head || this.mode === "head" ? "커밋만" : "작업 트리 포함", (_event, eventCx) => { this.mode = this.mode === "head" ? "worktree" : "head"; this.reloadFiles(eventCx); }, { selected: this.mode === "worktree" && !this.head, disabled: Boolean(this.head) || this.loading }))
      .child(div().flex_1()).child(button("refresh", null, (_event, eventCx) => this.refresh(eventCx), { icon: icon("refresh"), square: true, tip: "리뷰 새로고침", disabled: this.loading }))
      .child(button("fetch", this.fetching ? "원격 갱신 중…" : "원격 갱신", (_event, eventCx) => this.fetch(eventCx), { disabled: this.fetching || !this.repository }));
    const diff = v_flex().flex_1().min_w(0).min_h(0).h_full()
      .child(h_flex().flex_none().min_h(36).items_center().gap(3).px(6).border_b(1).border_color(c.separator)
        .child(div().flex_1().min_w(0).truncate().child(this.selected || "변경 파일 없음"))
        .child(button("previous", null, (_event, eventCx) => this.moveDifference(-1, eventCx), { icon: icon("chevron-up"), square: true, tip: "이전 변경", disabled: !this.rows.length }))
        .child(button("next", null, (_event, eventCx) => this.moveDifference(1, eventCx), { icon: icon("chevron-down"), square: true, tip: "다음 변경", disabled: !this.rows.length }))
        .child(button("full", "전체 문맥", (_event, eventCx) => { this.full = !this.full; this.selectFile(this.selected, eventCx); }, { selected: this.full, disabled: !selectedFile || this.diffLoading }))
        .child(button("source", "현재 소스 열기", () => this.openSelectedSource(), { disabled: !selectedFile || selectedFile.status === "D" || this.loading || this.diffLoading }))
        .child(button("comment", "코멘트", (_event, eventCx) => this.selectRange(this.cursor ?? 0, this.cursor ?? 0, eventCx), { disabled: !this.rows.length || this.diffLoading })))
      .child(v_flex().id("ade-review-diff").flex_1().min_h(0).min_w(0).overflow_hidden().track_focus(this.focus)
        .on_size_change((size, eventCx) => { if (size.height > 0 && size.width > 0 && (Math.abs(size.height - this.viewportHeight) > 0.5 || Math.abs(size.width - this.viewportWidth) > 0.5)) { this.viewportHeight = size.height; this.viewportWidth = size.width; this.reveal(this.cursor); eventCx.notify(); } })
        .on_key_down((event, eventCx) => this.key(event, eventCx))
        .on_mouse_up("left", () => { this.dragging = false; }).on_hover(hovered => { if (!hovered) this.dragging = false; })
        .on_scroll_wheel((event, eventCx) => { if (event.delta?.y) { this.windowStart -= Math.sign(event.delta.y) * Math.max(1, Math.round(Math.abs(event.delta.y) / 24)); this.clampWindow(); eventCx.stop_propagation(); eventCx.notify(); } })
        .when(this.diffLoading || this.loading, element => element.child(adeNote("리뷰를 읽는 중…")))
        .when(!this.loading && !this.diffLoading && !this.rows.length, element => element.child(adeNote(this.binary ? "바이너리 파일입니다. 텍스트 diff를 표시할 수 없습니다." : "이 범위에 표시할 텍스트 변경이 없습니다.")))
        .child(v_flex().flex_1().min_h(0).min_w(0).overflow_x_scrollbar().children(this.rows.slice(start, end).map((row, offset) => {
          const index = start + offset, marked = this.draft?.path === this.selected && row.kind !== "@" && (this.draft.side === "old" ? row.a : row.b) >= this.draft.start && (this.draft.side === "old" ? row.a : row.b) <= this.draft.end;
          const count = comments.filter(comment => comment.path === this.selected && (comment.side === "old" ? row.a : row.b) === comment.end).length;
          const marker = this.analysis.marker?.(row);
          return h_flex().id(`review-line-${index}`).h(24).w(contentWidth).flex_none().items_center().gap(6).font_family("monospace").text_size(12).whitespace_nowrap()
            .bg(marked ? c.selection : index === this.cursor ? c.hover : row.kind === "+" ? c.success + "15" : row.kind === "-" ? c.error + "15" : "#00000000")
            .on_mouse_down("left", (event, eventCx) => { this.focus.focus(); this.cursor = index; if (event.local_position?.x < 100 && row.kind !== "@") { if (!event.modifiers?.shift || this.anchor === null) this.anchor = index; this.selectRange(this.anchor, index, eventCx); this.dragging = true; } else eventCx.notify(); })
            .on_mouse_move((_event, eventCx) => { if (this.dragging && row.kind !== "@" && this.cursor !== index) this.selectRange(this.anchor ?? index, index, eventCx, false); })
            .child(div().w(38).flex_none().text_right().text_color(c.disabled).child(row.a === undefined ? "" : String(row.a)))
            .child(div().w(38).flex_none().text_right().text_color(c.disabled).child(row.b === undefined ? "" : String(row.b)))
            .child(div().w(12).h(24).flex_none().text_color(row.kind === "+" ? c.success : row.kind === "-" ? c.error : c.secondary).child(row.kind === " " ? "" : row.kind))
            .child(h_flex().h(24).flex_none().border_r(1).border_color(c.separator).child(adeGutterAction(`review-gutter-${index}`, marker, {
              graphic: () => icon(gutterIcon(marker)), onActivate: (_event, eventCx) => eventCx.spawn(async taskCx => { try { await this.analysis.requestMarker(row, marker, taskCx); } catch (error) { this.note = String(error); taskCx.notify(); } }),
            })))
            .child(this.codeLine(row, cx)).when(this.analysis.diagnostics(row).length > 0, element => element.child(div().text_color(c.warning).child(`⚠ ${this.analysis.diagnostics(row).length}`)))
            .when(count > 0, element => element.child(div().text_color(c.accent).child(`● ${count}`)));
        }))))
      .child(h_flex().flex_none().px(8).min_h(24).text_size(11).text_color(c.secondary).child(`${this.rows.length ? `${start + 1}–${end} / ${this.rows.length}` : "0"}줄 · 줄 번호 클릭/Shift/드래그로 범위 코멘트${this.rows.length >= REVIEW_LIMIT ? " · 표시 한도 20,000줄" : ""}`));
    const root = adeUI(v_flex()).size_full().min_w(0).min_h(0).bg(c.editor).child(toolbar)
      .when(Boolean(this.picking), element => element.child(v_flex().h(240).flex_none().min_h(0).child(adeManagedList("review-refs", refs, this.refsMenu, cx, {
        selectedId: this.pickId, search: adeInputBox(Input.new(this.filter)), onSelect: (id, event, eventCx) => { this.pickId = id; if (!event) this.chooseRef(id, eventCx); }, onActivate: (id, _event, eventCx) => this.chooseRef(id, eventCx), onClose: (_event, eventCx) => { this.picking = null; eventCx.notify(); },
      }))))
      .when(Boolean(this.error || this.note), element => element.child(adeNote(this.error || this.note)))
      .child(diff);
    const analysis = this.analysis.state;
    if (analysis.hover?.markdown || analysis.locations?.length || analysis.error || this.analysis.target) root.child(v_flex().h(130).flex_none().min_h(0).overflow_y_scrollbar().id("review-language-info").p(8).gap(4)
      .child(adeNote(analysis.error || analysis.message || `LSP · ${analysis.status ?? "준비 중"} · 현재 소스와 일치하는 줄만 분석`))
      .when(Boolean(analysis.hover?.markdown), element => element.child(TextView.markdown("review-hover", analysis.hover.markdown).selectable(true)))
      .children((analysis.locations ?? []).map((location, index) => button(`location-${index}`, `${location.path}:${location.line + 1}`, (_event, eventCx) => this.navigate(location, eventCx))))
      .children((this.analysis.state.diagnostics ?? []).filter(item => this.analysis.target && (item.line ?? item.range?.start?.line) === this.analysis.target.row.b - 1).map(item => adeNote(item.message))));
    if (this.pendingClose) root.child(h_flex().flex_none().items_center().gap(6).p(8).border_t(1).border_color(c.separator)
      .child(div().flex_1().text_color(c.secondary).child("저장하지 않은 리뷰 코멘트가 있습니다."))
      .child(button("close-save", "저장 후 닫기", (_event, eventCx) => this.closeDraft("save", eventCx), { kind: "primary", disabled: !this.canSaveComment() }))
      .child(button("close-discard", "버리고 닫기", (_event, eventCx) => this.closeDraft("discard", eventCx)))
      .child(button("close-cancel", "취소", (_event, eventCx) => this.closeDraft("cancel", eventCx))));
    if (this.draft) root.child(v_flex().flex_none().gap(5).p(8).border_t(1).border_color(c.separator)
      .on_key_down((event, eventCx) => { if (["cmd-enter", "ctrl-enter"].includes(event.keystroke)) { eventCx.stop_propagation(); this.saveComment(eventCx); } else if (event.keystroke === "escape") { this.draft = null; this.comment.set_value(""); eventCx.stop_propagation(); eventCx.notify(); } })
      .child(div().text_color(c.secondary).child(`${this.draftContext?.root} / ${this.draft.path}:${this.draft.start}–${this.draft.end} · ${this.draft.side === "old" ? "삭제된 줄" : "새 소스"}`))
      .child(Textarea.new(this.comment).h(70).bg(c.editor).text_color(c.foreground))
      .child(h_flex().gap(6).justify_end()
        .when(Boolean(this.draft.id), element => element.child(button("delete-draft-comment", "코멘트 삭제", (_event, eventCx) => this.removeComment(this.draft.id, eventCx), { icon: icon("trash-2") })))
        .child(button("cancel-comment", "취소", (_event, eventCx) => { this.draft = null; this.comment.set_value(""); eventCx.notify(); })).child(button("save-comment", this.draft.id ? "코멘트 수정" : "코멘트 저장", (_event, eventCx) => this.saveComment(eventCx), { kind: "primary" }))));
    else if (this.section === "comments" && selectedComment) root.child(v_flex().h(140).flex_none().min_h(0).border_t(1).border_color(c.separator)
      .child(h_flex().flex_none().justify_end().gap(4).child(button("edit-selected-comment", "수정", (_event, eventCx) => this.editComment(selectedComment.id, eventCx)))
        .child(button("remove-selected-comment", "코멘트 삭제", (_event, eventCx) => this.removeComment(selectedComment.id, eventCx), { icon: icon("trash-2") })))
      .child(TextView.html("review-comment-detail", `<pre>${escape(`${selectedComment.path}:${selectedComment.start}–${selectedComment.end} · ${selectedComment.side === "old" ? "삭제된 줄" : "새 소스"}${this.commentStale(selectedComment) ? " · 현재 diff 밖/이전 범위 코멘트" : ""}\n${selectedComment.body}`)}</pre>`).size_full().selectable(true).scrollable(true).p(8)));
    root.child(h_flex().flex_none().min_h(36).items_center().gap(6).px(8).border_t(1).border_color(c.separator)
      .child(div().flex_1().min_w(0).truncate().text_color(c.secondary).child(`${this.repository?.root || this.context.root} · 코멘트 ${comments.length}개`))
      .when(agentChoices.length > 0, element => element.child(button("target", agentChoices.find(agent => agent.address === this.target)?.title || agentChoices[0].title || agentChoices[0].address, (_event, eventCx) => { const at = agentChoices.findIndex(agent => agent.address === this.target); this.target = agentChoices[(at + 1) % agentChoices.length].address; eventCx.notify(); }, { icon: icon("bot") })))
      .child(button("copy", "리뷰 복사", (_event, eventCx) => eventCx.write_to_clipboard(this.message()), { disabled: !comments.length }))
      .child(button("attach", "AI 입력에 첨부…", () => this.attach(), { disabled: !comments.length || !agentChoices.length, kind: "primary" })));
    return root;
  }
}


// The native tool window owns file navigation. The central editor owns diffs,
// comment drafts and LSP sessions; actions are delivered to that existing owner.
export class ReviewSidebar {
  init(props, cx) {
    this.context = props.context ?? currentProject(); this.section = "files";
    this.filesMenu = new MenuController(cx); this.commentsMenu = new MenuController(cx); this.focus = this.filesMenu.focus;
    this.fileView = shared("ade.review-file-view") === "tree" ? "tree" : "list";
    this.collapsedFolders = new Set();
  }
  refresh(cx, context = currentProject()) {
    if (projectKey(this.context) !== projectKey(context)) { this.collapsedFolders.clear(); this.treeRows = null; this.fileCursor = null; this.commentId = null; }
    this.context = context; cx.notify();
  }
  release() { for (const menu of [this.filesMenu, this.commentsMenu]) { menu.release(); menu.focus.release(); } }
  action(action, detail = {}) { run(`ade.review-action:${JSON.stringify({ project: projectKey(this.context), action, ...detail })}`); }
  toggleFolder(node, cx) {
    if (this.collapsedFolders.has(node.path)) this.collapsedFolders.delete(node.path); else this.collapsedFolders.add(node.path);
    this.treeRows = null; cx.notify();
  }
  render(cx) {
    const context = currentProject();
    if (projectKey(context) !== projectKey(this.context)) this.refresh(cx, context);
    const snapshot = object(shared("ade.review-files"))?.[projectKey(context)];
    const files = snapshot?.files ?? [], state = snapshot?.repository ? stateOf(snapshot.repository) : {}, comments = state.comments ?? [];
    if (!this.treeRows || this.treeVersion !== snapshot?.version || this.treeFileCount !== files.length) { this.treeVersion = snapshot?.version; this.treeFileCount = files.length; this.treeRows = reviewFileTree(files, this.collapsedFolders); }
    const rows = this.fileView === "tree" ? this.treeRows : files.map(file => ({ id: file.path, label: file.path, file }));
    const button = (id, label, action, options = {}) => adeButton(`review-sidebar-${id}`, label, action, options);
    return v_flex().size_full().min_w(0).min_h(0)
      .child(h_flex().flex_none().gap(4).p(5)
        .child(button("files", `파일 ${files.length}`, (_event, eventCx) => { this.section = "files"; this.focus = this.filesMenu.focus; this.action("section", { section: "files" }); eventCx.notify(); }, { selected: this.section === "files" }))
        .child(button("comments", `코멘트 ${comments.length}`, (_event, eventCx) => { this.section = "comments"; this.focus = this.commentsMenu.focus; this.action("section", { section: "comments" }); eventCx.notify(); }, { selected: this.section === "comments" })))
      .when(this.section === "files", element => element.child(h_flex().flex_none().gap(3).px(5).pb(5).children([["list", "목록", "files"], ["tree", "파일 트리", "folder"]].map(([mode, label, glyph]) => button(`view-${mode}`, label, (_event, eventCx) => {
        this.fileView = mode; this.fileCursor = state.selected; setShared("ade.review-file-view", mode); eventCx.notify();
      }, { icon: icon(glyph), selected: this.fileView === mode })))))
      .when(Boolean(snapshot?.loading || !snapshot), element => element.child(adeNote("리뷰 파일을 불러오는 중…")))
      .when(Boolean(snapshot?.error), element => element.child(adeNote(snapshot.error)))
      .when(files.length >= REVIEW_LIMIT, element => element.child(adeNote("파일 목록은 20,000개까지 표시합니다.")))
      .child(this.section === "files" ? adeManagedList("review-files", rows.map(node => ({ id: node.id, label: this.fileView === "tree" ? node.name : node.label,
        leading: this.fileView === "tree" ? () => node.folder ? icon(node.expanded ? "chevron-down" : "chevron-right") : div().w(16) : undefined,
        indent: (node.depth ?? 0) * 16, disabled: Boolean(snapshot?.loading),
        detail: node.folder ? "" : node.file.untracked ? "추적 안 됨" : `${node.file.status}${node.file.add === null ? " · 바이너리" : node.file.add !== undefined ? ` +${node.file.add} −${node.file.remove ?? 0}` : ""}`,
        icon: () => icon(node.folder ? "folder" : "file-text") })), this.filesMenu, cx, {
        selectedId: this.fileView === "tree" && this.fileCursor?.endsWith("/") ? this.fileCursor : state.selected,
        activateOnClick: true,
        onKeyDown: (event, eventCx, row) => {
          if (this.fileView !== "tree" || !["left", "right"].includes(event.keystroke)) return false;
          const node = rows.find(item => item.id === row?.id);
          if (!node?.folder) return false;
          eventCx.stop_propagation(); if ((event.keystroke === "right") !== node.expanded) this.toggleFolder(node, eventCx); return true;
        },
        onSelect: (id, _event, eventCx) => { this.fileCursor = id; if (!rows.find(row => row.id === id)?.folder) this.action("select", { path: id }); eventCx.notify(); },
        onActivate: (id, event, eventCx) => { const node = rows.find(row => row.id === id); if (node?.folder) this.toggleFolder(node, eventCx); else if (event) this.action("source"); },
      }) : adeManagedList("review-comments", comments.map(comment => ({ id: comment.id, label: `${comment.path}:${comment.start}${comment.end !== comment.start ? `–${comment.end}` : ""}`, detail: `${snapshot?.staleComments?.includes(comment.id) ? "이전 범위 · " : ""}${comment.body.split("\n")[0]}` })), this.commentsMenu, cx, {
        selectedId: this.commentId,
        onSelect: (id, _event, eventCx) => { this.commentId = id; this.action("show-comment", { id }); eventCx.notify(); },
        onActivate: id => this.action("edit-comment", { id }),
        rowActions: () => [{ id: "edit", label: "코멘트 수정", icon: () => icon("pencil"), action: id => this.action("edit-comment", { id }) }, { id: "remove", label: "코멘트 삭제", icon: () => icon("trash-2"), action: id => this.action("remove-comment", { id }) }],
      }));
  }
}

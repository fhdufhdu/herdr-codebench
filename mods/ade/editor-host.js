import { h_flex, v_flex } from "gpui-base";
import { shared, setShared } from "herdr";
import { adeUI, adeColors, adeTab, adeNote, TabViewport, uiTabStrip } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, projectKey, documentState } from "./workspace.js";
import { databaseDocumentState } from "./database-model.js";
import EditorSurface from "./text-editor.js";
import { DatabaseEditor } from "./database-editor.js";
import { ReviewView, openReview } from "./review.js";

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const mode = context => object(shared("ade.editor-mode"))[projectKey(context)] ?? "file";
const setMode = (context, value) => setShared("ade.editor-mode", { ...object(shared("ade.editor-mode")), [projectKey(context)]: value });
export class EditorHost {
  init(props, cx) {
    this.taskOwner = props.owner;
    this.context = props.context ?? currentProject(); this.alive = true; this.orders = new Map(); this.viewport = new TabViewport(); this.jobs = [];
    this.files = new EditorSurface(); this.database = new DatabaseEditor();
    this.files.init({ ...props, embedded: true, beforeAnalysis: () => this.review?.analysis?.closing }, cx); this.database.init({ ...props, embedded: true }, cx);
    this.focus = { focus: () => {
      if (this.selected()?.kind === "review") { this.review?.focus?.focus(); return; }
      const doc = this.active();
      if (doc?.state) doc.state.focus(); else if (doc?.input) doc.input.focus(); else (doc?.grid?.menu.focus ?? this.files.focus).focus();
    } };
    this.asyncCx = cx;
    this.jobTimer = cx.timer.every(25, taskCx => {
      if (!this.alive || !this.jobs.length) return;
      while (this.jobs.length) {
        try { this.jobs.shift()(taskCx); } catch (error) { this.files.workerFailed(error, taskCx); }
      }
    }, { owner: this.taskOwner });
    this.refresh(cx, this.context);
  }
  enqueue(job) { if (this.alive) this.jobs.push(job); }
  entries(context = this.context) {
    if (!context) return [];
    const scope = projectKey(context), databaseCurrent = projectKey(this.database.context) === scope, entries = [
      ...documentState(context).tabs.map(path => ({ key: `file:${path}`, kind: "file", path, project: scope,
        title: this.files.title(path, context), dirty: this.files.dirty(path, context) })),
      ...databaseDocumentState(context).tabs.map(tab => ({ key: `database:${tab.id}`, kind: "database", id: tab.id, spec: tab.spec, project: scope,
        title: (databaseCurrent ? this.database.title(tab.id) : "") || tab.title || (tab.spec.kind === "console" ? "SQL 콘솔" : tab.spec.kind === "ddl" ? "DDL" : tab.spec.table), dirty: databaseCurrent && this.database.dirty(tab.id) })),
      ...(object(shared("ade.review-open"))[scope] ? [{ key: "review", kind: "review", project: scope, title: projectKey(this.review?.context) === scope && this.review?.selected ? this.review.selected.split("/").pop() : "코드 리뷰", dirty: false }] : []),
    ];
    const previous = this.orders.get(scope) ?? [], keys = new Set(entries.map(entry => entry.key));
    const order = [...previous.filter(key => keys.has(key)), ...entries.map(entry => entry.key).filter(key => !previous.includes(key))];
    this.orders.set(scope, order);
    return order.map(key => entries.find(entry => entry.key === key));
  }
  selected(entries = this.entries()) {
    if (!this.context) return null;
    const currentMode = mode(this.context), file = documentState(this.context).active, database = databaseDocumentState(this.context).active;
    return entries.find(entry => entry.kind === currentMode && (entry.kind === "review" || (entry.kind === "file" ? entry.path === file : entry.id === database)))
      ?? entries.find(entry => entry.kind === currentMode) ?? entries.at(-1) ?? null;
  }
  active() { return this.selected()?.kind === "review" ? null : this.selected()?.kind === "database" ? projectKey(this.database.context) === projectKey(this.context) ? this.database.active() : null : this.files.active(); }
  activate(entry, cx) {
    if (!this.context || entry.project !== projectKey(currentProject()) || entry.project !== projectKey(this.context)) return;
    setMode(this.context, entry.kind);
    // Release review ownership before the file surface can schedule a new
    // session, even when native spawn callbacks run immediately.
    if (entry.kind !== "review") this.review?.setActive?.(false, cx);
    if (entry.kind === "file") this.files.activate(entry.path, cx, this.context);
    else if (entry.kind === "database") { if (projectKey(this.database.context) !== projectKey(this.context)) this.database.refresh(cx, this.context); this.database.activate(entry.id, cx); }
    this.refresh(cx); cx.notify();
  }
  reviewAction(request, cx) {
    if (request?.project !== projectKey(currentProject()) || request.project !== projectKey(this.context)) return;
    if (!this.review || projectKey(this.review.context) !== request.project) { openReview(this.context); this.refresh(cx); return; }
    openReview(this.context); this.review.setActive?.(true, cx);
    if (request.action === "select") this.review.selectFile(request.path, cx);
    else if (request.action === "section" && ["files", "comments"].includes(request.section)) this.review.section = request.section;
    else if (request.action === "show-comment") { this.review.section = "comments"; this.review.showComment(request.id, cx); }
    else if (request.action === "edit-comment") { this.review.section = "comments"; this.review.editComment(request.id, cx); }
    else if (request.action === "remove-comment") this.review.removeComment(request.id, cx);
    else if (request.action === "source") this.review.openSelectedSource();
    else if (request.action === "refresh") this.review.refresh(cx, this.context);
    this.review.setActive?.(mode(this.context) === "review", cx);
    this.signature = this.metadataSignature(this.context); cx.notify();
  }
  closeEntry(entry, cx) {
    if (!this.context || entry.project !== projectKey(currentProject())) return;
    this.activate(entry, cx);
    if (entry.kind === "review") {
      const close = eventCx => {
        if (entry.project !== projectKey(currentProject())) return;
        setShared("ade.review-open", { ...object(shared("ade.review-open")), [entry.project]: false }); setMode(this.context, "file");
        const next = this.selected(this.entries()); if (next) this.activate(next, eventCx ?? cx);
        (eventCx ?? cx).notify();
      };
      if (this.review?.requestClose) this.review.requestClose(close, cx); else close(cx);
      return;
    }
    const closed = entry.kind === "file" ? this.files.closePath(entry.path, cx, this.context) : this.database.closeDocument(entry.id, cx);
    if (closed) {
      const next = this.selected(this.entries());
      if (next) this.activate(next, cx);
    }
    cx.notify();
  }
  save(doc = this.active(), after, cx) {
    if (doc?.path && doc?.project) return this.files.save(doc, after, cx);
    // Database writes retain their explicit Apply boundary.
  }
  refresh(cx, context = currentProject()) {
    if (!this.alive) return;
    this.context = context;
    this.review?.setActive?.(mode(context) === "review", cx);
    this.files.refresh(cx, context); this.database.refresh(cx, context);
    if (object(shared("ade.review-open"))[projectKey(context)]) {
      if (!this.review) { this.review = new ReviewView(); this.review.init({ context, owner: this.taskOwner, beforeAnalysis: (path, eventCx) => this.files.awaitClosing(path, eventCx) }, cx); }
      else this.review.refresh(cx, context);
      this.review.setActive?.(mode(context) === "review", cx);
    }
    this.signature = this.metadataSignature(context);
  }
  metadataSignature(context) {
    return JSON.stringify([projectKey(context), documentState(context), databaseDocumentState(context), mode(context), object(shared("ade.review-open"))[projectKey(context)]]);
  }
  schedule(context) {
    const signature = this.metadataSignature(context);
    if (signature === this.signature) return;
    this.signature = signature;
    this.enqueue(taskCx => { if (this.alive && projectKey(currentProject()) === projectKey(context)) this.refresh(taskCx, context); });
  }
  release(cx) {
    if (!this.alive) return this.closing;
    this.alive = false; const cleanupCx = cx ?? this.asyncCx;
    this.jobTimer.cancel(); this.jobs.length = 0;
    this.closing = Promise.allSettled([this.files.release(cleanupCx), this.database.release(cleanupCx), this.review?.release(cleanupCx)]);
    this.asyncCx = null; return this.closing;
  }
  close(cx) { return this.release(cx); }
  render(cx) {
    this.context = currentProject(); this.schedule(this.context);
    const entries = this.entries(), selected = this.selected(entries), c = adeColors();
    const root = adeUI(v_flex()).id("ade-editor-host").size_full().min_w(0).min_h(0).bg(c.editor);
    if (!selected) return root.child(adeNote("Project에서 파일을, Database에서 테이블 또는 SQL 콘솔을 여세요."));
    root.child(h_flex().h(38).flex_none().min_w(0).items_center().border_b(1).border_color(c.separator)
      .child(uiTabStrip("ade-central-tabs", entries.map(entry => ({ id: entry.key,
        content: adeTab(`ade-central-${entry.key}`, `${entry.title}${entry.dirty ? " •" : ""}`, {
          icon: uiIcon(entry.kind === "review" ? "git-branch" : entry.kind === "file" ? this.files.icon?.(entry.path) ?? "file-text" : entry.spec.kind === "console" ? "code" : entry.spec.kind === "table" ? "table" : "file-text", 14), selected: entry.key === selected.key,
          onSelect: (_event, eventCx) => this.activate(entry, eventCx), closeIcon: uiIcon("x", 12), onClose: (_event, eventCx) => this.closeEntry(entry, eventCx),
        }),
      })), selected.key, this.viewport)));
    if (selected.kind === "database" && projectKey(this.database.context) !== projectKey(this.context)) return root.child(adeNote("데이터베이스 문서를 준비하는 중…"));
    return root.child(v_flex().flex_1().min_w(0).min_h(0).child(selected.kind === "review" ? this.review?.render(cx) ?? adeNote("코드 리뷰를 준비하는 중…") : selected.kind === "file" ? this.files.render(cx) : this.database.render(cx)));
  }
}

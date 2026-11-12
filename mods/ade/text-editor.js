import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { readTextFile, writeTextFile, window as appWindow, shared, setShared, openOverlay, run, notify } from "herdr";
import { ADE, adeUI, adeColors, adeSize, adeButton, adeTab, adeNote, adeCompletionPopup, MenuController } from "./idea-design.js";
import { uiIcon } from "./ui-icons.js";
import { currentProject, documentState, selectDocument, closeDocument, openDocument, projectKey } from "./workspace.js";
import { documentKey, isDirty, markdownFile, sourceHTML, externalSource } from "./editor-document.js";
import { CodeInput } from "./code-input.js";
import { LspSession } from "./lsp-session.js";
import { IDEA_TOKENS } from "./idea-tokens.js";
import { openEditorMenu } from "./editor-menu.js";
import { completionEdits, textEdits, lineCommentPrefix, completionBounds, completionCandidates } from "./editor-completion.js";
import { isHttp, httpEnvs, runHttp } from "./http-client.js";
import { analyzeHttp, httpCompletions } from "./http-analysis.js";
import { runConfiguration } from "./execution.js";
import { GutterNavigation } from "./gutter-navigation.js";
import { SQLAssist } from "./sql-assist.js";

const sqlFile = path => /\.sql$/i.test(path);

export function textOffset(text, line, column = 0) {
  const lines = text.split("\n"), at = Math.max(0, Math.min(lines.length - 1, Number(line) || 0));
  return lines.slice(0, at).reduce((offset, item) => offset + item.length + 1, 0) + Math.max(0, Math.min(lines[at].length, Number(column) || 0));
}
export function syntaxSpans(text, lines) {
  const palette = IDEA_TOKENS["herdr.ux"].syntax, result = [];
  let offset = 0;
  const source = text.split("\n");
  for (let line = 0; line < source.length; line++) {
    let column = 0;
    for (const [length, category] of lines?.[line] ?? []) {
      const size = Math.max(0, Math.min(source[line].length - column, Number(length) || 0));
      if (size && palette[category]) result.push({ from: offset + column, to: offset + column + size, color: palette[category] });
      column += size;
    }
    offset += source[line].length + 1;
  }
  return result;
}
export function markdownHeadings(text) {
  const result = [], lines = text.split("\n"); let fence = null, previous = null;
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line], marker = /^ {0,3}(`{3,}|~{3,})/.exec(value);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !value.slice(marker[0].length).trim()) fence = null;
      previous = null;
      continue;
    }
    if (marker) { fence = marker[1]; previous = null; continue; }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(value);
    if (heading) {
      const name = (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      if (name) result.push({ name, detail: `H${heading[1].length}`, kind: "heading", depth: heading[1].length - 1, line, col: value.indexOf("#") });
      previous = null;
    } else if (previous && /^ {0,3}(?:=+|-+)[ \t]*$/.test(value)) {
      const level = value.trim()[0] === "=" ? 1 : 2;
      result.push({ ...previous, detail: `H${level}`, kind: "heading", depth: level - 1 }); previous = null;
    } else previous = value.trim() && !/^(?: {4}|\t|\s*(?:[-+*]\s|\d+[.)]\s|>))/.test(value) ? { name: value.trim(), line, col: value.search(/\S/) } : null;
  }
  return result;
}
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const scoped = (key, project) => object(shared(key))?.[projectKey(project)];
const setScoped = (key, project, value) => setShared(key, { ...object(shared(key)), [projectKey(project)]: value });

// One retained CodeInput owns the document, selection, rendering and OS boundary.
export default class EditorSurface extends View {
  init(props, cx) {
    this.props = props;
    this.embedded = Boolean(props?.embedded);
    this.taskOwner = props?.owner;
    this.focus = cx.focus_handle();
    this.documents = new Map();
    this.histories = new Map();
    this.leaseClosings = new Map();
    this.jobs = [];
    this.alive = true;
    this.pending = null; this.navigationSequence = 0;
    // The timer is created while the native ADE owner is running. Promise
    // wakeups from a closing popup do not restore that native call frame.
    this.asyncCx = cx;
    this.jobTimer = cx.timer.every(25, taskCx => {
      if (!this.alive || !this.jobs.length) return;
      while (this.jobs.length) {
        try { this.jobs.shift()(taskCx); } catch (error) { this.workerFailed(error, taskCx); }
      }
    }, { owner: this.taskOwner });
  }
  spawn(cx, body) {
    try {
      return cx.spawn(async taskCx => {
        try { return await body(taskCx); } catch (error) { this.workerFailed(error, taskCx); }
      }, { owner: this.taskOwner });
    } catch (error) { this.workerFailed(error, cx); return null; }
  }
  workerFailed(error, cx) {
    this.workerError = String(error);
    try {
      const doc = this.active();
      if (doc?.state && this.selected(doc)) this.updateLsp(doc, { ...doc.lspState, revision: doc.state.revision,
        status: "error", error: this.workerError, symbolsStatus: "error", symbolsError: this.workerError,
        requestPhase: "worker-error", requestReason: "worker-job" }, cx);
      else cx.notify();
    } catch (_) { /* The local message remains renderable if the host is closing. */ }
  }
  after(cx, ms, body) { return cx.timer.after(ms, body, { owner: this.taskOwner }); }
  enqueue(job) {
    if (this.alive) this.jobs.push(job);
  }
  release(cx) {
    if (!this.alive) return this.closing;
    const cleanupCx = cx ?? this.asyncCx;
    const closing = [];
    const sessions = new Set([...this.leaseClosings.values()].map(record => record.session));
    for (const doc of this.documents.values()) {
      if (doc.lsp) sessions.add(doc.lsp);
      if (doc.retiringLsp) sessions.add(doc.retiringLsp);
      doc.completionMenu?.release(); doc.completionMenu?.focus.release(); doc.completionTimer?.cancel();
      doc.sqlAssist?.release(); doc.gutter?.release(); doc.state?.release();
    }
    for (const session of sessions) closing.push(cleanupCx ? session.close(cleanupCx) : Promise.reject(new Error("LSP 정리 작업 컨텍스트가 없습니다.")));
    this.alive = false;
    this.documents.clear();
    this.histories.clear();
    this.jobTimer.cancel(); this.jobs.length = 0;
    this.focus.release();
    this.asyncCx = null;
    this.closing = Promise.allSettled(closing);
    return this.closing;
  }
  close(cx) { return this.release(cx); }
  active() {
    const project = currentProject();
    const path = project && documentState(project).active;
    return project && path ? this.documents.get(documentKey(project, path)) : null;
  }
  document(path, project = currentProject()) { return this.documents.get(documentKey(project ?? {}, path)); }
  history(project) {
    const key = projectKey(project);
    if (!this.histories.has(key)) this.histories.set(key, { entries: [], index: -1, doc: null, pending: null });
    return this.histories.get(key);
  }
  position(doc) {
    const before = (doc.state?.value() ?? "").slice(0, doc.state?.selection()?.head ?? 0).split("\n");
    return { path: doc.path, line: before.length, column: before.at(-1).length + 1 };
  }
  remember(history, position) {
    const current = history.entries[history.index];
    if (current?.path === position.path && current.line === position.line && current.column === position.column) return;
    history.entries.splice(history.index + 1);
    history.entries.push({ ...position });
    if (history.entries.length > 100) history.entries.shift();
    history.index = history.entries.length - 1;
  }
  observeNavigation(doc) {
    const history = this.history(doc.project);
    if (history.pending) return history;
    const target = scoped("ade.navigation", doc.project);
    const arriving = target?.path === doc.path && target.at !== doc.navigationAt;
    // Loading/rendering an arriving document must not record its temporary
    // caret at the first line before the requested destination is applied.
    if (history.doc === doc && arriving) return history;
    if (history.doc && history.entries[history.index]?.path === history.doc.path) history.entries[history.index] = this.position(history.doc);
    if (history.doc !== doc) {
      this.remember(history, arriving ? { path: target.path, line: target.line ?? 1, column: target.column ?? 1 } : this.position(doc));
      history.doc = doc;
    }
    return history;
  }
  travel(direction, cx) {
    const doc = this.active();
    if (!doc || !this.selected(doc)) return;
    const history = this.observeNavigation(doc), index = history.index + direction;
    if (history.pending || index < 0 || index >= history.entries.length) return;
    history.index = index;
    const target = { ...history.entries[index], history: true, at: `${Date.now()}-${++this.navigationSequence}` };
    history.pending = target.at;
    setScoped("ade.navigation", doc.project, target);
    openDocument(target.path, doc.project);
    if (target.path === doc.path) this.consumeNavigation(doc, cx);
    cx.notify();
  }
  title(path, project = currentProject()) { return this.document(path, project)?.path.split(/[\\/]/).pop() ?? path.split(/[\\/]/).pop(); }
  dirty(path, project = currentProject()) { return isDirty(this.document(path, project)); }
  activate(path, cx, project = currentProject()) { this.select(project, path, cx); return this.document(path, project); }
  closePath(path, cx, project = currentProject()) {
    this.select(project, path, cx);
    const doc = this.document(path, project);
    if (doc) this.request(doc, "close", cx);
    return !documentState(project).tabs.includes(path);
  }
  refresh(cx, project = currentProject()) {
    if (!this.alive || !project) return;
    for (const path of documentState(project).tabs) this.ensure(project, path);
    this.retireInactive(cx);
    const doc = this.active(); if (doc?.state) { this.syncLsp(doc, cx); this.consumeNavigation(doc, cx); this.publishOutline(doc); }
  }
  owns(doc) { return this.alive && this.documents.get(doc.key) === doc; }
  selected(doc) { return this.owns(doc) && this.active() === doc && (!this.embedded || (scoped("ade.editor-mode", doc.project) ?? "file") === "file"); }
  ensure(project, path) {
    const key = documentKey(project, path);
    if (this.documents.has(key)) return this.documents.get(key);
    const sourceOnly = Boolean(scoped("ade.external-sources", project)?.[path]);
    const doc = { external: sourceOnly || externalSource(path, project.root), sourceOnly, key, project: { ...project }, path, loading: true, saved: null, state: null, error: "", saving: false, preview: false };
    this.documents.set(key, doc);
    this.enqueue(taskCx => { if (this.owns(doc)) { this.publishOutline(doc); this.load(doc, taskCx); } });
    return doc;
  }
  load(doc, context) {
    if (!this.owns(doc)) return;
    if (!context) { this.enqueue(taskCx => this.load(doc, taskCx)); return; }
    const generation = doc.loadGeneration = (doc.loadGeneration ?? 0) + 1;
    const current = () => this.owns(doc) && doc.loadGeneration === generation;
    doc.loading = true;
    doc.error = "";
    this.spawn(context, async cx => {
      try {
        const text = await readTextFile(doc.path, { on: doc.project.machine ?? null });
        if (!current()) return;
        if (text === null) throw new Error("파일이 없거나 읽을 수 없습니다.");
        // Native state is created in a task callback, never in render.
        if (doc.lsp) {
          try { await doc.lsp.close(cx); } catch (error) { doc.lspCloseError = String(error); }
          doc.lsp = null;
        }
        if (!current()) return;
        doc.completionMenu?.release(); doc.completionMenu?.focus.release();
        doc.sqlAssist?.release(); doc.gutter?.release(); doc.state?.release();
        doc.saved = text;
        doc.markdownRevision = null;
        doc.state = new CodeInput().init(text, cx, {
          readOnly: Boolean(doc.project.machine) || doc.external,
          onChange: (_text, _revision, eventCx) => { if (this.owns(doc)) { doc.completion = null; this.syncLsp(doc, eventCx); if (doc.sqlAssist) doc.sqlAssist.trigger(eventCx); else this.triggerCompletion(doc, eventCx); eventCx.notify(); } },
          onSelection: (selection, eventCx) => { if (this.owns(doc)) { if (doc.completion?.offset !== selection.head) doc.completion = null; doc.sqlAssist?.selection(selection, eventCx); this.syncLsp(doc, eventCx); eventCx?.notify(); } },
          onSave: eventCx => this.save(doc, undefined, eventCx),
          onNavigate: (request, eventCx) => this.queueSemantic(doc, { ...request, fallbackReferences: true, presentation: "menu" }, eventCx),
          onContextMenu: (request, eventCx) => this.contextMenu(doc, request, eventCx),
          onComplete: (request, eventCx) => doc.sqlAssist ? doc.sqlAssist.request(request, eventCx) : this.complete(doc, request, eventCx),
          onFormat: (request, eventCx) => this.formatDocument(doc, request, eventCx),
          onCommand: (command, eventCx) => doc.sqlAssist ? doc.sqlAssist.command(command, eventCx) : this.completionCommand(doc, command, eventCx),
          onToggleComment: (request, eventCx) => this.toggleComment(doc, request, eventCx),
          onGutter: (marker, eventCx) => this.gutterNavigate(doc, marker, eventCx),
        });
        doc.sqlAssist = sqlFile(doc.path) && !doc.project.machine && !doc.external ? new SQLAssist(cx, {
          input: doc.state, owner: this.taskOwner, current: () => this.selected(doc),
        }) : null;
        doc.gutter = new GutterNavigation({ path: doc.path, context: doc.project, owner: this.taskOwner, onUpdate: (markers, eventCx) => {
          if (!this.owns(doc) || !doc.state) return;
          doc.state.gutterMarkers = new Map();
          for (const marker of markers) if (!doc.state.gutterMarkers.has(marker.line)) doc.state.gutterMarkers.set(marker.line, marker);
          if (this.selected(doc)) eventCx.notify();
        } });
        doc.completionMenu = new MenuController(cx);
        this.syncLsp(doc, cx);
        this.consumeNavigation(doc, cx);
        if (this.selected(doc) && !doc.project.machine) doc.state.focus();
      } catch (error) {
        if (current()) {
          doc.error = `불러오기 실패: ${String(error.message ?? error)}`;
          const history = this.history(doc.project);
          if (this.selected(doc)) { history.pending = null; history.doc = doc; }
        }
      } finally {
        if (current()) { doc.loading = false; cx.notify(); }
      }
    });
  }
  save(doc, after, context) {
    if (!context) { this.enqueue(taskCx => this.save(doc, after, taskCx)); return; }
    if (!this.owns(doc) || doc.loading || doc.saving || !doc.state || doc.project.machine || doc.external) return;
    const text = doc.state.value();
    this.syncLsp(doc, context);
    if (text === doc.saved) { after?.(context); return; }
    const expected = doc.saved;
    doc.saving = true;
    doc.error = "";
    context.notify();
    this.spawn(context, async cx => {
      try {
        await writeTextFile(doc.path, text, expected);
        if (!this.owns(doc)) return;
        // A later native edit remains dirty even when this snapshot saved.
        doc.saved = text;
        if (!isDirty(doc) && this.selected(doc)) after?.(cx);
      } catch (error) {
        if (this.owns(doc)) doc.error = `저장 실패: ${String(error.message ?? error)} · 외부 변경 여부를 확인하세요.`;
      } finally {
        if (this.owns(doc)) { doc.saving = false; cx.notify(); }
      }
    });
  }
  syncLsp(doc, cx) {
    if (!this.owns(doc) || !doc.state) return;
    if (!cx) { this.enqueue(taskCx => this.syncLsp(doc, taskCx)); return; }
    if (this.selected(doc)) this.retireInactive(cx);
    if (this.selected(doc)) doc.gutter?.sync(doc.state.value(), doc.state.revision, cx);
    if (markdownFile(doc.path) && doc.markdownRevision !== doc.state.revision) {
      doc.markdownRevision = doc.state.revision;
      doc.lspState = { ...doc.lspState, revision: doc.state.revision, symbols: markdownHeadings(doc.state.value()), symbolsStatus: "ready", symbolsError: null };
      this.publishOutline(doc);
    }
    if (isHttp(doc.path) || sqlFile(doc.path)) {
      if (doc.markdownRevision === doc.state.revision) return;
      doc.markdownRevision = doc.state.revision;
      const http = isHttp(doc.path) ? analyzeHttp(doc.state.value()) : null;
      this.updateLsp(doc, { status: "unsupported", error: null, revision: doc.state.revision, diagnostics: http?.diagnostics ?? [], tokens: http?.tokens ?? [], diagnosticsRevision: doc.state.revision, tokensRevision: doc.state.revision, confidence: null,
        symbols: http?.symbols ?? [], symbolsStatus: "ready", symbolsError: null }, cx);
      return;
    }
    if (doc.project.machine) return;
    if (!this.selected(doc)) return;
    if (!doc.lsp) { this.startLsp(doc, cx); return; }
    doc.lsp.setActive?.(this.selected(doc), cx);
    doc.lsp.sync({ project: doc.project, path: doc.path, text: doc.state.value(), revision: doc.state.revision, library: doc.sourceOnly, selection: doc.state.selection() }, cx);
  }
  retireInactive(cx) {
    for (const item of this.documents.values()) {
      if (this.selected(item)) item.lsp?.setActive?.(true, cx);
      else this.retireLsp(item, cx);
    }
  }
  retireLsp(doc, cx) {
    if (!doc.lsp) return;
    const session = doc.lsp; doc.lsp = null; doc.retiringLsp = session; doc.lspStarting = false; doc.analysisEpoch = (doc.analysisEpoch ?? 0) + 1;
    doc.completion = null; doc.completionTimer?.cancel();
    session.setActive?.(false, cx);
    const record = { session, doc, done: false };
    this.leaseClosings.set(doc.path, record);
    record.promise = session.close(cx).then(() => {
      record.done = true;
      if (doc.retiringLsp === session) doc.retiringLsp = null;
      if (this.leaseClosings.get(doc.path) === record) this.leaseClosings.delete(doc.path);
      return true;
    }, error => { record.error = error; return false; });
  }
  async awaitClosing(path, cx) {
    for (;;) {
      const prior = this.leaseClosings.get(path);
      if (!prior) return true;
      if (await prior.promise) continue;
      try {
        await prior.session.close(cx);
        prior.done = true;
        if (prior.doc?.retiringLsp === prior.session) prior.doc.retiringLsp = null;
        if (this.leaseClosings.get(path) === prior) this.leaseClosings.delete(path);
      } catch (error) { prior.error = error; return false; }
    }
  }
  startLsp(doc, cx) {
    if (!this.selected(doc) || doc.lsp || doc.lspStarting || doc.project.machine || sqlFile(doc.path) || isHttp(doc.path)) return;
    doc.lspStarting = true; const epoch = doc.analysisEpoch = (doc.analysisEpoch ?? 0) + 1;
    this.updateLsp(doc, { status: "pending", revision: doc.state.revision, error: null, diagnostics: [], tokens: [], symbols: [], symbolsStatus: "pending", symbolsError: null }, cx);
    this.spawn(cx, async taskCx => {
      try {
        await this.props.beforeAnalysis?.();
        if (!await this.awaitClosing(doc.path, taskCx)) throw this.leaseClosings.get(doc.path)?.error ?? new Error("이전 분석 세션을 정리하지 못했습니다.");
        if (!this.selected(doc) || doc.analysisEpoch !== epoch) return;
        const session = new LspSession(); doc.lsp = session;
        session.init(taskCx, { owner: this.taskOwner, onUpdate: (state, eventCx) => { if (doc.lsp === session) this.updateLsp(doc, state, eventCx); }, onNavigate: (location, eventCx) => { if (doc.lsp === session) this.navigate(doc, location, eventCx); } });
        this.syncLsp(doc, taskCx);
      } catch (error) {
        if (this.selected(doc) && doc.analysisEpoch === epoch) {
          const message = error?.code === "owner_conflict" ? "이 파일의 이전 분석 세션을 정리하지 못했습니다. 다른 편집기나 리뷰를 닫은 뒤 분석을 다시 확인하세요." : String(error);
          doc.lspState = { status: "error", revision: doc.state.revision, error: message, symbolsStatus: "error", symbolsError: message, symbols: [] }; this.publishOutline(doc);
        }
      } finally { if (doc.analysisEpoch === epoch) doc.lspStarting = false; if (this.selected(doc)) taskCx.notify(); }
    });
  }
  updateLsp(doc, state, cx) {
    if (!this.owns(doc) || !doc.state || state.revision !== doc.state.revision) return;
    if (markdownFile(doc.path) && (!state.symbols?.length || state.symbolsStatus !== "ready")) state = { ...state, symbols: markdownHeadings(doc.state.value()), symbolsStatus: "ready", symbolsError: null };
    doc.lspState = state;
    const text = doc.state.value();
    // Pending state retains old wire arrays only as provisional metadata.
    // CodeInput already mapped its absolute spans through the local edit.
    if (state.tokensRevision === doc.state.revision && doc.appliedTokens !== state.tokens) {
      doc.state.tokens = syntaxSpans(text, state.tokens); doc.appliedTokens = state.tokens;
    }
    if (state.diagnosticsRevision === doc.state.revision && doc.appliedDiagnostics !== state.diagnostics) {
      doc.state.diagnostics = (state.diagnostics ?? []).map(item => ({
      from: textOffset(text, item.line ?? item.range?.start?.line, item.col ?? item.range?.start?.character),
      to: textOffset(text, item.end_line ?? item.range?.end?.line ?? item.line, item.end_col ?? item.range?.end?.character ?? item.col),
      severity: item.severity ?? 1, message: item.message ?? "",
      }));
      doc.appliedDiagnostics = state.diagnostics;
    }
    this.publishOutline(doc);
    cx?.notify();
  }
  publishOutline(doc) {
    if (!this.selected(doc)) return;
    const state = doc.lspState ?? { status: doc.loading ? "loading" : "idle", revision: doc.state?.revision ?? null };
    const value = { path: doc.path, revision: state.revision, status: state.symbolsStatus ?? state.status,
      error: state.symbolsError || state.error || null, lspStatus: state.status, lspError: state.error || null, diagnosticCount: (state.diagnostics ?? []).length, analysis: state.requestPhase ? { kind: state.kind, phase: state.requestPhase, query: state.requestQuery, reason: state.requestReason, startedAt: state.requestStartedAt } : null, items: (state.symbols ?? []).slice(0, 2000).map(item => ({
        name: item.name, detail: item.detail, kind: item.kind, depth: item.depth ?? 0, line: item.line, col: item.col,
      })) };
    const signature = JSON.stringify(value);
    if (signature !== JSON.stringify(scoped("ade.outline", doc.project))) setScoped("ade.outline", doc.project, value);
  }
  navigate(doc, location, cx) {
    if (!this.selected(doc) || !location?.path ) return;
    this.observeNavigation(doc);
    const target = { path: location.path, line: (location.line ?? 0) + 1, column: (location.col ?? 0) + 1,
      at: `${Date.now()}-${++this.navigationSequence}` };
    setScoped("ade.navigation", doc.project, target);
    if (location.external) {
      const sources = scoped("ade.external-sources", doc.project) ?? {}, tabs = documentState(doc.project).tabs;
      setScoped("ade.external-sources", doc.project, Object.fromEntries([...tabs.filter(path => sources[path]), location.path].map(path => [path, true])));
    }
    openDocument(location.path, doc.project);
    if (location.path === doc.path) this.consumeNavigation(doc, cx);
    cx.notify();
  }
  scheduleNavigation(doc) {
    const target = scoped("ade.navigation", doc.project);
    if (target?.path === doc.path && target.at !== doc.navigationAt && target.at !== doc.queuedNavigationAt) {
      doc.queuedNavigationAt = target.at;
      this.enqueue(taskCx => { doc.queuedNavigationAt = null; if (this.selected(doc)) this.consumeNavigation(doc, taskCx); });
    }
    if (this.outlineDoc !== doc.key) {
      this.outlineDoc = doc.key;
      this.enqueue(() => this.publishOutline(doc));
    }
    this.scheduleAnalysis(doc);
    this.scheduleEditorRequest(doc);
  }
  scheduleAnalysis(doc) {
    const request = scoped("ade.analysis-request", doc.project);
    if (!this.selected(doc) || !doc.state || request?.path !== doc.path || request.at == null || request.at === doc.analysisAt) return;
    doc.analysisPending = request.at;
    if (doc.analysisQueued) return;
    doc.analysisQueued = true;
    this.enqueue(taskCx => {
      doc.analysisQueued = false;
      const latest = scoped("ade.analysis-request", doc.project);
      if (latest?.path !== doc.path || latest.at !== doc.analysisPending || latest.at === doc.analysisAt) return;
      doc.analysisAt = latest.at; doc.analysisPending = null;
      if (this.selected(doc)) this.retryAnalysis(doc, taskCx);
    });
  }
  retryAnalysis(doc, cx) {
    if (!this.selected(doc) || !doc.state) return false;
    if (isHttp(doc.path) || sqlFile(doc.path)) {
      doc.markdownRevision = null; this.syncLsp(doc, cx); return true;
    }
    if (markdownFile(doc.path)) { doc.markdownRevision = null; this.syncLsp(doc, cx); }
    if (!doc.lsp) { this.startLsp(doc, cx); return true; }
    this.syncLsp(doc, cx);
    this.spawn(cx, async taskCx => {
      if (!this.selected(doc)) return;
      if (doc.lsp.retry) await doc.lsp.retry(taskCx); else await doc.lsp.flush(taskCx);
    });
    return true;
  }
  consumeNavigation(doc, cx) {
    const target = scoped("ade.navigation", doc.project);
    if (!this.selected(doc) || !doc.state || target?.path !== doc.path || target.at === doc.navigationAt) return;
    const history = this.observeNavigation(doc);
    if (target.history && history.pending === target.at) history.pending = null;
    else { history.pending = null; this.remember(history, { path: target.path, line: target.line ?? 1, column: target.column ?? 1 }); }
    history.doc = doc;
    doc.navigationAt = target.at;
    const offset = textOffset(doc.state.value(), (target.line ?? 1) - 1, (target.column ?? 1) - 1);
    doc.preview = false;
    doc.state.setSelection({ anchor: offset, head: offset }, cx);
    if (!doc.project.machine) doc.state.focus();
  }
  semantic(doc, kind, cx) {
    return this.queueSemantic(doc, { kind, presentation: "panel" }, cx);
  }
  services(doc, view, extra = {}) {
    if (!this.selected(doc) || !doc.state || doc.loading || doc.project.machine) return;
    openOverlay({ mod: "ade", kind: "dialog", frame: "none", width: 860, height: 600,
      props: { view, context: doc.project, path: doc.path, text: doc.state.value(), revision: doc.state.revision, ...extra } });
  }
  gutterNavigate(doc, marker, cx) {
    if (!this.selected(doc) || !doc.state || !marker || !doc.gutter?.markers.includes(marker)) return;
    if (marker.kind === "http") { this.services(doc, "http-requests", { requestIndex: marker.requestIndex }); return; }
    const revision = doc.state.revision, offset = textOffset(doc.state.value(), marker.line, marker.col);
    if (!marker.kind.startsWith("spring")) { this.queueSemantic(doc, { kind: marker.kind, offset, revision, presentation: "menu" }, cx); return; }
    this.spawn(cx, async taskCx => {
      try {
        const locations = await doc.gutter.resolve(marker, taskCx);
        if (!locations || !this.selected(doc) || doc.state.revision !== revision) return;
        if (locations.length === 1) this.navigate(doc, locations[0], taskCx);
        else if (locations.length) openEditorMenu(doc.project, { path: doc.path, revision, offset }, { mode: "locations", locations });
        else notify({ title: "Spring 탐색", body: "이동할 위치가 없습니다.", level: "info" });
      } catch (error) { if (this.selected(doc)) notify({ title: "Spring 탐색", body: String(error), level: "error" }); }
    });
  }
  executeHttp(doc, request, cx) {
    if (!this.selected(doc) || !doc.state || doc.external || doc.project.machine || !isHttp(doc.path)) return false;
    if (request.revision !== doc.state.revision) { doc.lspState = { ...doc.lspState, message: "요청 원문이 변경되었습니다. 실행할 요청을 다시 선택하세요." }; cx.notify(); return false; }
    const text = doc.state.value();
    this.spawn(cx, async taskCx => {
      try {
        const envs = await httpEnvs(doc.path, doc.project.root);
        if (request.environment != null && !envs.names.includes(request.environment)) throw new Error("HTTP 환경 설정이 바뀌었습니다. 다시 선택하세요.");
        if (!this.selected(doc) || doc.state.revision !== request.revision) return;
        await runHttp(doc.path, text.split("\n"), envs, request.request, null, {
          environment: request.environment, notify,
          launch: config => new Promise((resolve, reject) => this.enqueue(ownerCx => {
            try {
              if (!this.selected(doc) || doc.state.revision !== request.revision) throw new Error("실행 전 문서가 바뀌었습니다. 요청을 다시 선택하세요.");
              const label = `${doc.path.split("/").pop()}${request.request ? `:${request.request.line + 1}` : " · 전체"}`;
              runConfiguration(doc.project, { ...config, name: `HTTP · ${label}`, cwd: config.folder }, ownerCx);
              run("ade.executions-changed"); resolve();
            } catch (error) { reject(error); }
          })),
        });
      } catch (error) { if (this.owns(doc)) { doc.lspState = { ...doc.lspState, error: String(error) }; taskCx.notify(); } }
    });
    return true;
  }
  contextMenu(doc, request, _cx) {
    if (!this.selected(doc) || !doc.state || request.revision !== doc.state.revision || !Number.isInteger(request.offset) || request.offset < 0 || request.offset > doc.state.value().length) return;
    openEditorMenu(doc.project, { path: doc.path, revision: request.revision, offset: request.offset, position: request.position }, {
      available: Boolean(doc.lsp) && !doc.project.machine,
      reason: doc.lsp ? "" : sqlFile(doc.path) ? "SQL 테이블·컬럼 추천은 연결된 DB 콘솔에서 제공합니다."
        : doc.project.machine ? "원격 파일은 로컬 언어 서버 탐색을 지원하지 않습니다." : doc.lspState?.error || "분석 세션을 준비하는 중입니다. 잠시 뒤 다시 시도하세요.",
    });
  }
  scheduleEditorRequest(doc) {
    const request = scoped("ade.editor-request", doc.project);
    if (!this.selected(doc) || request?.path !== doc.path || request.at == null || request.at === doc.editorRequestAt) return;
    doc.editorPending = request.at;
    if (doc.editorRequestQueued) return;
    doc.editorRequestQueued = true;
    this.enqueue(taskCx => {
      doc.editorRequestQueued = false;
      const latest = scoped("ade.editor-request", doc.project);
      if (latest?.path !== doc.path || latest.at !== doc.editorPending || latest.at === doc.editorRequestAt) return;
      doc.editorRequestAt = latest.at; doc.editorPending = null;
      this.queueSemantic(doc, { ...latest, presentation: "menu" }, taskCx);
    });
  }
  queueSemantic(doc, request, cx) {
    if (request.kind === "http-run") return this.executeHttp(doc, request, cx);
    const kinds = ["hover", "definition", "references", "implementation", "super", "type-definition", "definition-locations", "reference-files", "navigate"];
    if (!this.selected(doc) || !doc.state || !kinds.includes(request.kind)) return false;
    const descriptor = { ...request, revision: request.revision ?? doc.state.revision, offset: request.offset ?? doc.state.selection()?.head };
    if (descriptor.revision !== doc.state.revision || !Number.isInteger(descriptor.offset) || descriptor.offset < 0 || descriptor.offset > doc.state.value().length) return false;
    if (descriptor.kind !== "navigate" && (!doc.lsp || doc.project.machine)) return false;
    doc.state.setSelection({ anchor: descriptor.offset, head: descriptor.offset }, cx);
    const current = () => this.selected(doc) && doc.state.revision === descriptor.revision && doc.state.selection()?.head === descriptor.offset;
    this.enqueue(taskCx => {
      if (!current()) return;
      if (descriptor.kind === "navigate") { this.navigate(doc, descriptor.location, taskCx); return; }
      this.syncLsp(doc, taskCx);
      this.spawn(taskCx, async navigationCx => {
        if (!current()) return;
        const kind = descriptor.kind === "definition-locations" ? "definition" : descriptor.kind === "reference-files" ? "references" : descriptor.kind;
        let result = await doc.lsp.request(kind, navigationCx, { navigate: descriptor.kind !== "definition-locations" });
        if (!current() || !result) return;
        if (kind === "definition" && result.empty && descriptor.fallbackReferences) result = await doc.lsp.request("references", navigationCx);
        if (!current() || !result?.locations?.length) return;
        const explicitList = ["definition-locations", "reference-files"].includes(descriptor.kind);
        if (explicitList || descriptor.presentation === "menu" && (result.kind === "references" || result.locations.length > 1 || result.locations[0]?.external)) {
          openEditorMenu(doc.project, { path: doc.path, revision: descriptor.revision, offset: descriptor.offset, position: descriptor.position }, {
            mode: descriptor.kind === "reference-files" ? "reference-files" : "locations", locations: result.locations,
          });
        }
      });
    });
    return true;
  }
  editCurrent(doc, revision, offset) {
    return this.selected(doc) && doc.state?.revision === revision && (offset == null || doc.state.selection()?.head === offset);
  }
  complete(doc, request, cx) {
    if (isHttp(doc.path) && this.editCurrent(doc, request.revision, request.offset) && !doc.project.machine && !doc.external) {
      const items = httpCompletions(doc.state.value(), request.offset);
      doc.completion = items.length ? { ...request, items, session: doc.lsp, resolve: false, value: {} } : null;
      doc.completionSelected = items.length ? "0" : null;
      doc.completionMenu.at = items.length ? 0 : -1; doc.completionMenu.ensureVisible(); cx.notify(); return;
    }
    if (!doc.lsp || !this.editCurrent(doc, request.revision, request.offset) || doc.project.machine || doc.external) return;
    this.syncLsp(doc, cx); doc.completion = null;
    this.enqueue(taskCx => this.spawn(taskCx, async completionCx => {
      if (!this.editCurrent(doc, request.revision, request.offset)) return;
      const session = doc.lsp; if (!session) return;
      const reply = await session.editorRequest("completion", completionCx);
      if (!reply || doc.lsp !== session || !this.editCurrent(doc, reply.revision, reply.offset)) return;
      const items = Array.isArray(reply.value?.items) ? completionCandidates(doc.state.value(), reply.offset, reply.value.items) : [];
      doc.completionTriggers = (reply.value?.trigger_characters ?? []).filter(value => typeof value === "string" && value.length <= 4);
      if (!items.length) { doc.lspState = { ...doc.lspState, message: "자동완성 후보가 없습니다." }; completionCx.notify(); return; }
      doc.completion = { ...reply, items, session, resolve: Boolean(reply.value.resolve_supported) };
      const at = items.findIndex(item => !item.disabled_reason); doc.completionSelected = at >= 0 ? String(at) : null;
      doc.completionMenu.at = at; doc.completionMenu.ensureVisible(); completionCx.notify();
    }));
  }
  triggerCompletion(doc, cx) {
    doc.completionTimer?.cancel();
    if (!this.selected(doc) || !isHttp(doc.path) && (!doc.lsp || ["error", "unsupported"].includes(doc.lspState?.status)) || doc.suppressCompletion || doc.state.hasPendingText || doc.state.selection().start !== doc.state.selection().end) return;
    const head = doc.state.selection().head, before = doc.state.value().slice(0, head);
    if (!/[\p{L}\p{N}_$]$/u.test(before) && !(doc.completionTriggers ?? [".", ":", "<", "\"", "/", ...(isHttp(doc.path) ? ["{", " "] : [])]).some(trigger => trigger && before.endsWith(trigger))) return;
    const request = { offset: head, revision: doc.state.revision };
    doc.completionTimer = this.after(cx, 180, taskCx => { doc.completionTimer = null; this.complete(doc, request, taskCx); });
  }
  acceptCompletion(doc, id, cx) {
    const completion = doc.completion, item = completion?.items[Number(id)];
    if (!completion || id == null || !item || item.disabled_reason || !this.editCurrent(doc, completion.revision, completion.offset)) return false;
    if (completion.accepting) return true;
    completion.accepting = true;
    this.spawn(cx, async taskCx => {
      try {
        let chosen = item;
        if (completion.resolve) {
          const reply = await completion.session.editorRequest("completion_resolve", taskCx, { completion_item: item.item });
          if (!reply) return; chosen = reply.value;
        }
        if (doc.completion !== completion || doc.lsp !== completion.session || !this.editCurrent(doc, completion.revision, completion.offset)) return;
        const change = completionEdits(doc.state.value(), chosen, completion.offset);
        doc.suppressCompletion = true;
        try { doc.state.applyEdits(change.edits, taskCx, { expectedRevision: completion.revision, selection: change.selection }); }
        finally { doc.suppressCompletion = false; }
        doc.completion = null; doc.state.focus();
      } catch (error) { if (this.selected(doc)) doc.lspState = { ...doc.lspState, message: String(error) }; }
      finally { completion.accepting = false; if (this.selected(doc)) taskCx.notify(); }
    });
    return true;
  }
  completionCommand(doc, command, cx) {
    const completion = doc.completion;
    if (!completion || !this.editCurrent(doc, completion.revision, completion.offset)) return false;
    if (command === "escape") { doc.completion = null; cx.notify(); return true; }
    if (command === "newline" || command === "tab") return this.acceptCompletion(doc, doc.completionSelected, cx);
    if (!["up", "down", "pageup", "pagedown"].includes(command)) return false;
    const rows = completion.items.map((item, index) => ({ id: String(index), label: item.label, disabled: Boolean(item.disabled_reason) }));
    doc.completionMenu.key({ keystroke: command }, cx, rows, { closeOnActivate: false });
    doc.completionSelected = rows[doc.completionMenu.at]?.id; cx.notify(); return true;
  }
  formatDocument(doc, request, cx) {
    if (!doc.lsp || !this.editCurrent(doc, request.revision) || doc.project.machine || doc.external) return;
    this.syncLsp(doc, cx); doc.completion = null;
    this.enqueue(taskCx => this.spawn(taskCx, async formatCx => {
      const session = doc.lsp;
      if (!session || !this.editCurrent(doc, request.revision)) return;
      const reply = await session.editorRequest("formatting", formatCx, { tab_size: 4, insert_spaces: true });
      if (!reply || doc.lsp !== session || !this.editCurrent(doc, reply.revision)) return;
      try { doc.state.applyEdits(textEdits(doc.state.value(), reply.value.edits), formatCx, { expectedRevision: reply.revision }); }
      catch (error) { doc.lspState = { ...doc.lspState, message: String(error) }; formatCx.notify(); }
    }));
  }
  toggleComment(doc, request, cx) {
    if (!this.editCurrent(doc, request.revision) || doc.project.machine || doc.external) return;
    const prefix = lineCommentPrefix(doc.path);
    if (!prefix) { doc.lspState = { ...doc.lspState, message: "이 파일의 줄 주석 형식은 지원하지 않습니다." }; cx.notify(); return; }
    try { doc.state.toggleLineComment(prefix, cx, { expectedRevision: request.revision }); }
    catch (error) { doc.lspState = { ...doc.lspState, message: String(error) }; cx.notify(); }
  }
  completionPanel(doc, cx) {
    if (doc.sqlAssist) return doc.sqlAssist.render(cx);
    const completion = doc.completion;
    if (!completion || !this.editCurrent(doc, completion.revision, completion.offset)) return div().h(0);
    const bounds = completionBounds(doc.state.completionViewport ?? doc.state.viewport, completion.items.length, Math.max(ADE.rowHeight, adeSize() + 12));
    return { bounds, element: adeCompletionPopup("ade-completion-popup", completion.items.map((item, index) => ({ id: String(index), label: item.label || "지원되지 않는 후보", detail: item.disabled_reason || item.detail, disabled: Boolean(item.disabled_reason) || completion.accepting })), doc.completionMenu, cx, {
        bounds, title: `자동완성 · Enter/Tab 적용 · Esc 닫기${completion.value.incomplete ? " · 일부 후보" : ""}`,
        selectedId: doc.completionSelected, activateOnClick: true,
        onSelect: (id, _event, eventCx) => { doc.completionSelected = id; eventCx.notify(); }, onActivate: (id, _event, eventCx) => this.acceptCompletion(doc, id, eventCx),
        onClose: (_event, eventCx) => { doc.completion = null; doc.state.focus(); eventCx.notify(); },
      }) };
  }
  lspInfo(doc, cx) {
    const markdown = doc.lspState?.hover?.markdown;
    if (!markdown) return div().h(0);
    const c = adeColors();
    return v_flex().id("ade-editor-quick-info").h(180).flex_none().min_h(0).border_t(1).border_color(c.separator).bg(c.surface)
      .child(h_flex().h(32).flex_none().items_center().px(10).child(div().flex_1().child("빠른 정보"))
        .child(adeButton("ade-info-close", null, (_event, eventCx) => {
          doc.lspState = { ...doc.lspState, hover: null }; doc.lsp?.publish?.({ hover: null }, eventCx); eventCx.notify();
        }, { icon: uiIcon("x", 14), square: true, tip: "빠른 정보 닫기" })))
      .child(TextView.markdown(`ade-hover-${doc.key}`, markdown).selectable(true).scrollable(true).flex_1().min_h(0).p(10));
  }
  select(project, path, cx) {
    if (documentKey(currentProject() ?? {}, path) !== documentKey(project, path) || !documentState(project).tabs.includes(path)) return;
    this.pending = null;
    selectDocument(path, project);
    const doc = this.ensure(project, path);
    this.syncLsp(doc, cx);
    this.publishOutline(doc); this.consumeNavigation(doc, cx);
    if (doc.state && !doc.preview && !doc.project.machine) doc.state.focus();
    cx.notify();
  }
  remove(doc, cx) {
    if (!this.selected(doc) || doc.saving) return;
    const history = this.observeNavigation(doc);
    history.doc = null;
    closeDocument(doc.path, doc.project);
    this.documents.delete(doc.key);
    this.retireLsp(doc, cx);
    doc.completionMenu?.release(); doc.completionMenu?.focus.release(); doc.completionTimer?.cancel();
    doc.sqlAssist?.release(); doc.gutter?.release(); doc.state?.release();
    this.pending = null;
    const next = this.active();
    if (next?.state && !next.preview && !next.project.machine) next.state.focus();
    if (next) this.publishOutline(next);
    else setScoped("ade.outline", doc.project, { path: null, revision: null, status: "idle", error: null, items: [] });
    cx.notify();
  }
  request(doc, action, cx) {
    if (!this.selected(doc) || doc.saving) return;
    if (isDirty(doc)) this.pending = { doc, action };
    else if (action === "close") this.remove(doc, cx);
    else this.load(doc, cx);
    cx.notify();
  }
  togglePreview(doc, cx) {
    if (!this.selected(doc) || !doc.state || !markdownFile(doc.path)) return;
    doc.preview = !doc.preview;
    if (!doc.preview && !doc.project.machine) doc.state.focus();
    cx.notify();
  }
  key(event, cx) {
    const doc = this.active();
    if (!doc) return;
    const primary = appWindow()?.platform === "macos" ? "cmd" : "ctrl";
    if (event.keystroke === `${primary}-s`) {
      cx.stop_propagation();
      this.save(doc, undefined, cx);
    }
    // CodeInput's scoped actions own editing keys and leave IME preedit native.
  }
  render(cx) {
    const project = currentProject(), c = adeColors();
    const shell = adeUI(v_flex()).id("ade-editor").size_full().min_w(0).min_h(0).relative().bg(c.editor)
      .track_focus(this.focus).on_key_down((event, eventCx) => this.key(event, eventCx));
    if (this.workerError) shell.child(adeNote(`편집 작업 오류: ${this.workerError}`));
    if (!project) return shell.child(adeNote("프로젝트를 선택하면 파일을 열 수 있습니다."));
    const session = documentState(project);
    const docs = session.tabs.map(path => this.ensure(project, path));
    const doc = docs.find(item => item.path === session.active);
    const history = doc ? this.observeNavigation(doc) : this.history(project);
    if (docs.length && !this.embedded) shell.child(h_flex().flex_none().min_w(0).overflow_x_scroll().bg(c.surface).border_b(1).border_color(c.separator)
      .children(docs.map(item => adeTab(`ade-doc-${item.key}`, `${item.path.split("/").pop()}${isDirty(item) ? " •" : ""}`, {
        selected: item === doc, icon: uiIcon("file-text", 14), closeIcon: uiIcon("x", 12),
        onSelect: (_event, eventCx) => this.select(project, item.path, eventCx),
        onClose: (_event, eventCx) => { this.select(project, item.path, eventCx); this.request(item, "close", eventCx); },
      }))));
    if (!doc) return shell.child(div().flex_1().flex().items_center().justify_center().text_color(c.secondary).child("왼쪽 Project에서 파일을 여세요."));
    shell.child(h_flex().flex_none().min_w(0).items_center().gap(6).px(10).py(4).border_b(1).border_color(c.separator)
      .child(adeButton("ade-history-back", "뒤로", (_event, eventCx) => this.travel(-1, eventCx), { icon: uiIcon("arrow-left", 14), tip: "이전에 방문한 파일·코드 위치", disabled: Boolean(history.pending) || history.index <= 0 }))
      .child(adeButton("ade-history-forward", "앞으로", (_event, eventCx) => this.travel(1, eventCx), { icon: uiIcon("arrow-right", 14), tip: "뒤로 이동하기 전의 파일·코드 위치", disabled: Boolean(history.pending) || history.index >= history.entries.length - 1 }))
      .child(div().flex_1().min_w(0).truncate().text_size(adeSize(11)).text_color(c.secondary)
        .child(`${project.name} · ${project.branch || "브랜치 없음"} · ${doc.path}`))
      .child(adeButton("ade-save", doc.saving ? "저장 중…" : "저장", (_event, eventCx) => this.save(doc, undefined, eventCx), { disabled: !doc.state || doc.loading || doc.saving || Boolean(project.machine) || doc.external || !isDirty(doc) }))
      .child(adeButton("ade-reload", "다시 읽기", (_event, eventCx) => this.request(doc, "reload", eventCx), { disabled: doc.loading || doc.saving }))
      .when(markdownFile(doc.path), element => element.child(adeButton("ade-preview", doc.preview ? "소스" : "미리보기", (_event, eventCx) => this.togglePreview(doc, eventCx), { disabled: !doc.state, selected: doc.preview }))));
    if (this.pending?.doc === doc) {
      const request = this.pending, action = request.action;
      shell.child(adeNote("저장하지 않은 변경이 있습니다."))
        .child(h_flex().flex_none().gap(6).px(12).pb(8)
          .child(adeButton("ade-save-close", "저장 후 계속", (_event, eventCx) => this.save(doc, saveCx => {
            if (this.pending !== request) return;
            this.pending = null;
            action === "close" ? this.remove(doc, saveCx) : this.load(doc, saveCx);
          }, eventCx), { disabled: doc.saving }))
          .child(adeButton("ade-discard", "변경 버리기", (_event, eventCx) => { this.pending = null; action === "close" ? this.remove(doc, eventCx) : this.load(doc, eventCx); }, { disabled: doc.saving }))
          .child(adeButton("ade-cancel-close", "취소", (_event, eventCx) => { this.pending = null; eventCx.notify(); })));
    }
    if (doc.error) shell.child(adeNote(doc.error));
    if (doc.loading) return shell.child(adeNote("파일을 불러오는 중…"));
    if (!doc.state) return shell;
    this.scheduleNavigation(doc);
    if (doc.external) shell.child(adeNote("외부 라이브러리 소스 · 읽기 전용"));
    if (project.machine) shell.child(adeNote("원격 파일은 읽기 전용입니다. 현재 저장 API는 로컬 파일만 지원합니다."));
    const text = doc.state.value();
    const body = v_flex().flex_1().min_w(0).min_h(0).overflow_hidden();
    if (doc.preview) body.child(TextView.markdown(`ade-preview-${doc.key}`, text).size_full().p(16).selectable(true).scrollable(true));
    else if (project.machine) body.child(TextView.html(`ade-readonly-${doc.key}`, sourceHTML(text)).size_full().p(12).selectable(true).scrollable(true));
    else body.child(doc.state.render(cx, { completion: this.completionPanel(doc, cx) }));
    return shell.child(body).child(this.lspInfo(doc, cx));
  }
}

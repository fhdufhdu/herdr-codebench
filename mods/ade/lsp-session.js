import { backend, backendCleanup, backendStatus } from "./backend.js";

const ownerId = () => `ade-buffer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const identity = snapshot => JSON.stringify([snapshot.project?.id, snapshot.project?.root, snapshot.project?.machine ?? null, snapshot.path]);
const recoverable = error => ["engine_unavailable", "lease_missing", "owner_conflict"].includes(error?.code);
const engineKey = engine => JSON.stringify([engine?.pid, engine?.version, engine?.started]);
export function utf16Position(text, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return null;
  const before = text.slice(0, offset), last = before.lastIndexOf("\n");
  return { line: before.split("\n").length - 1, col: offset - last - 1 };
}
export class LspSession {
  init(_cx, { onUpdate, onNavigate, owner } = {}) {
    this.taskOwner = owner;
    this.owner = ownerId(); this.onUpdate = onUpdate; this.onNavigate = onNavigate;
    this.alive = true; this.generation = 0; this.query = 0; this.serial = Promise.resolve();
    this.recoveryAttempts = 0; this.active = false;
    this.state = { status: "idle", error: null, revision: null, diagnostics: [], tokens: [], diagnosticsRevision: null, tokensRevision: null, confidence: null, hover: null, locations: [], kind: null,
      symbols: [], symbolsStatus: "idle", symbolsError: null, message: null };
  }
  spawn(cx, body) { return cx.spawn(body, { owner: this.taskOwner }); }
  after(cx, ms, body) { return cx.timer.after(ms, body, { owner: this.taskOwner }); }
  publish(patch, cx) { if (this.alive) { this.state = { ...this.state, ...patch }; this.onUpdate?.(this.state, cx); } }
  current(snapshot, generation) { return this.alive && generation === this.generation && this.snapshot?.revision === snapshot.revision && identity(this.snapshot) === identity(snapshot); }
  setActive(active, cx) {
    const wasActive = this.active; this.active = Boolean(active);
    if (!this.active) { this.engineTimer?.cancel(); this.engineTimer = null; this.recoveryTimer?.cancel(); this.recoveryTimer = null; return; }
    if (!wasActive && recoverable(this.lastFailure)) { this.recoveryAttempts = 0; this.scheduleRecovery(this.snapshot, this.generation, this.lastFailure, cx); }
    this.observeEngine(cx);
  }
  fail(snapshot, generation, error, cx) {
    if (!this.current(snapshot, generation)) return;
    this.lastFailure = error;
    if (error?.code === "owner_conflict" && this.ownerConflictSince == null) this.ownerConflictSince = Date.now();
    this.engineTimer?.cancel(); this.engineTimer = null;
    this.recoveryTimer?.cancel(); this.recoveryTimer = null;
    if (recoverable(error)) {
      // Retry only this exact idempotent buffer snapshot. Old semantic tasks
      // may never settle after a transport loss; their replies and queued
      // writes must not hold the repair chain or update its generation.
      this.synced = null; this.generation++; this.query++; this.serial = Promise.resolve();
      this.timer?.cancel(); this.diagnosticTimer?.cancel();
    }
    const message = error?.code === "owner_conflict" ? this.recoveryAttempts >= 3
      ? "다른 편집기가 이 파일의 분석을 사용 중입니다. 해당 편집기를 닫은 뒤 다시 확인하세요."
      : "다른 분석 세션이 종료되기를 기다리고 있습니다." : String(error);
    this.publish({ status: "error", error: message, symbols: [], symbolsStatus: "error", symbolsError: message }, cx);
    this.scheduleRecovery(snapshot, this.generation, error, cx);
    this.observeEngine(cx);
  }
  scheduleRecovery(snapshot, generation, error, cx) {
    if (!this.active || !recoverable(error) || !this.current(snapshot, generation) || this.recoveryTimer || this.recoveryAttempts >= 3) return;
    const delay = [500, 1500, 4000][this.recoveryAttempts++];
    this.recoveryTimer = this.after(cx, delay, timerCx => {
      this.recoveryTimer = null;
      this.spawn(timerCx, async taskCx => { if (this.current(snapshot, generation)) await this.flush(taskCx); });
    });
  }
  observeEngine(cx) {
    if (!this.alive || !this.active || !this.engineIdentity || this.engineTimer || this.recoveryTimer) return;
    if (this.lastFailure && this.lastFailure.code !== "owner_conflict" && (!recoverable(this.lastFailure) || this.recoveryAttempts >= 3)) return;
    this.engineTimer = this.after(cx, 10000, timerCx => {
      this.engineTimer = null;
      this.spawn(timerCx, async taskCx => {
        const snapshot = this.snapshot, generation = this.generation;
        try {
          const engine = await backendStatus(taskCx);
          if (!this.current(snapshot, generation) || !this.active) return;
          if (engineKey(engine) !== engineKey(this.engineIdentity)) {
            this.engineIdentity = engine; this.generation++; this.query++; this.serial = Promise.resolve(); this.synced = null;
            this.recoveryAttempts = 0; this.lastFailure = null; this.ownerConflictSince = null; this.ownershipRechecked = false; this.diagnosticTimer?.cancel();
            await this.flush(taskCx);
          } else if (this.lastFailure?.code === "owner_conflict" && this.recoveryAttempts >= 3 && !this.ownershipRechecked && Date.now() - this.ownerConflictSince >= 65000) {
            // One delayed same-owner claim lets the engine's expiry policy
            // arbitrate an orphan. The client never closes an unknown owner.
            this.ownershipRechecked = true; this.generation++; this.query++; this.serial = Promise.resolve(); this.synced = null;
            await this.flush(taskCx);
          } else if (this.synced?.revision === snapshot.revision || !this.lastFailure && this.attempted?.revision === snapshot.revision) {
            const touched = await backend("document_touch", this.body(snapshot), taskCx, { shouldSend: () => this.active && this.current(snapshot, generation) });
            if (!this.current(snapshot, generation) || !this.active) return;
            if (touched.path !== snapshot.path || touched.document_owner !== this.owner || touched.revision !== snapshot.revision) throw new Error("분석 heartbeat의 문서 identity가 일치하지 않습니다.");
          }
        } catch (error) { if (this.active) this.fail(snapshot, generation, error, taskCx); }
        finally { this.observeEngine(taskCx); }
      });
    });
  }
  sync(snapshot, cx) {
    if (!this.alive) return;
    if (typeof snapshot?.text !== "string" || !Number.isInteger(snapshot.revision) || snapshot.revision < 0 || !snapshot.path) {
      this.publish({ status: "error", error: "문서 원문과 현재 revision이 필요합니다." }, cx); return;
    }
    if (snapshot.project?.machine) { this.publish({ status: "unavailable", error: "원격 문서는 로컬 LSP 엔진에 전송할 수 없습니다." }, cx); return; }
    if (this.snapshot && identity(this.snapshot) !== identity(snapshot)) {
      this.publish({ status: "error", error: "문서마다 독립된 LSP 세션이 필요합니다." }, cx); return;
    }
    const firstOpen = !this.snapshot;
    const caretChanged = this.snapshot?.selection?.head !== snapshot.selection?.head;
    const changed = !this.snapshot || this.snapshot.revision !== snapshot.revision || this.snapshot.text !== snapshot.text;
    this.snapshot = { ...snapshot, project: { ...snapshot.project }, selection: snapshot.selection ? { ...snapshot.selection } : null };
    if (!changed) {
      if (caretChanged && this.state.status === "requesting" && this.state.kind !== "formatting") {
        this.query++; this.semanticTimer?.cancel();
        this.publish({ requestPhase: "cancelled", requestReason: "cursor-moved", status: "ready", kind: null, hover: null, locations: [], message: "커서가 이동하여 이전 요청을 취소했습니다." }, cx);
      }
      this.scheduleRecovery(this.snapshot, this.generation, this.lastFailure, cx); return;
    }
    this.generation++; this.query++; this.semanticTimer?.cancel(); this.timer?.cancel(); this.diagnosticTimer?.cancel(); this.recoveryTimer?.cancel(); this.engineTimer?.cancel();
    this.recoveryTimer = null; this.engineTimer = null; this.recoveryAttempts = 0; this.lastFailure = null;
    this.publish({ status: "pending", revision: snapshot.revision, error: null, confidence: "pending", hover: null, locations: [],
      symbols: [], symbolsStatus: "pending", symbolsError: null, message: null }, cx);
    this.timer = this.after(cx, firstOpen ? 0 : 250, timerCx => { this.timer = null; this.spawn(timerCx, async taskCx => { await this.flush(taskCx); }); });
  }
  body(snapshot) { return snapshot.library ? { path: snapshot.path, root: snapshot.project?.root } : { path: snapshot.path, document_owner: this.owner, revision: snapshot.revision, root: snapshot.project?.root }; }
  async read(kind, snapshot, cx, extra = {}, options = {}) {
    const retry = snapshot.library && this.retryRequested && ["symbols", "hover", "definition", "references"].includes(kind);
    if (retry) this.retryRequested = false;
    const value = await backend(kind, { ...this.body(snapshot), ...extra, ...(retry ? { retry: true } : {}) }, cx, options);
    // Cached library sources are immutable and addressed by trusted engine
    // metadata. These local tags guard late callbacks, not a writable lease.
    return snapshot.library ? { value, path: snapshot.path, document_owner: this.owner, revision: snapshot.revision } : value;
  }
  retry(cx) { this.retryRequested = true; this.recoveryAttempts = 0; this.lastFailure = null; this.ownershipRechecked = false; this.synced = null; return this.flush(cx); }
  async flush(cx) {
    const snapshot = this.snapshot, generation = this.generation;
    if (!snapshot || !this.alive) return;
    if (this.flushPromise && this.flushGeneration === generation) return this.flushPromise;
    const work = this.flushSnapshot(snapshot, generation, cx);
    this.flushPromise = work; this.flushGeneration = generation;
    try { return await work; } finally { if (this.flushPromise === work) this.flushPromise = null; }
  }
  async flushSnapshot(snapshot, generation, cx) {
    this.timer?.cancel(); this.timer = null;
    this.recoveryTimer?.cancel(); this.recoveryTimer = null;
    this.lastFailure = null;
    this.publish({ status: "syncing", error: null, symbolsStatus: "pending", symbolsError: null }, cx);
    // Only document writes are serialized. Slow semantic replies cannot hold
    // back a newer edit or lease release.
    const synchronizing = this.serial.catch(() => {}).then(async () => {
      if (!this.current(snapshot, generation)) return null;
      if (snapshot.library) {
        const info = await backend("info", this.body(snapshot), cx);
        if (!info.semantic) throw new Error("외부 소스의 분석 연결을 확인할 수 없습니다. 원본이 바뀌었거나 이전 캐시일 수 있으니 프로젝트 소스에서 정의 이동을 다시 실행하세요.");
        return { path: snapshot.path };
      }
      const retry = this.retryRequested; this.retryRequested = false;
      const acknowledgement = await backend("document_sync", { ...this.body(snapshot), text: snapshot.text, ...(retry ? { retry: true } : {}) }, cx, {
        shouldSend: () => this.current(snapshot, generation), onSend: () => { this.attempted = snapshot; },
        onEngine: engine => { this.engineIdentity = engine; this.observeEngine(cx); },
      });
      if (acknowledgement.document_owner !== this.owner || acknowledgement.revision !== snapshot.revision || acknowledgement.path !== snapshot.path) {
        throw new Error("문서 동기화 응답이 현재 버퍼와 일치하지 않습니다.");
      }
      this.acknowledged = snapshot;
      return acknowledgement;
    });
    this.serial = synchronizing;
    try {
      const acknowledgement = await synchronizing;
      if (!acknowledgement || !this.current(snapshot, generation)) return;
      this.synced = snapshot;
      const symbolsWork = this.loadSymbols(snapshot, generation, cx);
      const [diagnostics, tokens] = await Promise.allSettled([
        this.read("diagnostics", snapshot, cx).then(reply => {
          if (!this.current(snapshot, generation)) return;
          if (reply.document_owner !== this.owner || reply.revision !== snapshot.revision || reply.path !== snapshot.path) throw new Error("진단 응답의 문서 revision이 일치하지 않습니다.");
          const confidence = reply.value?.version_confidence ?? "pending";
          this.publish(confidence === "pending" ? { confidence } : { diagnostics: reply.value?.items ?? [], diagnosticsRevision: snapshot.revision, diagnosticsSupported: reply.value?.supported !== false, confidence,
            ...(snapshot.library && reply.value?.supported === false ? { message: "외부 라이브러리의 진단은 언어 서버가 제공하지 않습니다. 정보·정의·참조는 사용할 수 있습니다." } : {}) }, cx);
          if (confidence === "pending" || reply.value?.busy?.length) this.pollDiagnostics(snapshot, generation, cx);
        }),
        backend("tokens", { path: snapshot.path, text: snapshot.text }, cx).then(value => {
          if (this.current(snapshot, generation)) this.publish({ tokens: value, tokensRevision: snapshot.revision }, cx);
        }),
      ]);
      if (!this.current(snapshot, generation)) return;
      if (diagnostics.status === "rejected") this.fail(snapshot, generation, diagnostics.reason, cx);
      if (tokens.status === "rejected") this.fail(snapshot, generation, tokens.reason, cx);
      if (diagnostics.status === "fulfilled" && tokens.status === "fulfilled") {
        this.publish(this.state.symbolsStatus === "error" ? { status: "error", error: this.state.symbolsError } : { status: "ready", error: null }, cx);
      }
      const symbolsReady = await symbolsWork;
      if (this.current(snapshot, generation) && diagnostics.status === "fulfilled" && tokens.status === "fulfilled" && symbolsReady) {
        this.recoveryAttempts = 0; this.lastFailure = null; this.ownerConflictSince = null; this.ownershipRechecked = false;
      }
      this.observeEngine(cx);
    } catch (error) { this.fail(snapshot, generation, error, cx); }
  }
  async loadSymbols(snapshot, generation, cx) {
    try {
      const reply = await this.read("symbols", snapshot, cx);
      if (!this.current(snapshot, generation) || reply.document_owner !== this.owner || reply.revision !== snapshot.revision || reply.path !== snapshot.path) return;
      this.publish({ symbols: Array.isArray(reply.value) ? reply.value : [], symbolsStatus: "ready", symbolsError: null }, cx);
      return true;
    } catch (error) { this.fail(snapshot, generation, error, cx); return false; }
  }
  pollDiagnostics(snapshot, generation, cx, attempt = 0) {
    if (attempt >= 4 || !this.current(snapshot, generation)) return;
    this.diagnosticTimer?.cancel();
    this.diagnosticTimer = this.after(cx, [500, 1000, 2000, 3000][attempt], timerCx => {
      this.diagnosticTimer = null;
      this.spawn(timerCx, async taskCx => {
        try {
          const reply = await this.read("diagnostics", snapshot, taskCx);
          if (!this.current(snapshot, generation) || reply.document_owner !== this.owner || reply.revision !== snapshot.revision || reply.path !== snapshot.path) return;
          const confidence = reply.value?.version_confidence ?? "pending";
          this.publish(confidence === "pending" ? { confidence } : { diagnostics: reply.value?.items ?? [], diagnosticsRevision: snapshot.revision, confidence }, taskCx);
          if (confidence === "pending" || reply.value?.busy?.length) this.pollDiagnostics(snapshot, generation, taskCx, attempt + 1);
        } catch (error) { this.fail(snapshot, generation, error, taskCx); }
      });
    });
  }
  async request(kind, cx, { navigate = true } = {}) {
    if (!["hover", "definition", "references", "implementation", "super", "type-definition"].includes(kind)) throw new Error("지원하지 않는 LSP 요청입니다.");
    const snapshot = this.snapshot, generation = this.generation;
    const position = snapshot && utf16Position(snapshot.text, snapshot.selection?.head);
    if (!position) { this.publish({ kind, hover: null, locations: [], error: "커서 위치가 아직 제공되지 않았습니다." }, cx); return; }
    const query = ++this.query;
    if (!this.synced || this.synced.revision !== snapshot.revision) {
      // Semantic navigation waits for the ordered text acknowledgement, not
      // for unrelated diagnostics or token requests to finish.
      void this.flush(cx); await this.serial.catch(() => {});
    }
    if (!this.current(snapshot, generation) || query !== this.query || this.synced?.revision !== snapshot.revision) return;
    this.semanticTimer?.cancel();
    this.publish({ kind, status: "requesting", error: null, message: null, requestPhase: "queued", requestQuery: query, requestReason: null, requestStartedAt: Date.now() }, cx);
    const timer = this.semanticTimer = this.after(cx, 30000, timerCx => {
      if (!this.current(snapshot, generation) || query !== this.query) return;
      this.query++;
      this.publish({ status: "error", error: "언어 서버 요청이 30초 안에 완료되지 않았습니다. 다시 확인하거나 탐색을 다시 요청하세요.", requestPhase: "timeout", requestReason: "deadline" }, timerCx);
    });
    try {
      const route = kind === "super" ? "related" : ["implementation", "type-definition"].includes(kind) ? "definition" : kind;
      const extra = kind === "super" ? { kind: "super" } : kind === "implementation" ? { kind: "implementation" } : kind === "type-definition" ? { kind: "typeDefinition" } : {};
      const reply = await this.read(route, snapshot, cx, { ...position, ...extra }, { onPhase: phase => {
        if (this.current(snapshot, generation) && query === this.query) this.publish({ requestPhase: phase }, cx);
      } });
      if (!this.current(snapshot, generation) || query !== this.query) return;
      if (this.snapshot.selection?.head !== snapshot.selection?.head) {
        this.publish({ status: "ready", kind: null, hover: null, locations: [], message: "커서가 이동하여 이전 요청을 취소했습니다." }, cx); return;
      }
      if (reply.document_owner !== this.owner || reply.revision !== snapshot.revision || reply.path !== snapshot.path) {
        this.publish({ status: "error", error: "LSP 응답의 문서 revision이 일치하지 않습니다." }, cx); return;
      }
      const locations = kind === "hover" || !Array.isArray(reply.value) ? [] : reply.value;
      const empty = kind === "hover" ? !reply.value?.markdown : !locations.length;
      this.publish({ status: "ready", kind, hover: kind === "hover" ? reply.value : null, locations,
        message: empty ? kind === "hover" ? "표시할 정보가 없습니다." : kind === "references" ? "참조가 없습니다." : "이동할 위치가 없습니다." : null }, cx);
      if (navigate && !["hover", "references"].includes(kind) && locations.length === 1) {
        if (this.current(snapshot, generation) && query === this.query && this.snapshot.selection?.head === snapshot.selection?.head) this.onNavigate?.(locations[0], cx);
      }
      return { kind, value: reply.value, locations, empty };
    } catch (error) { if (query === this.query) { this.publish({ requestPhase: "error" }, cx); this.fail(snapshot, generation, error, cx); } }
    finally { timer.cancel(); if (this.semanticTimer === timer) this.semanticTimer = null; }
  }
  async editorRequest(kind, cx, extra = {}) {
    if (!["completion", "completion_resolve", "formatting"].includes(kind)) throw new Error("지원하지 않는 편집 요청입니다.");
    const snapshot = this.snapshot, generation = this.generation, query = ++this.query;
    if (!snapshot || !this.alive || snapshot.library) return null;
    const position = kind === "formatting" ? {} : utf16Position(snapshot.text, snapshot.selection?.head);
    if (!position) { this.publish({ message: "커서 위치가 아직 제공되지 않았습니다." }, cx); return null; }
    if (!this.synced || this.synced.revision !== snapshot.revision) { void this.flush(cx); await this.serial.catch(() => {}); }
    if (!this.current(snapshot, generation) || query !== this.query || this.synced?.revision !== snapshot.revision) return null;
    this.publish({ kind, status: "requesting", error: null, message: null }, cx);
    try {
      const reply = await backend(kind, { ...extra, ...this.body(snapshot), ...position }, cx);
      if (!this.current(snapshot, generation) || query !== this.query) return null;
      if (kind !== "formatting" && this.snapshot.selection?.head !== snapshot.selection?.head) {
        this.publish({ status: "ready", kind: null, message: "커서가 이동하여 이전 요청을 취소했습니다." }, cx); return null;
      }
      if (reply.document_owner !== this.owner || reply.revision !== snapshot.revision || reply.path !== snapshot.path) throw new Error("편집 응답의 문서 revision이 일치하지 않습니다.");
      this.publish({ status: "ready", kind, error: null }, cx);
      return { value: reply.value, revision: snapshot.revision, offset: snapshot.selection?.head, owner: this.owner };
    } catch (error) {
      if (query === this.query) {
        if (/not supported/.test(String(error))) this.publish({ status: "ready", message: String(error) }, cx);
        else this.fail(snapshot, generation, error, cx);
      }
      return null;
    }
  }
  close(cx) {
    if (this.closing) return this.closing;
    if (this.closed) return Promise.resolve();
    this.semanticTimer?.cancel();
    this.alive = false; this.generation++; this.query++; this.semanticTimer?.cancel(); this.timer?.cancel(); this.diagnosticTimer?.cancel(); this.recoveryTimer?.cancel(); this.engineTimer?.cancel(); this.timer = null;
    // Do not await this.serial: its task can already be cancelled by HMR.
    // New/queued syncs check alive before sending. For a request already sent,
    // close the exact attempted lease; the engine retires that owner on success.
    if (!this.attempted) { this.closed = true; return Promise.resolve(); }
    const closing = this.closing = (async () => {
      try {
        await backendCleanup("document_close", this.body(this.attempted), cx, { engine: this.engineIdentity });
        this.closed = true;
      } catch (error) {
        // If the newest request never reached the engine, release the last
        // acknowledged lease instead. Every attempt still requires the exact
        // owner/revision; a different owner can never be closed.
        if (!/stale document revision/.test(String(error)) || !this.acknowledged || this.acknowledged.revision === this.attempted.revision) throw error;
        await backendCleanup("document_close", this.body(this.acknowledged), cx, { engine: this.engineIdentity });
        this.closed = true;
      }
    })();
    // Retain one shared pending close even after alive=false. A failed exact
    // owner cleanup can be retried; a successful close stays idempotent.
    const settled = () => { if (this.closing === closing) this.closing = null; };
    void closing.then(settled, settled);
    return closing;
  }
}

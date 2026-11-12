import { backend } from "./backend.js";
import { shared, setShared } from "herdr";
import { projectKey } from "./workspace.js";

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const scoped = (namespace, context) => object(object(shared(namespace))[projectKey(context)]);
const saveScoped = (namespace, context, value) => setShared(namespace, { ...object(shared(namespace)), [projectKey(context)]: value });
function databaseMode(context) { setShared("ade.editor-mode", { ...object(shared("ade.editor-mode")), [projectKey(context)]: "database" }); }
function documentSpec(spec) {
  const kind = spec?.kind === "sql" ? "console" : spec?.kind === "view" ? "table" : spec?.kind;
  const sourceId = spec?.source_id ?? spec?.source?.id;
  if (!sourceId || !["table", "console", "ddl"].includes(kind) || kind === "table" && !spec.table) throw new Error("데이터베이스 문서 대상을 확인하세요.");
  const value = { source_id: sourceId, kind, database: spec.database ?? "", schema: spec.schema ?? "", table: spec.table ?? "" };
  if (spec.kind === "view" || spec.table_type === "view" || spec.entityKind === "view") value.table_type = "view";
  if (kind === "ddl") value.selection = ddlSelection(spec.selection ?? spec.objects ?? (spec.table ? [{ ...value, kind: "table", name: spec.table }] : []));
  return value;
}
export function databaseDocumentKey(spec) {
  const value = documentSpec(spec), objects = value.kind === "ddl" ? value.selection.map(node => catalogKey(value.source_id, node)).sort() : [];
  return JSON.stringify([value.source_id, value.kind, value.database, value.schema, value.table, objects]);
}
export function databaseDocumentState(context) {
  const state = scoped("ade.database-documents", context), tabs = Array.isArray(state.tabs) ? state.tabs : [];
  return { ...state, tabs, active: tabs.some(tab => tab.id === state.active) ? state.active : tabs[0]?.id ?? null };
}
export function openDatabaseDocument(spec, context) {
  if (!context) throw new Error("프로젝트를 먼저 선택하세요.");
  const value = documentSpec(spec);
  const id = databaseDocumentKey(value), state = databaseDocumentState(context);
  saveScoped("ade.database-documents", context, { ...state, tabs: state.tabs.some(tab => tab.id === id) ? state.tabs : [...state.tabs, { id, spec: value, title: spec.title }], active: id });
  databaseMode(context); return id;
}
export function selectDatabaseDocument(id, context) {
  const state = databaseDocumentState(context); if (!state.tabs.some(tab => tab.id === id)) return false;
  saveScoped("ade.database-documents", context, { ...state, active: id }); databaseMode(context); return true;
}
export function closeDatabaseDocument(id, context) {
  const state = databaseDocumentState(context), at = state.tabs.findIndex(tab => tab.id === id), tabs = state.tabs.filter(tab => tab.id !== id);
  saveScoped("ade.database-documents", context, { ...state, tabs, active: state.active === id ? tabs[Math.min(at, tabs.length - 1)]?.id ?? null : state.active });
}
const executing = record => ["queued", "running"].includes(record.state);
export function databaseExecutionState(context) {
  const state = scoped("ade.database-executions", context);
  return { ...state, records: Array.isArray(state.records) ? state.records : [], activeId: state.activeId ?? null };
}
// Only action keywords and target identifiers enter metadata. Literal/comment
// bodies are skipped by this bounded lexer, rather than redacted afterwards.
function summaryTokens(sql) {
  const tokens = []; let i = 0, depth = 0;
  const text = sql.slice(0, 65536);
  while (i < text.length && tokens.length < 4096) {
    const c = text[i], next = text[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && next === '-' || c === '#') { const end = text.indexOf('\n', i); i = end < 0 ? text.length : end; continue; }
    if (c === '/' && next === '*') {
      let nesting = 1; i += 2;
      while (i < text.length && nesting) { if (text.slice(i, i + 2) === '/*') { nesting++; i += 2; } else if (text.slice(i, i + 2) === '*/') { nesting--; i += 2; } else i++; }
      continue;
    }
    if (c === "'") {
      i++;
      while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i] === "'" && text[i + 1] === "'") i += 2; else if (text[i++] === "'") break; }
      tokens.push({ value: '?', depth }); continue;
    }
    if (c === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (tag) { const end = text.indexOf(tag[0], i + tag[0].length); i = end < 0 ? text.length : end + tag[0].length; tokens.push({ value: '?', depth }); continue; }
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c; let value = '', closed = false; i++;
      while (i < text.length) { if (text[i] === close && text[i + 1] === close) { value += close; i += 2; } else if (text[i] === close) { i++; closed = true; break; } else value += text[i++]; }
      tokens.push({ value: closed ? value : '?', identifier: closed, depth }); continue;
    }
    if (/[A-Za-z_\u0080-\uffff]/.test(c)) {
      const start = i++; while (i < text.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(text[i])) i++;
      const value = text.slice(start, i); tokens.push({ value, keyword: value.toUpperCase(), identifier: true, depth }); continue;
    }
    tokens.push({ value: c, depth }); if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1); i++;
  }
  return tokens;
}
function statementSummary(sql) {
  const tokens = summaryTokens(sql), actions = new Set(['SELECT', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'EXPLAIN', 'SHOW', 'PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT']);
  const first = tokens.findIndex(token => token.depth === 0 && token.keyword);
  const at = tokens[first]?.keyword === 'WITH' ? tokens.findIndex((token, index) => index > first && token.depth === 0 && actions.has(token.keyword))
    : actions.has(tokens[first]?.keyword) ? first : -1;
  if (at < 0) return 'SQL';
  const action = tokens[at].keyword, targets = [];
  const target = index => {
    while (['IF', 'NOT', 'EXISTS', 'ONLY', 'CONCURRENTLY', 'LOW_PRIORITY', 'IGNORE'].includes(tokens[index]?.keyword)) index++;
    if (!tokens[index]?.identifier || ['SELECT', 'WHERE', 'SET', 'VALUES', 'AS', 'JOIN', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'TOP'].includes(tokens[index].keyword)) return;
    let value = tokens[index].value;
    while (tokens[index + 1]?.value === '.' && tokens[index + 2]?.identifier) { value += '.' + tokens[index + 2].value; index += 2; }
    value = value.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
    if (value && !targets.includes(value)) targets.push(value.length > 36 ? value.slice(0, 35) + '…' : value);
  };
  let object = '';
  if (action === 'SELECT' || action === 'DELETE') {
    for (let i = at + 1; i < tokens.length; i++) if (tokens[i].depth === 0 && ['FROM', 'JOIN'].includes(tokens[i].keyword)) target(i + 1);
  } else if (['INSERT', 'REPLACE', 'MERGE'].includes(action)) {
    const into = tokens.findIndex((token, index) => index > at && token.depth === 0 && token.keyword === 'INTO'); if (into >= 0) target(into + 1);
  } else if (action === 'UPDATE') target(at + 1);
  else if (['CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(action)) {
    const type = tokens.findIndex((token, index) => index > at && token.depth === 0 && ['TABLE', 'VIEW', 'INDEX', 'SCHEMA', 'DATABASE'].includes(token.keyword));
    if (type >= 0) { object = ' ' + tokens[type].keyword; target(type + 1); }
  }
  return action + object + (targets.length ? ' ' + targets.slice(0, 2).join(' + ') + (targets.length > 2 ? ' +…' : '') : '');
}
export function sqlExecutionSummary(statements) {
  const labels = [...new Set(statements.slice(0, 256).map(statementSummary))];
  const body = (labels.slice(0, 2).join(' + ') || 'SQL') + (labels.length > 2 ? ' +…' : '');
  return (body.length > 72 ? body.slice(0, 71) + '…' : body) + (statements.length > 1 ? ` · ${statements.length}구문` : '');
}
export function sqlResultTitle(record, results = []) {
  const statements = results.map(result => result.statement).filter(text => typeof text === 'string' && text.trim());
  const label = record.queryLabel || (statements.length ? sqlExecutionSummary(statements) : record.spec?.table ? `SQL ${record.spec.table}` : 'SQL 결과');
  const when = Number.isFinite(record.startedAt) && record.startedAt > 0 ? new Date(record.startedAt) : null;
  const suffix = record.runNumber ? `#${record.runNumber}` : when ? [when.getHours(), when.getMinutes(), when.getSeconds()].map(value => String(value).padStart(2, '0')).join(':') : String(record.id ?? '').slice(-6);
  return suffix ? `${label} · ${suffix}` : label;
}
export function publishDatabaseExecution(context, snapshot, metadata = {}) {
  if (!context || !snapshot?.id) return;
  const state = databaseExecutionState(context), previous = state.records.find(record => record.id === snapshot.id);
  const runNumber = previous?.runNumber ?? (!previous ? Math.max(Number(state.nextRunNumber) || 1, ...state.records.map(record => (Number(record.runNumber) || 0) + 1)) : undefined);
  const record = { ...previous, id: snapshot.id, jobId: snapshot.id, spec: metadata.spec ? documentSpec(metadata.spec) : previous?.spec,
    name: metadata.name ?? previous?.name ?? "SQL 실행", documentId: metadata.documentId ?? previous?.documentId,
    queryLabel: metadata.queryLabel ?? previous?.queryLabel, sourceName: metadata.sourceName ?? previous?.sourceName, runNumber,
    startedAt: metadata.startedAt ?? previous?.startedAt, state: snapshot.state ?? previous?.state,
    current: snapshot.current ?? previous?.current, total: snapshot.total ?? previous?.total,
    elapsed_ms: snapshot.elapsed_ms ?? previous?.elapsed_ms, error: snapshot.error ?? null,
    resultCount: Array.isArray(snapshot.results) ? snapshot.results.length : previous?.resultCount ?? 0 };
  const records = previous ? state.records.map(item => item.id === record.id ? record : item) : [...state.records];
  while (!previous && records.length >= 20) {
    const at = records.findIndex(item => !executing(item));
    if (at < 0) throw new Error("데이터베이스 실행 중 기록이 20개입니다.");
    records.splice(at, 1);
  }
  if (!previous) records.push(record);
  saveScoped("ade.database-executions", context, { ...state, records, nextRunNumber: Math.max(Number(state.nextRunNumber) || 1, (runNumber ?? 0) + 1), activeId: previous ? state.activeId : record.id });
}
export function selectDatabaseExecution(id, context) {
  const state = databaseExecutionState(context); if (state.records.some(record => record.id === id)) saveScoped("ade.database-executions", context, { ...state, activeId: id });
}
export function closeDatabaseExecution(id, context) {
  const state = databaseExecutionState(context), records = state.records.map(record => record.id === id ? { ...record, closed: true } : record);
  saveScoped("ade.database-executions", context, { ...state, records, activeId: state.activeId === id ? records.filter(record => !record.closed).at(-1)?.id ?? null : state.activeId });
}

export const DRIVERS = Object.freeze([
  { id: "mysql", label: "MySQL", port: 3306 }, { id: "mariadb", label: "MariaDB", port: 3306 },
  { id: "postgres", label: "PostgreSQL", port: 5432 }, { id: "sqlserver", label: "SQL Server", port: 1433 },
  { id: "sqlite", label: "SQLite", port: 0 },
]);
export function sourceDraft(source = {}) {
  const value = { name: "", driver: "sqlite", host: "", port: 0, user: "", database: "", path: "", tls: "disable", ...source };
  delete value.password; // Blank UI password must not erase an existing credential.
  return value;
}
export function validateSource(source) {
  const errors = {};
  if (!source?.name?.trim()) errors.name = "연결 이름을 입력하세요.";
  if (!DRIVERS.some(driver => driver.id === source?.driver)) errors.driver = "지원하지 않는 드라이버입니다.";
  if (!Number.isInteger(Number(source?.port ?? 0)) || Number(source?.port) < 0 || Number(source?.port) > 65535) errors.port = "포트는 0–65535 정수입니다.";
  if (!["", "disable", "require", "verify-full"].includes(source?.tls ?? "")) errors.tls = "TLS 옵션을 확인하세요.";
  if (source?.driver === "sqlite" && (!/^(\/|[A-Za-z]:[\\/])/.test(source.path ?? "") || /[?\0]/.test(source.path ?? ""))) errors.path = "SQLite 파일의 일반 절대 경로를 입력하세요.";
  return errors;
}
const normalized = node => ({ ...node,
  database: node.database || (node.kind === "database" ? node.name : ""),
  schema: node.schema || (node.kind === "schema" ? node.name : ""),
  table: node.table || (["table", "view"].includes(node.kind) ? node.name : ""),
});
export const catalogKey = (sourceId, node) => { const n = normalized(node); return JSON.stringify([sourceId, n.kind, n.database, n.schema, n.table, n.name]); };
export function catalogRequest(sourceId, node) {
  if (!node) return { source_id: sourceId };
  const n = normalized(node), request = { source_id: sourceId, database: n.database };
  if (n.kind !== "database") request.schema = n.schema;
  if (["table", "view", "column"].includes(n.kind)) request.table = n.table;
  return request;
}
export function ddlSelection(nodes) {
  const unique = new Map();
  for (const original of nodes) {
    let node = normalized(original);
    if (node.kind === "column") node = { ...node, kind: "table", name: node.table };
    if (!["database", "schema", "table", "view"].includes(node.kind) || !node.name) throw new Error("DDL 선택에 지원하지 않는 개체가 있습니다.");
    unique.set(catalogKey("", node), node);
  }
  const values = [...unique.values()], rank = { database: 0, schema: 1, table: 2, view: 2 };
  return values.filter(node => !values.some(parent => parent !== node && parent.database === node.database
    && (parent.kind === "database" || (parent.kind === "schema" && parent.schema === node.schema && rank[node.kind] > 1))))
    .sort((a, b) => rank[a.kind] - rank[b.kind]);
}
export class DatabaseService {
  request(method, database, cx) { return backend(method, { database }, cx); }
  sources(cx) { return this.request("db_sources", {}, cx); }
  save(source, cx) {
    const errors = validateSource(source);
    if (Object.keys(errors).length) return Promise.reject(new Error(Object.values(errors).join(" ")));
    const value = { ...source, port: Number(source.port ?? 0) };
    delete value.has_password; delete value.password_storage;
    return this.request("db_save", { source: value }, cx);
  }
  remove(sourceId, cx) { return this.request("db_delete", { source_id: sourceId }, cx); }
  test(sourceOrId, cx) { return this.request("db_test", typeof sourceOrId === "string" ? { source_id: sourceOrId } : { source: sourceOrId }, cx); }
  catalog(sourceId, node, cx) { return this.request("db_catalog", catalogRequest(sourceId, node), cx); }
  ddl(sourceId, objects, cx) { return this.request("db_ddl", { source_id: sourceId, objects: ddlSelection(objects) }, cx); }
  rows(target, page = {}, cx) { return this.request("db_rows", { ...target, limit: Math.max(1, Math.min(1000, page.limit ?? 200)), offset: Math.max(0, page.offset ?? 0) }, cx); }
  query(target, statements, cx) {
    if (!Array.isArray(statements) || !statements.length || statements.some(text => typeof text !== "string" || !text.trim())) throw new Error("실행할 SQL 원문을 선택하세요.");
    return this.request("db_query", { ...target, statements: [...statements] }, cx);
  }
  job(id, cx) { return this.request("db_job", { job_id: id }, cx); }
  cancel(id, cx) { return this.request("db_cancel", { job_id: id }, cx); }
  apply(target, changes, cx) {
    if (!changes.length) throw new Error("반영할 변경이 없습니다.");
    return this.request("db_apply", { ...target, changes }, cx);
  }
}
export const databaseService = new DatabaseService();
export class QueryJob {
  constructor(service = databaseService, { context, onUpdate, name, sourceName, documentId } = {}) {
    this.service = service; this.context = context; this.onUpdate = onUpdate; this.sourceName = sourceName ?? name; this.documentId = documentId;
    this.sequence = 0; this.state = { state: "idle", results: [], current: 0, total: 0 };
  }
  publish(cx) {
    publishDatabaseExecution(this.context, this.state, { spec: { ...this.target, kind: "console" }, name: this.queryLabel, queryLabel: this.queryLabel, sourceName: this.sourceName, documentId: this.documentId, startedAt: this.startedAt });
    this.onUpdate?.(this.state, cx);
  }
  get running() { return ["queued", "running"].includes(this.state.state); }
  async start(target, statements, cx) {
    if (this.running || this.starting) throw new Error("이미 실행 중입니다.");
    if (this.context && databaseExecutionState(this.context).records.filter(executing).length >= 20) throw new Error("데이터베이스 실행 중 기록이 20개입니다.");
    this.starting = true;
    this.sequence++;
    this.target = { ...target }; this.statements = [...statements]; this.startedAt = Date.now();
    this.queryLabel = sqlExecutionSummary(statements);
    try {
      const result = await this.service.query(target, statements, cx);
      this.id = result.job_id;
      if (!this.id) throw new Error("쿼리 작업 ID를 받지 못했습니다.");
      this.state = { id: this.id, state: "queued", current: 0, total: statements.length, results: [], elapsed_ms: 0 };
      this.publish(cx);
      return this.state;
    } finally { this.starting = false; }
  }
  async refresh(cx) {
    if (!this.id) return this.state;
    const id = this.id, sequence = ++this.sequence, state = await this.service.job(id, cx);
    if (id === this.id && sequence === this.sequence) { this.state = state; this.publish(cx); }
    return this.state;
  }
  async cancel(cx) {
    if (!this.id || !this.running) return this.state;
    const id = this.id, sequence = ++this.sequence, state = await this.service.cancel(id, cx);
    if (id === this.id && sequence === this.sequence) { this.state = state; this.publish(cx); }
    return this.state;
  }
}
const copyValue = value => value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export class TableChanges {
  constructor(page) {
    this.columns = page.columns.map(column => typeof column === "string" ? column : column.name);
    this.primaryKeys = [...(page.primary_keys ?? [])];
    this.originals = page.rows.map(row => Object.fromEntries(this.columns.map((name, i) => [name, copyValue(row[i])])));
    this.changes = new Map(); this.nextInsert = 0;
  }
  get dirty() { return this.changes.size > 0; }
  editable(index) { return Number.isInteger(index) && index >= 0 && index < this.originals.length && this.primaryKeys.length > 0; }
  update(index, column, value) {
    if (this.applying) throw new Error("반영 중에는 변경할 수 없습니다.");
    if (typeof index === "string" && this.changes.get(index)?.op === "insert") {
      if (!this.columns.includes(column)) throw new Error("알 수 없는 열입니다.");
      this.changes.get(index).values = { ...this.changes.get(index).values, [column]: copyValue(value) }; return;
    }
    if (!this.editable(index)) throw new Error("행 수정에는 기본 키가 필요합니다.");
    if (!this.columns.includes(column)) throw new Error("알 수 없는 열입니다.");
    const original = this.originals[index], previous = this.changes.get(index);
    if (previous?.op === "delete") throw new Error("삭제 예정인 행입니다.");
    const values = { ...(previous?.values ?? {}), [column]: copyValue(value) };
    if (same(value, original[column])) delete values[column];
    if (!Object.keys(values).length) this.changes.delete(index);
    else this.changes.set(index, { op: "update", original: { ...original }, values });
  }
  remove(index) {
    if (this.applying) throw new Error("반영 중에는 변경할 수 없습니다.");
    if (typeof index === "string" && index.startsWith("insert:")) { this.changes.delete(index); return; }
    if (!this.editable(index)) throw new Error("행 삭제에는 기본 키가 필요합니다.");
    this.changes.set(index, { op: "delete", original: { ...this.originals[index] } });
  }
  insert(values) {
    if (this.applying) throw new Error("반영 중에는 변경할 수 없습니다.");
    if (Object.keys(values).some(name => !this.columns.includes(name))) throw new Error("알 수 없는 가져오기 열입니다.");
    const id = `insert:${++this.nextInsert}`;
    this.changes.set(id, { op: "insert", values: copyValue(values) }); return id;
  }
  revert() { if (this.applying) throw new Error("반영 중에는 변경할 수 없습니다."); this.changes.clear(); }
  payload() { return [...this.changes.values()].map(copyValue); }
  // Sending a write is an explicit caller action, never a staging side effect.
  async apply(service, target, cx) {
    if (this.applying) throw new Error("이미 반영 중입니다.");
    const snapshot = this.payload();
    if (!snapshot.length) throw new Error("반영할 변경이 없습니다.");
    this.applying = true;
    try { const result = await service.apply(target, snapshot, cx); this.changes.clear(); return result; }
    finally { this.applying = false; }
  }
}

// Bounded lexical splitting, not a SQL grammar. Client DELIMITER/GO lines are
// excluded; original statement ranges remain available for review before run.
export function splitSQL(text, driver = "sqlite", pairs = null) {
  const mysql = ["mysql", "mariadb"].includes(driver), result = [];
  const opens = [];
  let from = 0, i = 0, quote = null, dollar = null, comment = 0, lineComment = false, delimiter = ";", hasCode = false;
  const push = end => {
    if (hasCode) {
      let start = from; while (/\s/.test(text[start] ?? "") && start < end) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end > start) result.push({ from: start, to: end, text: text.slice(start, end) });
    }
    hasCode = false;
    opens.length = 0;
  };
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (lineComment) { if (c === "\n") lineComment = false; i++; continue; }
    if (comment) { if (c === "/" && next === "*") { comment++; i += 2; } else if (c === "*" && next === "/") { comment--; i += 2; } else i++; continue; }
    if (dollar) { if (text.startsWith(dollar, i)) { i += dollar.length; dollar = null; } else i++; continue; }
    if (quote) {
      const close = quote === "[" ? "]" : quote;
      if (c === "\\" && (mysql || quote === "E")) { i += 2; continue; }
      const actual = quote === "E" ? "'" : close;
      if (c === actual && next === actual) { i += 2; continue; }
      if (c === actual) quote = null;
      i++; continue;
    }
    if (i === 0 || text[i - 1] === "\n") {
      const end = text.indexOf("\n", i), stop = end < 0 ? text.length : end;
      const line = text.slice(i, stop).trim();
      const directive = mysql && /^DELIMITER\s+(\S+)\s*$/i.exec(line);
      if (directive) {
        if (hasCode) throw new Error("DELIMITER 앞의 SQL 구문을 먼저 끝내세요.");
        delimiter = directive[1]; i = stop; from = stop; continue;
      }
      if (driver === "sqlserver" && /^GO(?:\s|$)/i.test(line)) {
        if (!/^GO\s*(?:--.*)?$/i.test(line)) throw new Error("GO 반복 횟수는 지원하지 않습니다.");
        push(i); i = stop; from = stop; continue;
      }
    }
    if (c === "-" && next === "-" && (!mysql || /\s/.test(text[i + 2] ?? " ")) || mysql && c === "#") { lineComment = true; i += c === "#" ? 1 : 2; continue; }
    if (c === "/" && next === "*") { comment = 1; i += 2; continue; }
    if (driver !== "sqlserver" && text.startsWith(delimiter, i)) { push(i); i += delimiter.length; from = i; continue; }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      quote = driver === "postgres" && c === "'" && /[eE]/.test(text[i - 1] ?? "") && !/\w/.test(text[i - 2] ?? "") ? "E" : c;
      hasCode = true; i++; continue;
    }
    if (driver === "postgres" && c === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (match) { dollar = match[0]; hasCode = true; i += dollar.length; continue; }
    }
    if (c === "(") opens.push(i);
    else if (c === ")" && opens.length) { const start = opens.pop(); pairs?.push({ from: start + 1, to: i }); }
    if (!/\s/.test(c)) hasCode = true;
    i++;
  }
  if (quote || dollar || comment) throw new Error("SQL 문자열 또는 주석이 끝나지 않았습니다.");
  push(text.length); return result;
}
export class SQLScript {
  constructor(text = "", driver = "sqlite") { this.text = text; this.driver = driver; }
  statements() { return splitSQL(this.text, this.driver); }
  candidates(selection = null) {
    const pairs = [], statements = splitSQL(this.text, this.driver, pairs), candidates = [], text = this.text;
    const add = (kind, from, to, label) => {
      if (to <= from || candidates.some(item => item.from === from && item.to === to)) return;
      const original = text.slice(from, to), parts = ["selection", "nested"].includes(kind) ? splitSQL(original, this.driver)
        : statements.filter(item => item.from >= from && item.to <= to);
      if (parts.length) candidates.push({ id: `${kind}:${from}:${to}`, kind, from, to, label, text: original, statements: parts.map(item => item.text) });
    };
    const anchor = selection?.anchor ?? selection?.head ?? 0, head = selection?.head ?? anchor;
    const start = selection?.start ?? Math.min(anchor, head), end = selection?.end ?? Math.max(anchor, head);
    if (end > start && start >= 0 && end <= text.length) add("selection", start, end, "선택한 SQL");
    if (Number.isInteger(selection?.head)) {
      for (const pair of pairs.filter(pair => pair.from <= selection.head && pair.to >= selection.head).sort((a, b) => a.to - a.from - (b.to - b.from))) {
        const body = text.slice(pair.from, pair.to).replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");
        if (/^(SELECT|WITH)\b/i.test(body) && splitSQL(body, this.driver).length === 1) add("nested", pair.from, pair.to, "중첩 쿼리");
      }
      const current = statements.find(item => selection.head >= item.from && selection.head <= item.to);
      if (current) add("statement", current.from, current.to, "현재 구문");
      const left = text.slice(0, selection.head).lastIndexOf("\n\n"), right = text.indexOf("\n\n", selection.head);
      const block = statements.filter(item => item.from >= (left < 0 ? 0 : left + 2) && item.to <= (right < 0 ? text.length : right));
      if (block.length) add("block", block[0].from, block.at(-1).to, "현재 블록");
    }
    if (statements.length) add("script", statements[0].from, statements.at(-1).to, "전체 SQL");
    return candidates;
  }
}

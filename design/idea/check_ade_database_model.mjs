import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { extractData, parseImport, prepareImport, sqlLiteral, quoteIdentifier, binaryHex } from "../../mods/ade/data-extract.js";

const calls = [], saved = new Map(), context = vm.createContext({ console });
const projectKey = project => JSON.stringify([project?.machine ?? null, project?.root ?? '', project?.id ?? '']);
const module = new vm.SourceTextModule(await fs.readFile(new URL("../../mods/ade/database-model.js", import.meta.url), "utf8"), { context });
await module.link(async name => {
  if (name === 'herdr') return new vm.SyntheticModule(['shared', 'setShared'], function () { this.setExport('shared', key => saved.get(key)); this.setExport('setShared', (key, value) => saved.set(key, value)); }, { context });
  if (name === './workspace.js') return new vm.SyntheticModule(['projectKey'], function () { this.setExport('projectKey', projectKey); }, { context });
  assert.equal(name, "./backend.js");
  return new vm.SyntheticModule(["backend"], function () { this.setExport("backend", async (method, body) => { calls.push({ method, body }); return { job_id: "owned-job" }; }); }, { context });
});
await module.evaluate();
const { DRIVERS, validateSource, sourceDraft, catalogKey, ddlSelection, DatabaseService, TableChanges, SQLScript, splitSQL, QueryJob } = module.namespace;
const { openDatabaseDocument, databaseDocumentState, databaseDocumentKey, closeDatabaseDocument, databaseExecutionState, publishDatabaseExecution, closeDatabaseExecution, sqlExecutionSummary, sqlResultTitle } = module.namespace;
const plain = value => JSON.parse(JSON.stringify(value));
for (const [sql, title] of [
  ["SELECT name FROM main.customers WHERE password='secret FROM hidden'", 'SELECT main.customers'],
  ["SELECT 'FROM hidden' AS message", 'SELECT'],
  ['SELECT $$FROM hidden$$ FROM public.events', 'SELECT public.events'],
  ['/* UPDATE hidden */ SELECT * FROM customers JOIN orders ON orders.customer_id=customers.id', 'SELECT customers + orders'],
  ["INSERT INTO [dbo].[users](password) VALUES('secret')", 'INSERT dbo.users'],
  ['UPDATE "public"."customers" SET password=:secret', 'UPDATE public.customers'],
  ["DELETE FROM `orders` WHERE token='secret'", 'DELETE orders'],
  ["WITH recent AS (SELECT * FROM customers WHERE token='secret') SELECT * FROM recent", 'SELECT recent'],
  ["CREATE TABLE IF NOT EXISTS public.customers(id text DEFAULT 'secret')", 'CREATE TABLE public.customers'],
  ["GRANT SELECT ON customers TO 'secret'", 'SQL'],
  ["SELECT * FROM WHERE password='secret'", 'SELECT'],
]) { assert.equal(sqlExecutionSummary([sql]), title); assert.equal(sqlExecutionSummary([sql]).includes('secret'), false); }
assert.equal(sqlExecutionSummary(['SELECT * FROM customers', 'UPDATE orders SET paid=1']), 'SELECT customers + UPDATE orders · 2구문');
assert.equal(sqlExecutionSummary(['SELECT * FROM customers', 'SELECT * FROM customers']), 'SELECT customers · 2구문');
assert.equal(sqlResultTitle({ queryLabel: 'SELECT customers', runNumber: 3 }), 'SELECT customers · #3');
assert.match(sqlResultTitle({ id: 'legacy' }, [{ statement: 'DELETE FROM orders WHERE token=\'secret\'' }]), /^DELETE orders/);
assert.equal(sqlResultTitle({ id: 'legacy' }), 'SQL 결과 · legacy');
assert.equal(DRIVERS.length, 5);
const alpha = { id: 'a', root: '/a' }, beta = { id: 'b', root: '/b' };
const documentId = openDatabaseDocument({ kind: 'sql', source: { id: 'source', password: 'never-store' } }, alpha);
assert.equal(databaseDocumentState(alpha).tabs[0].spec.kind, 'console');
assert.equal(databaseDocumentState(alpha).tabs[0].spec.source, undefined);
assert.equal(databaseDocumentState(beta).tabs.length, 0);
assert.equal(saved.get('ade.editor-mode')[projectKey(alpha)], 'database');
assert.equal(openDatabaseDocument({ kind: 'console', source_id: 'source' }, alpha), documentId);
assert.equal(databaseDocumentState(alpha).tabs.length, 1, 'opening the same target selects its existing stable tab');
assert.equal(databaseDocumentKey({ source_id: 's', kind: 'ddl', selection: [{ kind: 'table', name: 'x' }, { kind: 'table', name: 'y' }] }), databaseDocumentKey({ source_id: 's', kind: 'ddl', selection: [{ kind: 'table', name: 'y' }, { kind: 'table', name: 'x' }] }));
publishDatabaseExecution(alpha, { id: 'job', state: 'running', results: [{ rows: [['raw-data']] }] }, { spec: { source_id: 'source', kind: 'console' }, statements: ['raw SQL'] });
assert.equal(databaseExecutionState(alpha).records[0].results, undefined);
assert.equal(databaseExecutionState(alpha).records[0].statements, undefined);
closeDatabaseExecution('job', alpha); assert.equal(databaseExecutionState(alpha).records[0].closed, true);
closeDatabaseDocument(documentId, alpha); assert.equal(databaseDocumentState(alpha).tabs.length, 0);
assert.equal(Object.keys(validateSource({ name: "Fixture", driver: "sqlite", path: "/tmp/fixture.db" })).length, 0);
assert.ok(validateSource({ name: "", driver: "unknown", path: "relative", port: -1 }).name);
assert.equal(sourceDraft({ password: "transient", has_password: true }).password, undefined);
const table = { kind: "table", name: "表", database: "db", schema: "s", table: "表" };
assert.notEqual(catalogKey("one", table), catalogKey("two", table));
assert.notEqual(catalogKey("one", table), catalogKey("one", { ...table, schema: "other" }));
assert.equal(ddlSelection([table, { ...table }, { kind: "schema", name: "s", database: "db", schema: "s" }]).length, 1);
assert.equal(ddlSelection([table, { kind: "database", name: "db" }])[0].kind, "database");
const service = new DatabaseService();
await service.save({ name: "Fixture", driver: "sqlite", path: "/tmp/fixture.db", has_password: true, password_storage: "fake" });
assert.equal(calls.at(-1).method, "db_save"); assert.equal(calls.at(-1).body.database.source.has_password, undefined);
assert.equal(calls.at(-1).body.database.source.password, undefined);
await service.rows({ source_id: "fixture", table: "表" }, { limit: 2000, offset: -1 });
assert.equal(calls.at(-1).body.database.limit, 1000); assert.equal(calls.at(-1).body.database.offset, 0);
const page = { columns: [{ name: "id" }, { name: "name" }], rows: [[1, "before"], [2, null]], primary_keys: ["id"] };
const changes = new TableChanges(page), beforeStage = calls.length;
changes.update(0, "name", "after"); changes.remove(1);
assert.equal(calls.length, beforeStage, "editing is entirely local until Apply");
assert.equal(changes.payload()[0].original.name, "before"); assert.equal(changes.payload()[1].original.name, null);
let fail = true;
const applyService = { apply: async (_target, payload) => { assert.equal(payload[0].original.id, 1); if (fail) throw new Error("conflict"); return { affected_rows: 2 }; } };
await assert.rejects(changes.apply(applyService, {}), /conflict/); assert.equal(changes.dirty, true);
fail = false; await changes.apply(applyService, {}); assert.equal(changes.dirty, false);
changes.update(0, "name", "locked"); let applied;
const committing = changes.apply({ apply: () => new Promise(resolve => { applied = resolve; }) }, {});
assert.throws(() => changes.update(0, "name", "racing"), /반영 중/); assert.throws(() => changes.revert(), /반영 중/);
applied({ affected_rows: 1 }); await committing;
const noKey = new TableChanges({ ...page, primary_keys: [] }); assert.throws(() => noKey.update(0, "name", "x"), /기본 키/);
const inserted = noKey.insert({ name: "new" }); noKey.update(inserted, "name", "newer"); assert.equal(noKey.payload()[0].values.name, "newer"); noKey.remove(inserted); assert.equal(noKey.dirty, false);
const sql = "-- prefix\nSELECT 'a;''b', \"semi;\"; /* x; /* nested */ */ SELECT 2;";
assert.equal(splitSQL(sql).length, 2);
assert.equal(splitSQL("DO $tag$ BEGIN RAISE NOTICE ';'; END $tag$; SELECT 2;", "postgres").length, 2);
assert.equal(splitSQL("SELECT E'escaped\\\';inside';SELECT 2;", "postgres").length, 2);
const mysql = "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nSELECT 3;";
assert.equal(splitSQL(mysql, "mysql").length, 2);
assert.equal(new SQLScript(mysql, "mysql").candidates().at(-1).statements.length, 2);
assert.equal(splitSQL("DECLARE @x int; SET @x=1; SELECT @x;\nGO\nSELECT 2;", "sqlserver").length, 2);
assert.throws(() => splitSQL("SELECT 1\nGO 2", "sqlserver"), /GO/);
assert.throws(() => splitSQL("SELECT 'unterminated"), /끝나지/);
assert.equal(splitSQL("-- only comment\n/* comment */").length, 0);
const nestedText = "SELECT * FROM (SELECT id FROM t WHERE id IN (SELECT id FROM u)) x; SELECT 2;";
const candidates = new SQLScript(nestedText).candidates({ head: nestedText.indexOf("FROM u") });
assert.equal(candidates[0].kind, "nested"); assert.match(candidates[0].text, /SELECT id FROM u/);
assert.ok(!candidates.some(candidate => candidate.kind === "selection"), "a caret alone is not an invented selection");
const selected = new SQLScript("SELECT 1; SELECT 2;").candidates({ start: 10, end: 18, head: 18 });
assert.equal(selected[0].text, "SELECT 2");
const job = new QueryJob({ query: async () => ({ job_id: "job" }), job: async () => ({ state: "completed", results: [] }), cancel: async () => ({ state: "cancelled" }) });
await job.start({}, ["SELECT 1"]); assert.equal(job.running, true); await job.cancel(); assert.equal(job.state.state, "cancelled");
let oldProgress;
const orderedJob = new QueryJob({ query: async () => ({ job_id: 'ordered' }), job: () => new Promise(resolve => { oldProgress = resolve; }), cancel: async () => ({ state: 'cancelled' }) });
await orderedJob.start({}, ['SELECT 1']); const oldPoll = orderedJob.refresh(); await orderedJob.cancel();
oldProgress({ state: 'running' }); await oldPoll; assert.equal(orderedJob.state.state, 'cancelled', 'late poll cannot undo cancellation');
const publishedJob = new QueryJob({ query: async () => ({ job_id: 'published' }), job: async () => ({ id: 'published', state: 'completed', results: [{ rows: [['private result']], statement: 'private SQL' }] }) }, { context: alpha, name: 'SQL fixture' });
await publishedJob.start({ source_id: 'source' }, ['private SQL']); await publishedJob.refresh();
const published = databaseExecutionState(alpha).records.find(record => record.jobId === 'published');
assert.equal(published.resultCount, 1); assert.equal(published.spec.source_id, 'source');
assert.equal(published.results, undefined); assert.equal(published.statements, undefined);
assert.equal(publishedJob.state.results[0].rows[0][0], 'private result', 'full results remain local to the requesting instance');
assert.equal(published.queryLabel, 'SQL'); assert.ok(published.runNumber > 0);
const anotherJob = new QueryJob({ query: async () => ({ job_id: 'another' }) }, { context: alpha, sourceName: 'Fixture DB' });
await anotherJob.start({ source_id: 'source' }, ["SELECT * FROM customers WHERE password='literal-private'"]);
const anotherRecord = databaseExecutionState(alpha).records.find(record => record.id === 'another');
assert.equal(anotherRecord.queryLabel, 'SELECT customers'); assert.equal(anotherRecord.sourceName, 'Fixture DB');
assert.ok(anotherRecord.runNumber > published.runNumber);
assert.equal(JSON.stringify(databaseExecutionState(alpha)).includes('literal-private'), false);
const repeatJob = new QueryJob({ query: async () => ({ job_id: 'repeat' }) }, { context: alpha, sourceName: 'Fixture DB' });
await repeatJob.start({ source_id: 'source' }, ["SELECT * FROM customers WHERE password='another-private'"]);
const repeatRecord = databaseExecutionState(alpha).records.find(record => record.id === 'repeat');
assert.equal(repeatRecord.queryLabel, anotherRecord.queryLabel); assert.ok(repeatRecord.runNumber > anotherRecord.runNumber);
assert.notEqual(sqlResultTitle(repeatRecord), sqlResultTitle(anotherRecord));
assert.equal(JSON.stringify(databaseExecutionState(alpha)).includes('another-private'), false);

const result = { columns: ["id", "한글", "null", "binary"], rows: [["9223372036854775807", 'a,"b\n한글😀', null, { type: "binary", base64: "AAH/" }], ["2", "\\N", "base64:literal", null]] };
for (const format of ["csv", "tsv", "json"]) {
  const parsed = parseImport(extractData(result, { format }), format);
  assert.deepEqual(parsed.columns, result.columns); assert.deepEqual(parsed.rows, result.rows, `${format} must preserve Unicode, NULL, binary and numeric strings`);
}
assert.equal(binaryHex("AAH/"), "0001ff"); assert.throws(() => binaryHex("bad!"));
assert.equal(quoteIdentifier('a"b', "postgres"), '"a""b"'); assert.equal(quoteIdentifier("a]b", "sqlserver"), "[a]]b]");
assert.equal(sqlLiteral("한글'", "sqlserver"), "N'한글'''" );
assert.match(sqlLiteral("a\\'한글😀", "mysql"), /^CONVERT\(X'[a-f0-9]+' USING utf8mb4\)$/);
assert.equal(sqlLiteral({ type: "binary", base64: "AAH/" }, "sqlite"), "X'0001ff'");
assert.match(extractData(result, { format: "sql-where", columnIndices: [2], rowIndices: [0] }), /IS NULL/);
assert.throws(() => extractData(result, { format: "sql-update", target: { table: "t" } }), /기본 키/);
assert.match(extractData(result, { format: "sql-update", driver: "postgres", target: { schema: "s", table: "t" }, keyColumns: ["id"] }), /UPDATE "s"\."t"/);
assert.match(extractData(result, { format: "html" }), /data-null="true"/);
assert.match(extractData(result, { format: "xml" }), /name="한글"/);
const big = parseImport('[{"id":9223372036854775807,"amount":0.1234567890123456789}]', "json");
assert.equal(big.rows[0][0], "9223372036854775807"); assert.equal(big.rows[0][1], "0.1234567890123456789");
const preview = prepareImport(big, { columns: [{ name: "id", data_type: "bigint" }, { name: "amount", data_type: "decimal" }] });
assert.equal(preview.errors.length, 0); assert.equal(preview.changes[0].values.amount, "0.1234567890123456789");
assert.equal(prepareImport({ columns: ["id"], rows: [["not-int"]] }, { columns: [{ name: "id", data_type: "integer" }] }).changes.length, 0);
assert.throws(() => parseImport('a,b\n"unterminated', "csv"));
assert.throws(() => parseImport("a,a\n1,2", "csv"));
assert.throws(() => parseImport("a,b\n1", "csv"));
assert.throws(() => parseImport('{9223372036854775807:1}', 'json'));
assert.throws(() => extractData({ columns: ['big'], rows: [[9007199254740992]] }, { format: 'json' }), /손실/);
assert.equal(prepareImport({ columns: ['blob'], rows: [[{ type: 'binary', base64: 'AA==' }]] }, { columns: [{ name: 'blob', data_type: 'text' }] }).changes.length, 0);
const reserved = prepareImport(parseImport('[{"__proto__":"literal"}]', 'json'), { columns: ['__proto__'] });
assert.equal(reserved.changes[0].values.__proto__, 'literal');
assert.equal(calls.some(call => ["db_query", "db_apply", "db_delete"].includes(call.method)), false, "fixtures do not mutate any real profile or database");
console.log("ADE database model/extractor: profiles, scoped catalog/DDL, explicit optimistic writes, SQL ranges/dialects, job cancellation, lossless extraction/import preview passed");

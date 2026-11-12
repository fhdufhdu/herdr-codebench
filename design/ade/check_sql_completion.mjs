import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Load deployed local ESM in a GPUI-like realm with no DOM or host services.
const root = new URL('../../mods/ade/', import.meta.url);
const context = vm.createContext({});
const loaded = new Map();
async function load(url) {
  if (loaded.has(url.href)) return loaded.get(url.href);
  assert.ok(url.href.startsWith(root.href), 'local SQL-only imports');
  const module = new vm.SourceTextModule(await readFile(url, 'utf8'), {context, identifier: fileURLToPath(url)});
  loaded.set(url.href, module);
  await module.link(specifier => load(new URL(specifier, url)));
  return module;
}
const engine = await load(new URL('sql-completion.js', root));
await engine.evaluate();
const {completeSQL, referencedTables} = engine.namespace;
const catalog = {driver: 'sqlite', tables: [
  {name: 'users', schema: 'main', columns: [{name: 'id', type: 'INTEGER'}, {name: 'name'}, {name: 'email'}, {name: 'display name'}, {name: 'select'}]},
  {name: 'orders', schema: 'main', columns: [{name: 'id'}, {name: 'user_id'}, {name: 'total'}]},
  {name: 'items', schema: 'sales', columns: [{name: 'sku'}, {name: 'price'}]},
  {name: 'Order Details', schema: 'main', columns: [{name: 'Line Item'}, {name: 'a"b'}]},
]};
function complete(marked, schema = catalog) {
  const offset = marked.indexOf('|'); assert.ok(offset >= 0, marked);
  const sql = marked.slice(0, offset) + marked.slice(offset + 1);
  return {sql, offset, result: completeSQL(sql, offset, schema)};
}
function labels(marked, schema) { return Array.from(complete(marked, schema).result.items, item => item.label); }
function has(marked, expected, schema) {
  const actual = labels(marked, schema);
  for (const label of expected) assert.ok(actual.includes(label), `${marked}: missing ${label}; ${actual.join(', ')}`);
}
function lacks(marked, unexpected, schema) {
  const actual = labels(marked, schema);
  for (const label of unexpected) assert.ok(!actual.includes(label), `${marked}: unexpected ${label}`);
}

has('SELECT * FROM |', ['users', 'orders', 'main', 'sales']);
has('SELECT * FROM us|', ['users']);
lacks('SELECT * FROM us|', ['orders', 'email']);
has('SELECT * FROM main.|', ['users', 'orders', 'Order Details']);
lacks('SELECT * FROM main.|', ['items']);
has('SELECT * FROM sales.it|', ['items']);
has('SELECT na| FROM users', ['name']);
has('SELECT | FROM users', ['id', 'name', 'email']);
has('SELECT u.| FROM users u', ['id', 'email']);
has('SELECT o.to| FROM users AS u LEFT OUTER JOIN orders AS o ON o.user_id=u.id', ['total']);
has('SELECT | FROM users u JOIN orders o ON o.user_id=u.id', ['u.id', 'o.id', 'email', 'total']);
has('SELECT id| FROM users u JOIN orders o ON o.user_id=u.id', ['u.id', 'o.id']);
lacks('SELECT | FROM users u JOIN orders o ON o.user_id=u.id', ['id']);
has('SELECT | FROM users u, orders o', ['email', 'total']);
has('SELECT * FROM users u WHERE u.|', ['name']);
has('SELECT * FROM users u JOIN orders o ON o.|', ['user_id']);
assert.equal(complete('SELECT missing.| FROM users u').result.items.length, 0);
assert.equal(complete('SELECT u.| FROM missing u').result.items.length, 0);
lacks('SELECT | FROM missing', ['id', 'email', 'total']);

has('WITH recent AS (SELECT user_id, total AS amount FROM orders) SELECT r.| FROM recent r', ['user_id', 'amount']);
lacks('WITH recent AS (SELECT user_id, total AS amount FROM orders) SELECT r.| FROM recent r', ['id', 'total']);
has('WITH c(uid, label) AS (SELECT id, name FROM users) SELECT c.| FROM c', ['uid', 'label']);
has('WITH c AS (SELECT * FROM users), d AS (SELECT name AS title FROM c) SELECT d.| FROM d', ['title']);
has('WITH c AS (SELECT * FROM users) SELECT * FROM |', ['c']);
has('SELECT q.| FROM (SELECT u.name, u.email FROM users u) AS q', ['name', 'email']);
has('SELECT q.| FROM (SELECT COUNT(*) AS total FROM users) q', ['total']);
has('SELECT q.| FROM (SELECT * FROM users) q', ['name', 'email']);
has('SELECT q.| FROM (SELECT name FROM users) q(label)', ['label']);
has('WITH RECURSIVE c(id) AS (SELECT id FROM users UNION ALL SELECT c.id FROM c) SELECT c.| FROM c', ['id']);
lacks('WITH c AS (SELECT * FROM users) SELECT | FROM orders', ['email']);
lacks('SELECT | FROM users u WHERE EXISTS (SELECT 1 FROM orders hidden)', ['total', 'hidden']);
has('SELECT * FROM users u WHERE EXISTS (SELECT u.| FROM orders o)', ['email']);
lacks('SELECT * FROM users u WHERE EXISTS (SELECT u.| FROM orders u)', ['email']);
has('SELECT * FROM users u WHERE EXISTS (SELECT u.| FROM orders u)', ['total']);
assert.equal(complete('SELECT * FROM users u JOIN (SELECT u.|) q ON 1=1').result.items.length, 0);
has('SELECT * FROM users u JOIN LATERAL (SELECT u.|) q ON 1=1', ['email']);
has('SELECT | FROM users UNION SELECT * FROM orders', ['email']);
lacks('SELECT | FROM users UNION SELECT * FROM orders', ['total']);
has('SELECT * FROM users UNION SELECT | FROM orders', ['total']);
lacks('SELECT * FROM users UNION SELECT | FROM orders', ['email']);
has('SELECT name AS title FROM users ORDER BY ti|', ['title']);
has('SELECT * FROM users u WHERE EXISTS (SELECT | FROM orders o)', ['id', 'email', 'total']);
lacks('SELECT q.| FROM (SELECT name + total FROM users) q', ['total']);

const duplicateTables = {driver: 'sqlite', tables: [
  {name: 'users', database: 'main', schema: 'main', columns: [{name: 'name'}]},
  {name: 'users', database: 'temp', schema: 'temp', columns: [{name: 'other'}]},
]};
has('SELECT * FROM us|', ['main.users', 'temp.users'], duplicateTables);
lacks('SELECT * FROM us|', ['main.main.users', 'temp.temp.users'], duplicateTables);
assert.equal(complete('SELECT users.| FROM users', duplicateTables).result.items.length, 0);
has('SELECT users.| FROM main.users', ['name'], duplicateTables);
const postgresTables = {...duplicateTables, driver: 'postgres', tables: duplicateTables.tables.map(t => ({...t, database: 'app'}))};
has('SELECT * FROM us|', ['main.users', 'temp.users'], postgresTables);
const mssqlTables = {...postgresTables, driver: 'mssql'};
has('SELECT * FROM us|', ['app.main.users', 'app.temp.users'], mssqlTables);

has('SELECT * FROM "main"."Or|der Details"', ['Order Details']);
let quoted = complete('SELECT d."Li|ne Item" FROM "Order Details" AS d');
assert.equal(quoted.result.items.find(i => i.label === 'Line Item').insertText, '"Line Item"');
assert.equal(quoted.sql.slice(quoted.result.from, quoted.result.to), '"Line Item"');
assert.equal(complete('SELECT d.a| FROM "Order Details" d').result.items.find(i => i.label === 'a"b').insertText, '"a""b"');
assert.equal(complete('SELECT se| FROM users').result.items.find(i => i.label === 'select').insertText, '"select"');
const mysql = {...catalog, driver: 'mysql'};
assert.equal(complete('SELECT `display|` FROM users', mysql).result.items.find(i => i.label === 'display name').insertText, '`display name`');
const mssql = {...catalog, driver: 'mssql'};
assert.equal(complete('SELECT [display|] FROM users', mssql).result.items.find(i => i.label === 'display name').insertText, '[display name]');
for (const sql of ["SELECT 'na|me' FROM users", "SELECT 'unterminated|", 'SELECT -- na|me\n * FROM users',
  'SELECT /* na|me */ * FROM users', 'SELECT /* unterminated|']) assert.equal(complete(sql).result.items.length, 0, sql);
assert.equal(complete('SELECT $$ na|me $$ FROM users', {...catalog, driver: 'postgres'}).result.items.length, 0);
assert.equal(complete('SELECT # na|me\n * FROM users', mysql).result.items.length, 0);
has('SELECT /* ignored FROM orders */ na| FROM users', ['name']);
has('SELECT * FROM orders; SELECT na| FROM users', ['name']);
lacks('SELECT * FROM orders; SELECT | FROM users', ['total']);
lacks('SELECT * FROM users; SELECT o.|', ['total']);
has('SELECT * FROM users; |', ['SELECT']);
has('SELECT | FROM users -- trailing', ['email']);
has('WITH c AS (SELECT name FROM users) SELECT * FROM -- trailing\n |', ['c']);
has('WITH c AS (SELECT name FROM users) SELECT * FROM /* trailing */\n |', ['c']);
has('SELECT na| FROM users WHERE (', ['name']);
has('SELECT COALESCE((SELECT u.| FROM users u), 0)', ['email']);
has('SELECT name FROM users WHERE EXISTS (SELECT | FROM orders', ['total']);

const unicode = complete("SELECT '😀' AS emoji, na|me FROM users");
assert.equal(unicode.result.from, unicode.sql.indexOf('name'));
assert.equal(unicode.result.to, unicode.sql.indexOf('name') + 4);
const applied = unicode.sql.slice(0, unicode.result.from) + unicode.result.items.find(i => i.label === 'name').insertText + unicode.sql.slice(unicode.result.to);
assert.equal(applied, unicode.sql);
const metadataBefore = JSON.stringify(catalog);
completeSQL('SELECT u. FROM users u', 9, catalog);
assert.equal(JSON.stringify(catalog), metadataBefore, 'metadata remains untouched');
const refs = Array.from(referencedTables('WITH c AS (SELECT * FROM main.users) SELECT * FROM c JOIN (SELECT * FROM sales.items) q ON 1=1', 80, 'sqlite'), item => JSON.parse(JSON.stringify(item)));
assert.deepEqual(refs, [{name: 'users', schema: 'main'}, {name: 'items', schema: 'sales'}]);
has('SEL|', ['SELECT'], {tables: []});
has('SELECT CO|', ['COUNT', 'COALESCE'], {tables: []});
assert.ok(complete('SELECT * FROM |', {tables: Array.from({length: 500}, (_, i) => ({name: 'table_' + i}))}).result.items.length <= 100);
assert.equal(completeSQL(' '.repeat(250001), 1).reason, 'input-too-large');
assert.equal(completeSQL('SELECT ' + '('.repeat(70) + '1' + ')'.repeat(70), 0).reason, 'analysis-limit');
assert.equal(completeSQL('SELECT ' + 'x,'.repeat(11000) + 'x', 0).reason, 'analysis-limit');
console.log('PASS SQL completion: headless parser, scopes, joins, CTEs, derived/correlated queries, dialect quotes, comments, UTF16, references, caps');

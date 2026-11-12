// Headless SQL completion. The vendored Lezer SQL parser owns tokenization,
// quoting, comments, statement boundaries and balanced/incomplete parentheses.
// This module resolves those syntax nodes against caller-provided metadata only.
import { parseSQL, sqlDialectSpec } from './sql-parser-vendor.js';

const MAX_ITEMS = 100;
const MAX_TEXT = 250000;
const MAX_DEPTH = 64;
const MAX_NODES = 20000;
const key = value => String(value || '').toLowerCase();
const identifier = token => token && (token.kind === 'Identifier' || token.kind === 'QuotedIdentifier');
const word = (token, value) => token && token.kind !== 'QuotedIdentifier' && token.upper === value;
const closeQuote = quote => quote === '[' ? ']' : quote;
const unquote = text => {
  const opening = text[0];
  if (!['"', '`', '['].includes(opening)) return text;
  const closing = closeQuote(opening);
  const body = text.slice(1, text.endsWith(closing) && text.length > 1 ? -1 : undefined);
  return body.split(closing + closing).join(closing);
};

function syntax(text, driver) {
  const tree = parseSQL(text, driver), leaves = [];
  let nodeCount = 0, limited = false;
  function nodes(node, depth = 0) {
    if (depth > MAX_DEPTH) { limited = true; return []; }
    const result = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (++nodeCount > MAX_NODES) { limited = true; break; }
      if (child.name === 'Parens') {
        const children = nodes(child, depth + 1);
        result.push({kind: 'group', from: child.from, to: child.to,
          closed: text[child.to - 1] === ')', tokens: children.filter(t => t.kind !== '(' && t.kind !== ')')});
      } else if (child.firstChild) result.push(...nodes(child, depth + 1));
      else if (child.to > child.from) {
        const value = text.slice(child.from, child.to);
        const token = {kind: child.name, from: child.from, to: child.to, text: value,
          value: unquote(value), upper: value.toUpperCase()};
        leaves.push(token);
        if (!['LineComment', 'BlockComment'].includes(child.name)) result.push(token);
      }
    }
    return result;
  }
  const statements = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (limited) break;
    if (node.name === 'Statement') statements.push({from: node.from, to: node.to, tokens: nodes(node)});
  }
  // Comments may sit outside a Statement. A separate tree walk also catches
  // deeply nested literals that the bounded scope walk deliberately ignores.
  const protectedTokens = [];
  const cursor = tree.cursor();
  let walked = 0;
  do {
    if (++walked > MAX_NODES) { limited = true; break; }
    if (['String', 'Bits', 'Bytes', 'LineComment', 'BlockComment'].includes(cursor.name))
      protectedTokens.push({kind: cursor.name, from: cursor.from, to: cursor.to});
  } while (cursor.next());
  leaves.sort((a, b) => a.from - b.from || a.to - b.to);
  return {statements, leaves, protectedTokens, limited};
}

function statementAt(parsed, offset, text) {
  for (const statement of parsed.statements) {
    if (offset >= statement.from && offset <= statement.to) {
      if (offset === statement.to && text[offset - 1] === ';') continue;
      return statement;
    }
  }
  // Whitespace after an unfinished statement belongs to that statement.
  const previous = parsed.statements.filter(s => s.to <= offset).pop();
  if (previous && text[previous.to - 1] !== ';') {
    let position = previous.to, trivia = true;
    for (const token of parsed.protectedTokens) {
      if (!['LineComment', 'BlockComment'].includes(token.kind) || token.from < position || token.from > offset) continue;
      if (text.slice(position, token.from).trim()) { trivia = false; break; }
      position = Math.min(offset, token.to);
    }
    if (trivia && !text.slice(position, offset).trim()) return {...previous, to: offset};
  }
  return {from: offset, to: text.length, tokens: []};
}

function pathAt(tokens, start) {
  if (!identifier(tokens[start])) return null;
  const parts = [tokens[start].value];
  let end = start + 1;
  while (tokens[end]?.text === '.' && identifier(tokens[end + 1])) {
    parts.push(tokens[end + 1].value); end += 2;
  }
  return {parts, end};
}
function reference(parts) {
  const ref = {name: parts[parts.length - 1]};
  if (parts.length > 1) ref.schema = parts[parts.length - 2];
  if (parts.length > 2) ref.database = parts[parts.length - 3];
  return ref;
}
function matchingTables(tables, parts) {
  return tables.filter(table => key(table.name) === key(parts[parts.length - 1]) &&
    (parts.length < 2 || key(table.schema || table.database) === key(parts[parts.length - 2])) &&
    (parts.length < 3 || key(table.database) === key(parts[parts.length - 3])));
}
function splitOnComma(tokens) {
  const groups = [[]];
  for (const token of tokens) {
    if (token.text === ',') groups.push([]); else groups[groups.length - 1].push(token);
  }
  return groups;
}
const clauseWords = new Set(['SELECT', 'FROM', 'JOIN', 'ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING',
  'LIMIT', 'OFFSET', 'RETURNING', 'SET', 'VALUES', 'USING', 'WINDOW', 'QUALIFY', 'INTO', 'UPDATE']);
const sourceEnd = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'RETURNING',
  'WINDOW', 'QUALIFY', 'UNION', 'EXCEPT', 'INTERSECT', 'SET', 'VALUES']);

function analyze(statement, tables) {
  const scopes = [], references = [], seenReferences = new Set();
  const analyzedGroups = new Set();
  function remember(parts) {
    const ref = reference(parts), id = JSON.stringify(ref);
    if (!seenReferences.has(id)) { seenReferences.add(id); references.push(ref); }
  }
  function container(tokens, parent, inherited, bounds, depth = 0) {
    if (depth > MAX_DEPTH) return [];
    const contentFrom = bounds.kind === 'group' ? bounds.from + 1 : bounds.from;
    const contentTo = bounds.kind === 'group' && bounds.closed ? bounds.to - 1 : bounds.to;
    const ctes = new Map(inherited), cteGroups = new Set();
    let mainStart = 0;
    if (word(tokens[0], 'WITH')) {
      let i = word(tokens[1], 'RECURSIVE') ? 2 : 1;
      for (;;) {
        if (!identifier(tokens[i])) break;
        const name = tokens[i++].value;
        let explicit = null;
        if (tokens[i]?.kind === 'group') explicit = tokens[i++].tokens.filter(identifier).map(t => ({name: t.value}));
        if (!word(tokens[i], 'AS')) break;
        i++;
        if (word(tokens[i], 'NOT')) i++;
        if (word(tokens[i], 'MATERIALIZED')) i++;
        const group = tokens[i];
        if (group?.kind !== 'group') break;
        const relation = {name, explicit, query: null};
        // A recursive CTE exposes only its explicit columns until its anchor
        // projection is known; cycle detection prevents recursive expansion.
        if (word(tokens[1], 'RECURSIVE')) ctes.set(key(name), relation);
        relation.query = container(group.tokens, null, ctes, group, depth + 1)[0] || null;
        ctes.set(key(name), relation); cteGroups.add(group); analyzedGroups.add(group);
        i++;
        if (tokens[i]?.text !== ',') { mainStart = i; break; }
        i++;
      }
    }
    const branches = [];
    let start = mainStart;
    for (let i = mainStart; i <= tokens.length; i++) {
      if (i === tokens.length || ['UNION', 'INTERSECT', 'EXCEPT'].some(w => word(tokens[i], w))) {
        const branch = tokens.slice(start, i);
        if (branch.some(t => word(t, 'SELECT') || word(t, 'UPDATE') || word(t, 'DELETE') || word(t, 'INSERT'))) {
          const scope = {tokens: branch, parent, ctes, sources: [],
            from: start === mainStart ? contentFrom : (tokens[start]?.from ?? contentTo),
            to: i === tokens.length ? contentTo : tokens[i].from};
          scopes.push(scope); branches.push(scope);
        }
        start = i + 1;
        if (word(tokens[start], 'ALL') || word(tokens[start], 'DISTINCT')) start++;
      }
    }
    for (const scope of branches) {
      let inFrom = false, expecting = false;
      for (let i = 0; i < scope.tokens.length; i++) {
        const token = scope.tokens[i];
        if (sourceEnd.has(token.upper)) inFrom = false;
        if (word(token, 'FROM') || word(token, 'JOIN') || word(token, 'UPDATE') || word(token, 'INTO')) {
          inFrom = true; expecting = true; continue;
        }
        if (inFrom && token.text === ',') { expecting = true; continue; }
        if (!expecting) continue;
        if (word(token, 'LATERAL') || word(token, 'ONLY')) continue;
        let relation, end = i + 1;
        const path = pathAt(scope.tokens, i);
        if (path) {
          end = path.end;
          const cte = path.parts.length === 1 && ctes.get(key(path.parts[0]));
          if (cte) relation = {name: path.parts[0], definition: cte};
          else {
            remember(path.parts);
            const matched = matchingTables(tables, path.parts);
            relation = {name: path.parts[path.parts.length - 1], parts: path.parts,
              // An ambiguous unqualified table is deliberately unresolved.
              columns: matched.length === 1 ? matched[0].columns || [] : []};
          }
          // Table-valued functions are not catalog tables.
          if (scope.tokens[end]?.kind === 'group') { relation.columns = []; end++; }
        } else if (token.kind === 'group') {
          const lateral = word(scope.tokens[i - 1], 'LATERAL');
          const visibleParent = lateral ? {...scope, sources: scope.sources.slice()} : null;
          relation = {name: '', query: container(token.tokens, visibleParent, ctes, token, depth + 1)[0] || null};
          analyzedGroups.add(token);
        } else { expecting = false; continue; }
        if (word(scope.tokens[end], 'AS')) end++;
        if (identifier(scope.tokens[end])) relation.alias = scope.tokens[end++].value;
        if (relation.alias && scope.tokens[end]?.kind === 'group') {
          relation.explicit = scope.tokens[end++].tokens.filter(identifier).map(t => ({name: t.value}));
        }
        scope.sources.push(relation); expecting = false; i = end - 1;
      }
      function nested(tokens) {
        for (const token of tokens) if (token.kind === 'group' && !analyzedGroups.has(token) && !cteGroups.has(token)) {
          analyzedGroups.add(token);
          const child = container(token.tokens, scope, ctes, token, depth + 1);
          if (!child.length) nested(token.tokens);
        }
      }
      nested(scope.tokens);
    }
    // Containers such as EXISTS((SELECT ...)) may have no query at this level.
    if (!branches.length) for (const token of tokens) if (token.kind === 'group' && !analyzedGroups.has(token)) {
      analyzedGroups.add(token); container(token.tokens, parent, ctes, token, depth + 1);
    }
    return branches;
  }
  container(statement.tokens, null, new Map(), statement);
  return {scopes, references};
}

function relationColumns(relation, visiting = new Set()) {
  if (visiting.size > MAX_DEPTH) return [];
  if (relation.explicit) return relation.explicit;
  if (relation.columns) return relation.columns;
  if (visiting.has(relation)) return [];
  const next = new Set(visiting); next.add(relation);
  if (relation.definition) return relationColumns(relation.definition, next);
  return relation.query ? projection(relation.query, next) : [];
}
function relationNamed(scope, qualifier) {
  for (let current = scope; current; current = current.parent) {
    const found = current.sources.filter(source => key(source.alias || source.name) === key(qualifier[qualifier.length - 1]) &&
      (qualifier.length === 1 || (!source.alias && source.parts &&
        source.parts.slice(-qualifier.length).every((part, i) => key(part) === key(qualifier[i])))));
    if (found.length) return found;
  }
  return [];
}
function projection(scope, visiting) {
  const index = scope.tokens.findIndex(t => word(t, 'SELECT'));
  if (index < 0) return [];
  const end = scope.tokens.findIndex((t, i) => i > index && word(t, 'FROM'));
  const selected = scope.tokens.slice(index + 1, end < 0 ? undefined : end);
  while (word(selected[0], 'DISTINCT') || word(selected[0], 'ALL')) selected.shift();
  const fields = [];
  for (const expression of splitOnComma(selected)) {
    const as = expression.findIndex(t => word(t, 'AS'));
    if (as >= 0 && identifier(expression[as + 1])) { fields.push({name: expression[as + 1].value}); continue; }
    const last = expression[expression.length - 1];
    const prior = expression[expression.length - 2];
    if (identifier(last) && (identifier(prior) || prior?.kind === 'group' ||
      ['Number', 'String', 'Null', 'Type'].includes(prior?.kind) || word(prior, 'END'))) {
      fields.push({name: last.value}); continue;
    }
    if (last?.text === '*') {
      const prefix = expression.slice(0, -2).filter(identifier).map(t => t.value);
      const sources = prefix.length ? relationNamed(scope, prefix) : scope.sources;
      for (const source of sources) fields.push(...relationColumns(source, visiting));
    } else {
      const path = pathAt(expression, 0);
      if (path && path.end === expression.length) fields.push({name: path.parts[path.parts.length - 1]});
    }
  }
  return [...new Map(fields.map(field => [key(field.name), field])).values()];
}

function prepare(text, offset, catalog) {
  const parsed = syntax(text, catalog.driver);
  const statement = statementAt(parsed, offset, text);
  const analyzed = parsed.limited ? {scopes: [], references: []} :
    analyze(statement, Array.isArray(catalog.tables) ? catalog.tables : []);
  const scope = analyzed.scopes.filter(s => offset >= s.from && offset <= s.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] || null;
  return {parsed, statement, ...analyzed, scope};
}

/** Base relations in the current statement (including CTE/derived bodies).
 * Catalog/UI code can load their columns before calling completeSQL again.
 * Offsets and replacement ranges use JavaScript UTF16 string indices. */
export function referencedTables(text, offset, driver = '') {
  text = String(text || ''); offset = Math.max(0, Math.min(text.length, Number(offset) || 0));
  if (text.length > MAX_TEXT) return [];
  return prepare(text, offset, {tables: [], driver}).references;
}

export function completeSQL(text, offset, catalog = {}) {
  text = String(text || ''); offset = Math.max(0, Math.min(text.length, Number(offset) || 0));
  const empty = {from: offset, to: offset, items: [], references: []};
  if (text.length > MAX_TEXT) return {...empty, incomplete: true, reason: 'input-too-large'};
  const {parsed, references, scope, statement} = prepare(text, offset, catalog);
  if (parsed.limited) return {...empty, incomplete: true, reason: 'analysis-limit'};
  if (parsed.protectedTokens.some(token => offset > token.from && offset <= token.to))
    return {...empty, references, reason: 'literal-or-comment'};
  const active = parsed.leaves.find(t => ['Identifier', 'QuotedIdentifier', 'Keyword', 'Builtin', 'Type'].includes(t.kind) &&
    t.from < offset && t.to >= offset);
  const from = active ? active.from : offset, to = active ? active.to : offset;
  const quote = active?.kind === 'QuotedIdentifier' ? active.text[0] : '';
  const rawPrefix = active ? text.slice(active.from, offset) : '';
  const prefix = key(quote ? unquote(rawPrefix) : rawPrefix);
  const before = parsed.leaves.filter(t => t.to <= from && t.from >= statement.from &&
    !['LineComment', 'BlockComment'].includes(t.kind));
  const qualifier = [];
  for (let i = before.length - 1; before[i]?.text === '.' && identifier(before[i - 1]); i -= 2)
    qualifier.unshift(before[i - 1].value);
  let clause = '';
  for (const token of scope?.tokens || statement.tokens) {
    if (token.from >= from) break;
    if (clauseWords.has(token.upper)) clause = token.upper;
  }
  const tableContext = ['FROM', 'JOIN', 'INTO', 'UPDATE'].includes(clause);
  const spec = sqlDialectSpec(catalog.driver);
  const defaultQuote = spec.identifierQuotes?.includes('"') ? '"' : spec.identifierQuotes?.[0] || '"';
  const reserved = new Set((spec.keywords || '').toLowerCase().split(/\s+/));
  const quoteName = (name, forced = '') => {
    if (!forced && /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(name) && !reserved.has(key(name))) return name;
    const opening = forced || defaultQuote, closing = closeQuote(opening);
    return opening + name.split(closing).join(closing + closing) + closing;
  };
  const items = [], seen = new Set();
  function add(label, name, detail, qualified = false, filterName = name) {
    if (!key(filterName).startsWith(prefix) && !key(label).startsWith(prefix)) return;
    const insertText = qualified ? name : quoteName(name, quote);
    const id = key(insertText);
    if (seen.has(id)) return;
    seen.add(id); items.push({label, insertText, ...(detail ? {detail} : {})});
  }
  const tables = Array.isArray(catalog.tables) ? catalog.tables : [];
  const tableCounts = new Map();
  if (tableContext && !qualifier.length) for (const table of tables)
    tableCounts.set(key(table.name), (tableCounts.get(key(table.name)) || 0) + 1);
  if (tableContext) {
    if (!qualifier.length) {
      for (const [name, relation] of scope?.ctes || []) add(relation.name, relation.name, 'CTE');
      for (const table of tables) {
        if (tableCounts.get(key(table.name)) > 1 && (table.schema || table.database)) {
          // SQLite/MySQL report the database as the schema too. PostgreSQL
          // cannot refer to another database in a relation path. Only MSSQL
          // uses all three catalog components for this completion contract.
          const namespace = ['mssql', 'sqlserver'].includes(key(catalog.driver)) ?
            [table.database, table.schema].filter(Boolean) : [table.schema || table.database];
          const path = [...namespace, table.name];
          add(path.join('.'), path.map(part => quoteName(part, quote)).join('.'), 'table', true, table.name);
        } else add(table.name, table.name, [table.schema || table.database, 'table'].filter(Boolean).join(' · '));
        if (table.schema) add(table.schema, table.schema, 'schema');
        else if (table.database) add(table.database, table.database, 'database');
      }
    } else {
      for (const table of tables) {
        const namespace = [table.database, table.schema].filter(Boolean);
        if (namespace.length >= qualifier.length && namespace.slice(-qualifier.length).every((part, i) => key(part) === key(qualifier[i])))
          add(table.name, table.name, 'table');
        if (table.database && key(table.database) === key(qualifier[0]) && qualifier.length === 1 && table.schema)
          add(table.schema, table.schema, 'schema');
      }
    }
  } else if (qualifier.length) {
    for (const source of relationNamed(scope, qualifier))
      for (const column of relationColumns(source)) add(column.name, column.name,
        [source.alias || source.name, column.type].filter(Boolean).join(' · '));
  } else {
    const sources = [], names = new Set();
    let level = 0;
    for (let current = scope; current; current = current.parent, level++) for (const source of current.sources) {
      const name = source.alias || source.name;
      if (!names.has(key(name))) { names.add(key(name)); sources.push({source, level}); }
    }
    const columnCounts = new Map(), columnLevels = new Map();
    for (const {source, level} of sources) for (const column of relationColumns(source)) {
      const id = key(column.name);
      if (!columnLevels.has(id)) columnLevels.set(id, level);
      if (columnLevels.get(id) === level) columnCounts.set(id, (columnCounts.get(id) || 0) + 1);
    }
    for (const {source, level} of sources) {
      for (const column of relationColumns(source)) {
        if (columnLevels.get(key(column.name)) !== level) continue;
        const name = source.alias || source.name;
        if (columnCounts.get(key(column.name)) > 1 && name && !quote)
          add(name + '.' + column.name, quoteName(name) + '.' + quoteName(column.name), column.type || 'column', true, column.name);
        else add(column.name, column.name, [name, column.type].filter(Boolean).join(' · '));
      }
      if (source.alias || source.name) add(source.alias || source.name, source.alias || source.name, 'relation');
    }
    if (['ORDER', 'GROUP', 'HAVING', 'QUALIFY'].includes(clause) && scope)
      for (const column of projection(scope, new Set())) add(column.name, column.name, 'output column');
  }
  if (!qualifier.length && !quote) {
    const keywords = tableContext ? ['SELECT', 'LATERAL'] :
      ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'AS', 'AND', 'OR',
        'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'NULL', 'IS NULL', 'WITH'];
    for (const name of keywords) {
      if (key(name).startsWith(prefix) && !seen.has(key(name))) {
        seen.add(key(name)); items.push({label: name, insertText: name, detail: 'keyword'});
      }
    }
    if (!tableContext) for (const name of ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'LOWER', 'UPPER', 'LENGTH', 'ROUND', 'ABS'])
      if (key(name).startsWith(prefix) && !seen.has(key(name))) items.push({label: name, insertText: name + '(', detail: 'function'});
  }
  return {from, to, items: items.slice(0, MAX_ITEMS), references, incomplete: items.length > MAX_ITEMS,
    context: tableContext ? 'table' : qualifier.length ? 'qualified-column' : 'expression'};
}

// Only direct projections from one base table can identify writable cells.
export function editableSelect(text, driver = '') {
  const parsed = syntax(String(text || ''), driver);
  if (parsed.limited || parsed.statements.length !== 1) return null;
  const tokens = parsed.statements[0].tokens.filter(token => token.text !== ';');
  if (!word(tokens[0], 'SELECT')) return null;
  const from = tokens.findIndex(token => word(token, 'FROM'));
  if (from < 2 || tokens.some(token => token.kind === 'Keyword' && ['JOIN', 'UNION', 'INTERSECT', 'EXCEPT', 'GROUP', 'HAVING', 'DISTINCT', 'INTO', 'WINDOW'].includes(token.upper))) return null;
  let at = from + 1;
  const parts = [];
  if (!identifier(tokens[at])) return null;
  parts.push(tokens[at++].value);
  while (tokens[at]?.text === '.' && identifier(tokens[at + 1])) { parts.push(tokens[at + 1].value); at += 2; }
  if (parts.length > 3) return null;
  if (word(tokens[at], 'AS')) at++;
  const alias = identifier(tokens[at]) ? tokens[at++].value : parts.at(-1);
  if (at < tokens.length && !['WHERE', 'ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'FOR'].some(value => word(tokens[at], value))) return null;
  const projections = [], projection = tokens.slice(1, from);
  for (let index = 0; index < projection.length;) {
    let token = projection[index++], qualifier = null;
    if (projection[index]?.text === '.') { qualifier = token.value; token = projection[index + 1]; index += 2; }
    if (qualifier && ![alias, parts.at(-1)].some(value => key(value) === key(qualifier))) return null;
    if (token?.text === '*') projections.push('*');
    else if (identifier(token)) projections.push(token.value);
    else return null;
    if (word(projection[index], 'AS')) { index++; if (!identifier(projection[index++])) return null; }
    else if (identifier(projection[index])) index++;
    if (index < projection.length && projection[index++]?.text !== ',') return null;
  }
  return { table: parts.at(-1), schema: parts.length > 1 ? parts.at(-2) : '', database: parts.length > 2 ? parts[0] : '', projections };
}

export function orderColumns(text, driver = '') {
  if (!text.trim()) return [];
  const parsed = syntax(`SELECT * FROM t ORDER BY ${text}`, driver);
  const tokens = parsed.statements[0]?.tokens ?? [], by = tokens.findIndex(token => word(token, 'BY'));
  const result = [];
  for (let at = by + 1; at < tokens.length;) {
    if (!identifier(tokens[at])) return null;
    const column = tokens[at++].value;
    const direction = word(tokens[at], 'DESC') ? 'DESC' : 'ASC';
    if (word(tokens[at], 'ASC') || word(tokens[at], 'DESC')) at++;
    result.push({ column, direction });
    if (at < tokens.length && tokens[at++]?.text !== ',') return null;
  }
  return result;
}

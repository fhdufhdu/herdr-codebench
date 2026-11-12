// Pure data and SQL helpers. No host/runtime imports.
const mysql = d => d === 'mysql' || d === 'mariadb';
const word = c => !!c && /[\p{L}\p{N}_$]/u.test(c);
function scan(text, dialect, visit) {
  for (let i = 0; i < text.length;) {
    const start = i, c = text[i], n = text[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if ((c === '-' && n === '-') || (mysql(dialect) && c === '#')) {
      i = text.indexOf('\n', i); if (i < 0) return; continue;
    }
    if (c === '/' && n === '*') {
      let depth = 1; i += 2;
      while (i < text.length && depth) {
        if (text.slice(i, i + 2) === '/*') { depth++; i += 2; }
        else if (text.slice(i, i + 2) === '*/') { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error('Unclosed SQL comment');
      if(mysql(dialect) && text[start+2] === '!') visit({start,end:i,kind:'quoted',value:text.slice(start,i)});
      continue;
    }
    const dollar = dialect === 'postgres' && c === '$' && text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
    if (dollar) {
      const end = text.indexOf(dollar[0], i + dollar[0].length);
      if (end < 0) throw new Error('Unclosed SQL dollar quote');
      i = end + dollar[0].length; visit({start, end:i, kind:'quoted', value:text.slice(start,i)}); continue;
    }
    if (c === "'" || c === '"' || c === '`' || (c === '[' && (dialect === 'sqlserver' || dialect === 'sqlite'))) {
      const close = c === '[' ? ']' : c;
      // PostgreSQL E'...' and MySQL strings support backslash escapes.
      const escapes = mysql(dialect) || (c === "'" && /[eE]/.test(text[start-1] || '') && !word(text[start-2]));
      let closed = false; i++;
      while (i < text.length) {
        if (escapes && text[i] === '\\') { i += 2; continue; }
        if (text[i] === close) {
          if (text[i+1] === close) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) throw new Error('Unclosed SQL quote');
      visit({start,end:i,kind:'quoted',value:text.slice(start,i)}); continue;
    }
    // Custom delimiters are detected by the consumer before token grouping.
    const consumed = visit({start,end:i+1,kind:'char',value:c});
    i += consumed || 1;
  }
}
function span(text, start, end, label) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end-1])) end--;
  return {start,end,text:text.slice(start,end),...(label ? {label} : {})};
}
export function splitSQL(text, {dialect = 'mysql'} = {}) {
  const parts = []; let begin = 0, delimiter = ';', hasCode = false, sqlServerRoutine = false;
  let create = false, createRoutine = false, sqliteTrigger = false, triggerBody = false, triggerClosed = false;
  const blocks = [];
  function emit(end) {
    if (sqliteTrigger && !triggerClosed) throw new Error('Incomplete SQLite trigger BEGIN/END body');
    if (hasCode) { const s = span(text,begin,end); if(s.text) parts.push(s); }
    hasCode = false; sqlServerRoutine = false; blocks.length = 0;
    create = false; createRoutine = false; sqliteTrigger = false; triggerBody = false; triggerClosed = false;
  }
  scan(text,dialect,t => {
    const lineStart = text.lastIndexOf('\n', t.start - 1) + 1;
    if (t.kind === 'char' && /^\s*$/.test(text.slice(lineStart,t.start))) {
      const lineEnd = text.indexOf('\n',t.start), end = lineEnd < 0 ? text.length : lineEnd;
      const line = text.slice(t.start,end).replace(/\r$/, '');
      const directive = mysql(dialect) && line.match(/^DELIMITER\s+(\S+)\s*$/i);
      if (directive) {
        if (hasCode) throw new Error('DELIMITER directive inside unfinished statement');
        delimiter = directive[1]; begin = end; return end-t.start;
      }
      if (dialect === 'sqlserver' && /^GO(?:\s+--.*)?\s*$/i.test(line)) {
        emit(lineStart); begin = end; return end-t.start;
      }
      if (dialect === 'sqlserver' && /^GO\s+\d+(?:\s|$)/i.test(line)) throw new Error('GO repetition is unsupported; expand batches explicitly');
    }
    if(mysql(dialect) && t.kind === 'quoted' && t.value.startsWith('/*!')) {
      // Versioned executable comments can carry CREATE/routine keywords too.
      const body=t.value.replace(/^\/\*!\d*\s*/, '');
      if(!hasCode && /^CREATE\b/i.test(body)) create = true;
      if(create && /\b(?:PROCEDURE|FUNCTION|TRIGGER)\b/i.test(body)) createRoutine = true;
      if(createRoutine && delimiter === ';' && /\bBEGIN\b/i.test(body)) throw new Error('MySQL compound routines require a custom DELIMITER before CREATE');
    }
    if (t.kind === 'char' && !word(text[t.start-1]) && /[A-Za-z]/.test(t.value)) {
      const keyword = text.slice(t.start).match(/^[A-Za-z]+/)[0].toUpperCase();
      if(!hasCode && keyword === 'CREATE') create = true;
      if(create && ['PROCEDURE','FUNCTION','TRIGGER'].includes(keyword)) createRoutine = true;
      if(dialect === 'sqlite' && create && keyword === 'TRIGGER') sqliteTrigger = true;
      if(mysql(dialect) && createRoutine && keyword === 'BEGIN' && delimiter === ';') {
        throw new Error('MySQL compound routines require a custom DELIMITER before CREATE');
      }
      if(dialect === 'sqlserver' || sqliteTrigger) {
        if(keyword === 'BEGIN' || keyword === 'CASE') {
          blocks.push(keyword);
          if(sqliteTrigger && keyword === 'BEGIN') triggerBody = true;
        } else if(keyword === 'END') {
          const closed = blocks.pop();
          if(sqliteTrigger && triggerBody && closed === 'BEGIN' && !blocks.includes('BEGIN')) triggerClosed = true;
        }
      }
      if(dialect === 'sqlserver' && !hasCode && /^CREATE\s+(?:OR\s+ALTER\s+)?(?:PROC(?:EDURE)?|TRIGGER|FUNCTION)\b/i.test(text.slice(t.start))) sqlServerRoutine=true;
    }
    if (t.kind === 'char' && text.startsWith(delimiter,t.start) &&
        !(dialect === 'sqlserver' && (sqlServerRoutine || blocks.includes('BEGIN'))) &&
        !(sqliteTrigger && blocks.includes('BEGIN'))) {
      emit(t.start); begin = t.start + delimiter.length; return delimiter.length;
    }
    hasCode = true;
  });
  emit(text.length); return parts;
}
export function queryCandidates(text, {start, end, caret = 0, dialect = 'mysql'} = {}) {
  if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
    if (start < 0 || end > text.length) throw new Error('Selection outside SQL text');
    return [{start,end,text:text.slice(start,end),label:'Selection'}];
  }
  const statements = splitSQL(text,{dialect});
  const current = statements.find(s => caret >= s.start && caret <= s.end) || statements.find(s => s.start >= caret) || statements[statements.length-1];
  if (!current) return [];
  const result = [], stack = [], nested = [];
  let compound = false;
  scan(current.text,dialect,t => {
    if (t.kind !== 'char') return;
    if (t.value === ';') compound = true;
    if (t.value === '(') stack.push(t.start);
    else if (t.value === ')' && stack.length) {
      const a = stack.pop();
      const inside = current.text.slice(a+1,t.start);
      // Only a complete parenthesized SELECT is a standalone nested candidate.
      if (/^\s*SELECT\b/i.test(inside)) {
        const s = span(text,current.start+a+1,current.start+t.start,'Nested SELECT');
        if(caret >= s.start && caret <= s.end) nested.push(s);
      }
    }
  });
  nested.sort((a,b) => (a.end-a.start)-(b.end-b.start));
  // A retained interior terminator belongs to an atomic block/batch. Its
  // subqueries may depend on trigger/routine variables and stay inside it.
  result.push(...(compound ? [] : nested), {...current,label:'Current statement'});
  // Script candidates retain client directives. Call splitSQL before transport.
  if (statements.length > 1) result.push(span(text,0,text.length,'Entire script'));
  return result.filter((s,i,a) => a.findIndex(x => x.start===s.start && x.end===s.end) === i);
}

export const EXTRACTORS = [
  {id:'csv',label:'CSV'}, {id:'tsv',label:'TSV'}, {id:'json',label:'JSON'},
  {id:'sql-insert',label:'SQL INSERT'}, {id:'sql-update',label:'SQL UPDATE'},
  {id:'where',label:'SQL WHERE'}, {id:'markdown',label:'Markdown'},
  {id:'html',label:'HTML'}, {id:'xml',label:'XML'},
];
const names = columns => columns.map(c => typeof c === 'string' ? c : c.name);
function binaryHex(v) {
  if(typeof v.hex === 'string' && /^(?:[0-9a-f]{2})*$/i.test(v.hex)) return v.hex;
  if(typeof v.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.base64)) throw new Error('Invalid binary base64');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits=0, count=0, hex='';
  for(const c of v.base64.replace(/=+$/, '')) {
    bits=(bits<<6)|alphabet.indexOf(c); count+=6;
    if(count>=8) {count-=8;hex+=((bits>>count)&255).toString(16).padStart(2,'0');bits &= (1<<count)-1;}
  }
  if(bits) throw new Error('Noncanonical binary base64');
  return hex;
}
function scalar(value) {
  if (value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number cannot be extracted');
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('Unsafe integer; provide its exact decimal string');
  if (['string','number','boolean'].includes(typeof value)) return value;
  if (value && typeof value === 'object' && value.type === 'binary' && Object.keys(value).length === 2 && (typeof value.hex === 'string' || typeof value.base64 === 'string')) {binaryHex(value);return value;}
  throw new Error('Unsupported value; binary requires {type:"binary",base64:"..."} or explicit hex');
}
function utf8Hex(s) {
  let result = '';
  for (const char of s) {
    const cp=char.codePointAt(0);
    if(cp>=0xD800 && cp<=0xDFFF) throw new Error('Unpaired Unicode surrogate');
    const bytes=cp<128 ? [cp] : cp<2048 ? [192|(cp>>6),128|(cp&63)] : cp<65536 ? [224|(cp>>12),128|((cp>>6)&63),128|(cp&63)] : [240|(cp>>18),128|((cp>>12)&63),128|((cp>>6)&63),128|(cp&63)];
    result+=bytes.map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  return result;
}
const display = v => v && typeof v === 'object' ? '0x'+binaryHex(v) : String(v);
function identifier(s, driver) {
  if (typeof s !== 'string' || !s) throw new Error('SQL identifier is required');
  if (mysql(driver)) return '`'+s.replace(/`/g,'``')+'`';
  if (driver === 'sqlserver') return '['+s.replace(/]/g,']]')+']';
  return '"'+s.replace(/"/g,'""')+'"';
}
function literal(v, driver) {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return driver === 'postgres' ? (v ? 'TRUE':'FALSE') : (v ? '1':'0');
  if (v && typeof v === 'object') {
    const hex=binaryHex(v);
    if(driver === 'postgres') return "decode('"+hex+"','hex')";
    return driver === 'sqlserver' ? '0x'+hex : "X'"+hex+"'";
  }
  // MySQL hex conversion avoids SQL_MODE-dependent backslash interpretation.
  if (mysql(driver) && /[\\\0\x1a]/.test(v)) return 'CONVERT(0x'+utf8Hex(v)+' USING utf8mb4)';
  if(v.includes('\0')) throw new Error('NUL is unsupported in this SQL text literal');
  return (driver === 'sqlserver' ? 'N' : '')+"'"+v.replace(/'/g,"''")+"'";
}
const escapeMarkup = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function extractData(data, format = 'csv', options = {}) {
  const columns = names(data.columns || []), rows = (data.rows || []).map(r => {
    if (!Array.isArray(r) || r.length !== columns.length) throw new Error('Row width differs from columns');
    return r.map(scalar);
  });
  const nullToken = options.nullToken ?? '\\N', headers = options.headers !== false;
  if (format === 'csv' || format === 'tsv') {
    const sep = format === 'csv' ? ',' : '\t';
    if(typeof nullToken !== 'string' || nullToken.includes(sep) || /[\"\r\n]/.test(nullToken)) throw new Error('NULL token must be one unquoted field');
    const field = v => {
      if(v === null) return nullToken;
      const s = display(v);
      return s === '' || s === nullToken || s.includes(sep) || /["\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    };
    return (headers ? [columns.map(field).join(sep)] : []).concat(rows.map(r=>r.map(field).join(sep))).join('\r\n');
  }
  if (format === 'json') {
    if(new Set(columns).size !== columns.length) throw new Error('JSON object columns must have distinct names');
    return JSON.stringify(rows.map(r=>Object.fromEntries(columns.map((n,i)=>[n,r[i]]))),null,2);
  }
  if (['sql-insert','sql-update','where'].includes(format)) {
    const driver = data.driver || 'mysql', q = s=>identifier(s,driver), val = v=>literal(v,driver);
    const keys = options.keys || data.primary_keys || [];
    const indices = keys.map(k=>columns.indexOf(k));
    if(format !== 'sql-insert' && (!keys.length || indices.some(i=>i<0))) throw new Error('SQL UPDATE/WHERE requires existing key columns');
    const where = r=>indices.map(i=>q(columns[i])+(r[i] === null ? ' IS NULL' : ' = '+val(r[i]))).join(' AND ');
    if(format === 'where') return rows.map(r=>'('+where(r)+')').join(' OR ');
    const qualifiers = driver === 'sqlserver' ? [data.database,data.schema,data.table] : mysql(driver) ? [data.database || data.schema,data.table] : [data.schema,data.table];
    const table = qualifiers.filter(Boolean).map(q).join('.');
    if(!data.table) throw new Error('SQL extraction requires a table');
    if(format === 'sql-insert') return rows.map(r=>'INSERT INTO '+table+' ('+columns.map(q).join(', ')+') VALUES ('+r.map(val).join(', ')+');').join('\n');
    const updates = columns.map((_,i)=>i).filter(i=>!indices.includes(i));
    if(!updates.length) throw new Error('SQL UPDATE has no non-key columns');
    return rows.map(r=>'UPDATE '+table+' SET '+updates.map(i=>q(columns[i])+' = '+val(r[i])).join(', ')+' WHERE '+where(r)+';').join('\n');
  }
  const cells = r=>r.map(v=>v === null ? nullToken : display(v));
  if(format === 'markdown') {
    const md = s=>String(s).replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');
    return [columns,columns.map(()=> '---'),...rows.map(cells)].map(r=>'| '+r.map(md).join(' | ')+' |').join('\n');
  }
  if(format === 'html') return '<table>\n<thead><tr>'+columns.map(n=>'<th>'+escapeMarkup(n)+'</th>').join('')+'</tr></thead>\n<tbody>\n'+rows.map(r=>'<tr>'+cells(r).map(v=>'<td>'+escapeMarkup(v)+'</td>').join('')+'</tr>').join('\n')+'\n</tbody></table>';
  if(format === 'xml') return '<rows>\n'+rows.map(r=>'  <row>'+r.map((v,i)=>'<field name="'+escapeMarkup(columns[i])+'"'+(v===null ? ' null="true"/>' : '>'+escapeMarkup(display(v))+'</field>')).join('')+'</row>').join('\n')+'\n</rows>';
  throw new Error('Unknown extractor: '+format);
}
export function parseImport(text, format = 'csv', options = {}) {
  if(format === 'json') {
    const rows = JSON.parse(text);
    if(!Array.isArray(rows) || rows.some(r=>!r || Array.isArray(r) || typeof r !== 'object')) throw new Error('JSON import expects an array of row objects');
    const columns = rows.length ? Object.keys(rows[0]) : [];
    if(rows.some(r=>Object.keys(r).length !== columns.length || columns.some(k=>!Object.prototype.hasOwnProperty.call(r,k)))) throw new Error('JSON rows have inconsistent columns');
    return {columns:columns.map(name=>({name})),rows:rows.map(r=>columns.map(n=>scalar(r[n])))};
  }
  if(format !== 'csv' && format !== 'tsv') throw new Error('Import supports CSV, TSV and JSON');
  if(!text) return {columns:[],rows:[]};
  const sep = format === 'csv' ? ',' : '\t', records = []; let row=[], value='', quoted=false, inQuote=false, afterQuote=false;
  const push = ()=>{ row.push({value,quoted}); value='';quoted=false;afterQuote=false; };
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(inQuote) { if(c === '"') { if(text[i+1] === '"') {value+='"';i++;} else {inQuote=false;afterQuote=true;} } else value+=c; continue; }
    if(c === '"') {if(value || afterQuote) throw new Error('Invalid quote in import');inQuote=true;quoted=true;continue;}
    if(c === sep) {push();continue;}
    if(c === '\r' || c === '\n') {push();records.push(row);row=[];if(c==='\r' && text[i+1]==='\n')i++;continue;}
    if(afterQuote) throw new Error('Unexpected text after closing quote');
    value+=c;
  }
  if(inQuote) throw new Error('Unclosed import quote');
  if(row.length || value || quoted || text.endsWith(sep)) {push();records.push(row);}
  const headers = options.headers !== false;
  const first=records[0] || [], columns=headers ? records.shift().map(c=>c.value) : (options.columns ? names(options.columns) : first.map((_,i)=>'column'+(i+1)));
  if(new Set(columns).size !== columns.length) throw new Error('Import headers must be distinct');
  if(records.some(r=>r.length !== columns.length)) throw new Error('Import row width differs from columns');
  const nullToken=options.nullToken ?? '\\N';
  return {columns:columns.map(name=>({name})),rows:records.map(r=>r.map(c=>!c.quoted && c.value===nullToken ? null : c.value))};
}

// Copy, preview and export share this deterministic formatter. No file writes.
export const EXTRACT_FORMATS = ["csv", "tsv", "json", "markdown", "html", "xml", "sql-insert", "sql-update", "sql-where"];
const names = columns => columns.map(column => typeof column === "string" ? column : column.name);
const binary = value => value && typeof value === "object" && value.type === "binary" && typeof value.base64 === "string";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function binaryHex(base64) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error("올바르지 않은 base64 바이너리입니다.");
  let bits = 0, count = 0, hex = "";
  for (const char of base64.replace(/=+$/, "")) {
    bits = (bits << 6) | alphabet.indexOf(char); count += 6;
    if (count >= 8) { count -= 8; hex += ((bits >>> count) & 255).toString(16).padStart(2, "0"); }
  }
  return hex;
}
function utf8Hex(text) {
  const bytes = [];
  for (const char of text) {
    const point = char.codePointAt(0);
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | point >> 6, 0x80 | point & 63);
    else if (point < 0x10000) bytes.push(0xe0 | point >> 12, 0x80 | point >> 6 & 63, 0x80 | point & 63);
    else bytes.push(0xf0 | point >> 18, 0x80 | point >> 12 & 63, 0x80 | point >> 6 & 63, 0x80 | point & 63);
  }
  return bytes.map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function quoteIdentifier(value, driver = "sqlite") {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("SQL 식별자를 확인하세요.");
  if (["mysql", "mariadb"].includes(driver)) return `\`${value.replace(/`/g, "``")}\``;
  if (driver === "sqlserver") return `[${value.replace(/\]/g, "]]")}]`;
  return `"${value.replace(/"/g, '""')}"`;
}
export function sqlLiteral(value, driver = "sqlite") {
  if (value === null) return "NULL";
  if (binary(value)) {
    if (driver === "postgres") { binaryHex(value.base64); return `decode('${value.base64}','base64')`; }
    const hex = binaryHex(value.base64);
    return driver === "sqlserver" ? `0x${hex}` : `X'${hex}'`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("정밀도를 보존할 수 없는 숫자입니다. 문자열로 제공하세요.");
    return String(value);
  }
  if (typeof value === "boolean") return driver === "sqlserver" ? value ? "1" : "0" : value ? "TRUE" : "FALSE";
  if (typeof value !== "string") throw new Error("지원하지 않는 셀 값입니다.");
  if (["mysql", "mariadb"].includes(driver)) return `CONVERT(X'${utf8Hex(value)}' USING utf8mb4)`;
  if (value.includes("\0")) {
    if (driver === "postgres") throw new Error("PostgreSQL text는 NUL 문자를 지원하지 않습니다.");
    if (driver === "sqlserver") return value.split("\0").map(part => `N'${part.replace(/'/g, "''")}'`).join(" + NCHAR(0) + ");
    return `CAST(X'${utf8Hex(value)}' AS TEXT)`;
  }
  if (driver === "postgres") return `E'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  return `${driver === "sqlserver" ? "N" : ""}'${value.replace(/'/g, "''")}'`;
}
function qualified(target, driver) {
  if (!target?.table) throw new Error("SQL 출력의 대상 테이블을 선택하세요.");
  const parts = driver === "postgres" ? [target.schema, target.table] : ["mysql", "mariadb"].includes(driver)
    ? [target.database, target.table] : driver === "sqlserver" ? [target.database, target.schema, target.table] : [target.schema, target.table];
  return parts.filter(Boolean).map(part => quoteIdentifier(part, driver)).join(".");
}
const scalar = value => value === null ? "\\N" : binary(value) ? `base64:${value.base64}` : typeof value === "object" ? JSON.stringify(value) : String(value);
const markup = text => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function delimitedCell(value, separator) {
  const text = scalar(value);
  return value !== null && (text === "\\N" || text.startsWith("base64:") && !binary(value) || text.includes(separator) || /["\r\n]/.test(text))
    ? `"${text.replace(/"/g, '""')}"` : text;
}
function formatData(result, options = {}) {
  const { format = "csv", header = true, driver = "sqlite", target, keyColumns = [] } = options;
  if (!EXTRACT_FORMATS.includes(format)) throw new Error("지원하지 않는 추출 형식입니다.");
  const allNames = names(result.columns), columns = options.columnIndices ?? allNames.map((_name, i) => i), indices = options.rowIndices ?? result.rows.map((_row, i) => i);
  if (columns.some(i => !Number.isInteger(i) || i < 0 || i >= allNames.length) || indices.some(i => !Number.isInteger(i) || i < 0 || i >= result.rows.length)) throw new Error("추출할 행 또는 열 범위를 확인하세요.");
  const headers = columns.map(i => allNames[i]), rows = indices.map(i => columns.map(column => result.rows[i][column]));
  if (!headers.length) throw new Error("추출할 열이 없습니다.");
  for (const row of rows) for (const value of row) {
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (binary(value)) { binaryHex(value.base64); continue; }
    if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) continue;
    throw new Error("셀 값을 손실 없이 추출할 수 없습니다. 큰 정수는 문자열로 제공하세요.");
  }
  if (format === "json") {
    if (new Set(headers).size !== headers.length) throw new Error("JSON 출력에는 중복되지 않는 열 이름이 필요합니다.");
    return JSON.stringify(rows.map(row => Object.fromEntries(headers.map((name, i) => [name, row[i]]))), null, 2);
  }
  if (format === "csv" || format === "tsv") {
    const separator = format === "csv" ? "," : "\t";
    return [...(header ? [headers.map(value => delimitedCell(value, separator)).join(separator)] : []), ...rows.map(row => row.map(value => delimitedCell(value, separator)).join(separator))].join("\r\n");
  }
  if (format === "markdown") {
    const cell = value => scalar(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
    return [`| ${headers.map(cell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(row => `| ${row.map(cell).join(" | ")} |`)].join("\n");
  }
  if (format === "html") return `<table>\n<thead><tr>${headers.map(name => `<th>${markup(name)}</th>`).join("")}</tr></thead>\n<tbody>\n${rows.map(row => `<tr>${row.map(value => `<td${value === null ? ' data-null="true"' : binary(value) ? ' data-type="binary"' : ""}>${markup(scalar(value))}</td>`).join("")}</tr>`).join("\n")}\n</tbody>\n</table>`;
  if (format === "xml") return `<rows>\n${rows.map(row => `  <row>${row.map((value, i) => `<cell name="${markup(headers[i])}"${value === null ? ' null="true"' : binary(value) ? ' type="binary"' : ""}>${value === null ? "" : markup(scalar(value))}</cell>`).join("")}</row>`).join("\n")}\n</rows>`;
  const whereNames = keyColumns.length ? keyColumns : headers;
  if (whereNames.some(name => !allNames.includes(name))) throw new Error("WHERE 기본 키 열이 결과에 없습니다.");
  if (format === "sql-update" && !keyColumns.length) throw new Error("SQL UPDATE 출력에는 명시적 기본 키 열이 필요합니다.");
  return indices.map((rowIndex, i) => {
    const source = result.rows[rowIndex], row = rows[i];
    const where = whereNames.map(name => {
      const value = source[allNames.indexOf(name)];
      return `${quoteIdentifier(name, driver)}${value === null ? " IS NULL" : ` = ${sqlLiteral(value, driver)}`}`;
    }).join(" AND ");
    if (format === "sql-where") return `WHERE ${where}`;
    const table = qualified(target, driver);
    if (format === "sql-insert") return `INSERT INTO ${table} (${headers.map(name => quoteIdentifier(name, driver)).join(", ")}) VALUES (${row.map(value => sqlLiteral(value, driver)).join(", ")});`;
    return `UPDATE ${table} SET ${headers.map((name, column) => `${quoteIdentifier(name, driver)} = ${sqlLiteral(row[column], driver)}`).join(", ")} WHERE ${where};`;
  }).join("\n");
}
export function extractData(result, options = {}) {
  const text = formatData(result, options);
  let size = 0;
  for (const char of text) { const point = char.codePointAt(0); size += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4; }
  if (size > 16 * 1024 * 1024) throw new Error("추출 결과가 16 MiB를 넘습니다. 범위를 줄이세요.");
  return text;
}

export function parseDelimited(text, separator = ",") {
  const rows = []; let row = [], field = "", quoted = false, inQuote = false, afterQuote = false;
  const pushField = () => { row.push({ value: field, quoted }); field = ""; quoted = false; afterQuote = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuote) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { inQuote = false; afterQuote = true; }
      else field += char;
    } else if (char === separator) pushField();
    else if (char === "\n" || char === "\r") { if (char === "\r" && text[i + 1] === "\n") i++; pushRow(); }
    else if (char === '"' && !field && !afterQuote) { inQuote = true; quoted = true; }
    else if (afterQuote) throw new Error("인용 필드 뒤에 구분자 이외의 문자가 있습니다.");
    else if (char === '"') throw new Error("필드 중간의 따옴표를 이중 인용하세요.");
    else field += char;
  }
  if (inQuote) throw new Error("가져오기 인용 필드가 끝나지 않았습니다.");
  if (field || quoted || row.length) pushRow();
  return rows;
}
function protectedJSON(text) {
  JSON.parse(text); // Validate syntax before the precision-preserving rewrite.
  let result = "", quoted = false;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (quoted) { result += char; i++; if (char === "\\") { result += text[i++] ?? ""; } else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; result += char; i++; continue; }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if (number) {
      const value = number[0]; result += /[.eE]/.test(value) || !Number.isSafeInteger(Number(value)) ? JSON.stringify(value) : value; i += value.length;
    } else { result += char; i++; }
  }
  return JSON.parse(result);
}
function validateParsed(columns, rows) {
  if (!columns.length || columns.some(name => typeof name !== "string" || !name) || new Set(columns).size !== columns.length) throw new Error("가져오기 열 이름이 비어 있거나 중복됩니다.");
  if (rows.some(row => !Array.isArray(row) || row.length !== columns.length)) throw new Error("가져오기 행의 열 수가 일치하지 않습니다.");
  return { columns, rows };
}
export function parseImport(text, format = "csv") {
  if (format === "csv" || format === "tsv") {
    const parsed = parseDelimited(text.replace(/^\uFEFF/, ""), format === "csv" ? "," : "\t");
    if (!parsed.length) throw new Error("가져올 데이터가 없습니다.");
    return validateParsed(parsed[0].map(field => field.value), parsed.slice(1).map(row => row.map(field =>
      !field.quoted && field.value === "\\N" ? null : !field.quoted && field.value.startsWith("base64:")
        ? { type: "binary", base64: field.value.slice(7) } : field.value)));
  }
  if (format !== "json") throw new Error("가져오기는 CSV, TSV, JSON을 지원합니다.");
  const value = protectedJSON(text);
  if (value && !Array.isArray(value) && Array.isArray(value.columns) && Array.isArray(value.rows)) return validateParsed(names(value.columns), value.rows);
  if (!Array.isArray(value) || !value.length || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("JSON 가져오기는 행 객체 배열이어야 합니다.");
  const columns = Object.keys(value[0]);
  if (value.some(row => Object.keys(row).length !== columns.length || columns.some(name => !Object.hasOwn(row, name)))) throw new Error("JSON 행의 열 이름이 일치하지 않습니다.");
  return validateParsed(columns, value.map(row => columns.map(name => row[name])));
}
export function prepareImport(parsed, { columns, mapping, limit = 1000 } = {}) {
  const schema = columns.map(column => typeof column === "string" ? { name: column } : column), targetNames = schema.map(column => column.name);
  const map = mapping ?? Object.fromEntries(parsed.columns.filter(name => targetNames.includes(name)).map(name => [name, name]));
  const errors = [], changes = [], assigned = Object.values(map).filter(Boolean);
  if (parsed.rows.length > limit) errors.push(`가져오기는 한 번에 ${limit}행까지 지원합니다.`);
  if (!assigned.length || new Set(assigned).size !== assigned.length) errors.push("대상 열 매핑이 비어 있거나 중복됩니다.");
  if (Object.keys(map).some(name => !parsed.columns.includes(name)) || assigned.some(name => !targetNames.includes(name))) errors.push("알 수 없는 열 매핑입니다.");
  for (const column of schema) if (column.nullable === false && !column.generated && !column.has_default && !assigned.includes(column.name)) errors.push(`필수 열 매핑: ${column.name}`);
  for (let rowIndex = 0; rowIndex < Math.min(parsed.rows.length, limit); rowIndex++) {
    const row = parsed.rows[rowIndex], values = Object.create(null);
    for (const [source, target] of Object.entries(map)) {
      if (!target) continue;
      const column = schema.find(item => item.name === target); if (!column) continue;
      let value = row[parsed.columns.indexOf(source)];
      const type = (column.data_type ?? "").toLowerCase();
      try {
        if (value === null) { if (column.nullable === false) throw new Error("NULL을 허용하지 않습니다."); }
        else if (column.generated) throw new Error("생성 열에는 가져올 수 없습니다.");
        else if (binary(value)) {
          binaryHex(value.base64);
          if (type && !/blob|binary|bytea|image/.test(type)) throw new Error("바이너리 대상 열이 아닙니다.");
        } else if (/blob|binary|bytea|image/.test(type)) throw new Error("명시적 바이너리 값이 필요합니다.");
        else if (/bool|^bit$/.test(type)) {
          if (![true, false, 0, 1, "true", "false", "0", "1"].includes(value)) throw new Error("boolean 값이 아닙니다.");
          value = [true, 1, "true", "1"].includes(value);
        } else if (/int/.test(type)) {
          if (!/^[+-]?\d+$/.test(String(value)) || typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("정밀한 정수 값이 아닙니다.");
          value = String(value);
        } else if (/decimal|numeric|real|float|double/.test(type)) {
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(value))) throw new Error("숫자 값이 아닙니다.");
          value = String(value);
        } else if (typeof value === "object") throw new Error("지원하지 않는 객체 값입니다.");
        values[target] = value;
      } catch (error) { errors.push(`${rowIndex + 1}행 ${target}: ${error.message}`); }
    }
    changes.push({ op: "insert", values });
  }
  return { columns: assigned, rows: parsed.rows.slice(0, 20), changes: errors.length ? [] : changes, errors, count: parsed.rows.length };
}

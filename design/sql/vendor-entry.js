// Build-time adapter retains upstream SQL dialects, generated Lezer grammar and
// external tokenizer, without bringing CodeMirror's DOM editor services to GPUI.
import { StandardSQL, PostgreSQL, MySQL, MariaSQL, SQLite, MSSQL, PLSQL } from '@codemirror/lang-sql';
export const sqlDialects = {standard: StandardSQL, postgres: PostgreSQL, postgresql: PostgreSQL,
  mysql: MySQL, mariadb: MariaSQL, sqlite: SQLite, sqlite3: SQLite,
  sqlserver: MSSQL, mssql: MSSQL, oracle: PLSQL};
export function parseSQL(text, driver = '') {
  return (sqlDialects[String(driver).toLowerCase()] || StandardSQL).language.parser.parse(text);
}
export function sqlDialectSpec(driver = '') {
  const dialect = sqlDialects[String(driver).toLowerCase()] || StandardSQL;
  return {...dialect.spec, keywords: Object.keys(dialect.dialect.words).join(' ')};
}

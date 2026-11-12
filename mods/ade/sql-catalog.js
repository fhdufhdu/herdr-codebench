// Only catalog metadata crosses this boundary. Never pass connection credentials to a parser.
export class SQLCatalog {
  constructor(service, source, spec) {
    this.service = service;
    this.sourceId = source.id;
    this.driver = source.driver;
    this.database = spec.database || source.database || (source.driver === "sqlite" ? "main" : "");
    this.schema = spec.schema || ({ postgres: "public", sqlserver: "dbo", sqlite: "main" }[source.driver] ?? this.database);
    this.tables = null;
    this.loading = null;
    this.columns = new Map();
    this.scopes = new Set();
    this.error = "";
  }
  async load(cx) {
    if (this.tables) return this.tables;
    if (this.loading) return this.loading;
    if (!this.database) { this.error = "DB 트리의 데이터베이스·스키마에서 SQL 콘솔을 열면 테이블·컬럼을 추천합니다."; return []; }
    this.loading = (async () => {
      const reply = await this.service.catalog(this.sourceId, { kind: "schema", name: this.schema, database: this.database, schema: this.schema }, cx);
      this.tables = (reply.nodes ?? []).filter(node => ["table", "view"].includes(node.kind)).map(node => ({
        name: node.name, database: node.database || this.database, schema: node.schema || this.schema, columns: [],
      }));
      this.error = "";
      this.scopes.add(JSON.stringify([this.database, this.schema]));
      return this.tables;
    })();
    try { return await this.loading; }
    catch (error) { this.error = String(error?.message ?? error); return []; }
    finally { this.loading = null; }
  }
  async resolve(references, cx, current = () => true) {
    await this.load(cx);
    if (!current()) return [];
    if (this.tables) this.error = "";
    // The parser may include the same base table through several CTEs/aliases.
    const unique = new Map();
    for (const ref of references) {
      const database = ref.database || (this.driver === "mysql" || this.driver === "mariadb" ? ref.schema : "") || this.database;
      const schema = ref.schema || (this.driver === "mysql" || this.driver === "mariadb" ? database : this.schema);
      if (!database || !ref.name) continue;
      const scope = JSON.stringify([database, schema]);
      if (!this.scopes.has(scope) && this.scopes.size < 16) {
        try {
          const reply = await this.service.catalog(this.sourceId, { kind: "schema", name: schema, database, schema }, cx);
          if (!current()) return [];
          this.tables = [...(this.tables ?? []), ...(reply.nodes ?? []).filter(node => ["table", "view"].includes(node.kind)).map(node => ({ name: node.name, database, schema, columns: [] }))];
          this.scopes.add(scope);
        } catch (error) { if (current()) this.error = String(error?.message ?? error); }
      }
      const known = this.tables?.find(table => table.database === database && table.schema === schema && table.name.toLowerCase() === ref.name.toLowerCase());
      if (!known) continue; // An incomplete FROM prefix is not a table to inspect.
      const key = JSON.stringify([database, schema, known.name]);
      unique.set(key, { name: known.name, database, schema });
    }
    const wanted = [...unique.entries()];
    // Bounded batches prevent a large script from opening hundreds of catalog requests.
    for (let start = 0; start < Math.min(wanted.length, 64) && current(); start += 4) {
      await Promise.all(wanted.slice(start, start + 4).map(async ([key, table]) => {
        if (this.columns.has(key)) return;
        try {
          const reply = await this.service.catalog(this.sourceId, { ...table, kind: "table", table: table.name }, cx);
          if (!current()) return;
          this.columns.set(key, { ...table, columns: (reply.nodes ?? []).filter(node => node.kind === "column").map(node => ({ name: node.name, type: node.data_type })) });
        } catch (error) { if (current()) this.error = String(error?.message ?? error); }
      }));
    }
    const tables = new Map((this.tables ?? []).map(table => [JSON.stringify([table.database, table.schema, table.name]), table]));
    for (const [key, table] of this.columns) tables.set(key, table);
    return [...tables.values()];
  }
}

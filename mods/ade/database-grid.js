import { quoteIdentifier } from './data-extract.js';
import { editableSelect, orderColumns } from './sql-completion.js';

export function cycleOrder(text, column, additive, driver) {
  const terms = orderColumns(text, driver);
  if (!terms) throw new Error('열 정렬을 사용하려면 ORDER BY에 열 이름과 ASC/DESC를 입력하세요.');
  const existing = terms.find(term => term.column === column);
  const next = existing?.direction === 'DESC' ? null : existing?.direction === 'ASC' ? 'DESC' : 'ASC';
  const result = additive ? terms.filter(term => term.column !== column) : [];
  if (next) {
    const index = additive && existing ? terms.indexOf(existing) : result.length;
    result.splice(index, 0, { column, direction: next });
  }
  return result.map(term => `${quoteIdentifier(term.column, driver)} ${term.direction}`).join(', ');
}

export async function tablePage(service, target, source, options, cx, current) {
  if (!options.where && !options.order) return service.rows(target, options, cx);
  const columns = await service.catalog(target.source_id, { ...target, kind: 'table', name: target.table }, cx);
  if (!current()) return null;
  const keys = (columns.nodes ?? []).filter(column => column.primary_key).map(column => column.name);
  const schema = target.schema || (['mysql', 'mariadb'].includes(source.driver) ? target.database : { postgres: 'public', sqlserver: 'dbo', sqlite: 'main' }[source.driver]);
  const table = [schema, target.table].filter(Boolean).map(name => quoteIdentifier(name, source.driver)).join('.');
  const order = options.order || keys.map(name => quoteIdentifier(name, source.driver)).join(', ');
  let sql = `SELECT * FROM ${table}${options.where ? ` WHERE (${options.where}\n)` : ''}${order ? ` ORDER BY ${order}` : ''}`;
  if (source.driver === 'sqlserver') sql += `${order ? '' : ' ORDER BY (SELECT NULL)'} OFFSET ${options.offset} ROWS FETCH NEXT ${options.limit + 1} ROWS ONLY`;
  else sql += ` LIMIT ${options.limit + 1} OFFSET ${options.offset}`;
  const started = await service.query(target, [sql], cx);
  if (!started.job_id) throw new Error("쿼리 작업 ID를 받지 못했습니다.");
  let job = { id: started.job_id, state: "queued" };
  try {
    while (['queued', 'running'].includes(job.state)) {
      if (!current()) { await service.cancel(job.id, cx); return null; }
      await cx.sleep(100);
      job = await service.job(job.id, cx);
    }
    if (job.state !== 'completed') throw new Error(job.error || '조회가 중단됐습니다.');
    const result = job.results?.[0];
    if (!result) throw new Error('조회 결과가 없습니다.');
    return { ...result, rows: result.rows.slice(0, options.limit), primary_keys: keys, offset: options.offset, limit: options.limit };
  } catch (error) {
    if (['queued', 'running'].includes(job.state)) await service.cancel(job.id, cx).catch(() => {});
    throw error;
  }
}

export async function resultTarget(service, record, data, cx) {
  const source = (await service.sources(cx)).sources.find(item => item.id === record.spec.source_id);
  const origin = source && editableSelect(data.statement, source.driver);
  if (!origin) return null;
  const schema = origin.schema || record.spec.schema || ({ postgres: 'public', sqlserver: 'dbo', sqlite: 'main' }[source.driver] ?? record.spec.database ?? source.database);
  const target = { source_id: source.id, database: origin.database || (['mysql', 'mariadb'].includes(source.driver) && origin.schema) || record.spec.database || source.database, schema, table: origin.table };
  const catalog = await service.catalog(source.id, { ...target, kind: 'schema', name: schema }, cx);
  if (!(catalog.nodes ?? []).some(node => node.kind === 'table' && node.name === origin.table)) return null;
  const reply = await service.catalog(source.id, { ...target, kind: 'table', name: target.table }, cx);
  const fields = (reply.nodes ?? []).filter(node => node.kind === 'column');
  const columns = origin.projections.flatMap(name => name === '*' ? fields.map(field => field.name) : [name]);
  const keys = fields.filter(field => field.primary_key).map(field => field.name);
  if (columns.length !== data.columns.length || new Set(columns).size !== columns.length || !keys.length || !keys.every(key => columns.includes(key)) || !columns.every(name => fields.some(field => field.name === name))) return null;
  return { target, source, page: { ...data, columns, primary_keys: keys } };
}

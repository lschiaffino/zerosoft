/**
 * Corre preguntas de Analytics: SQL o constructor, sobre los datos propios
 * (tablas virtuales con permisos) o sobre una base externa. Con caché de
 * resultados por persona y SQL, y tope de filas. Server-only.
 */
import { createHash } from 'crypto';
import { getDb } from '../db';
import { checkSqlWith } from '../analytics/sql-safe';
import { runReadOnly, SqlRunError } from '../analytics/sql-run';
import { isBiAdmin, type BiViewer } from './access';
import { applyParams, buildSql, BuildError } from './builder';
import { ExternalDbError, introspect, runExternal } from './external';
import { cacheGet, cachePut, databaseConfig, databaseSchema, saveDatabaseSchema } from './store';
import { ZS_GUARD, ZS_TABLE_NAMES, zsCtes, zsSchema } from './zs-tables';
import { ZS_SOURCE, type BiQuery, type BiResult, type ColumnType, type SchemaTable } from './types';

/** Filas que devuelve una pregunta como mucho (la tabla pagina en el cliente). */
export const BI_MAX_ROWS = 2000;
/** Segundos que vale un resultado en caché. */
export const BI_CACHE_TTL = Number(process.env.ANALYTICS_CACHE_TTL) || 300;
const CONCURRENCY = Number(process.env.ANALYTICS_QUERY_CONCURRENCY) || 4;

export class RunError extends Error {
  constructor(
    public code: string,
    public detail?: string,
    public status = 400,
  ) {
    super(code);
  }
}

let running = 0;
let tableNames: { at: number; names: string[] } | null = null;

async function realTables(): Promise<string[]> {
  if (tableNames && Date.now() - tableNames.at < 300_000) return tableNames.names;
  const rows = (await getDb().prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`).all()) as Array<{ name: string }>;
  tableNames = { at: Date.now(), names: rows.map((r) => String(r.name)) };
  return tableNames.names;
}

/** Esquema de una fuente para quien mira (navegador, constructor, AI). */
export async function sourceSchema(viewer: BiViewer, source: string): Promise<SchemaTable[]> {
  if (source === ZS_SOURCE) return zsSchema(viewer);
  const s = await databaseSchema(viewer.workspaceId, source);
  if (!s) throw new RunError('database_not_found', undefined, 404);
  return s;
}

/** Vuelve a leer tablas y columnas de una base externa. */
export async function syncDatabase(viewer: BiViewer, id: string): Promise<SchemaTable[]> {
  const cfg = await databaseConfig(viewer.workspaceId, id);
  if (!cfg) throw new RunError('database_not_found', undefined, 404);
  try {
    const tables = await introspect(cfg);
    await saveDatabaseSchema(viewer.workspaceId, id, tables);
    return tables;
  } catch (err) {
    throw toRunError(err);
  }
}

function toRunError(err: unknown): RunError {
  if (err instanceof RunError) return err;
  if (err instanceof BuildError) return new RunError(err.code, err.detail);
  if (err instanceof ExternalDbError) return new RunError(err.code === 'timeout' ? 'query_timeout' : err.code, err.detail, err.code === 'timeout' ? 408 : 400);
  if (err instanceof SqlRunError) return new RunError(err.code === 'timeout' ? 'query_timeout' : 'sql_error', err.detail?.replace(/\b(crm|track|books|groups|analytics|bi)_[a-z_]+/g, '…').slice(0, 300), err.code === 'timeout' ? 408 : 400);
  return new RunError('query_failed', err instanceof Error ? err.message.slice(0, 200) : undefined, 500);
}

function inferTypes(columns: string[], rows: unknown[][], hints: Map<string, ColumnType>): Array<{ name: string; type: ColumnType }> {
  return columns.map((name, i) => {
    const hint = hints.get(name.toLowerCase());
    if (hint) return { name, type: hint };
    let type: ColumnType | null = null;
    for (const r of rows.slice(0, 50)) {
      const v = r[i];
      if (v === null || v === undefined || v === '') continue;
      const t: ColumnType = typeof v === 'number' ? 'number' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/.test(v) ? 'date' : 'text';
      if (type && type !== t) return { name, type: 'text' as ColumnType };
      type = t;
    }
    return { name, type: type ?? 'text' };
  });
}

export interface RunOptions {
  values?: Record<string, string | undefined>;
  /** Saltar la caché (botón Actualizar, auto-refresh). */
  fresh?: boolean;
  /** Persona dueña de la ejecución para la caché (links públicos: quien lo creó). */
}

/** SQL final (sin CTEs) de una pregunta, con variables aplicadas. */
export async function compileQuery(viewer: BiViewer, source: string, query: BiQuery, values: Record<string, string | undefined> = {}): Promise<{ sql: string; dialect: 'sqlite' | 'postgres' | 'mysql' }> {
  let dialect: 'sqlite' | 'postgres' | 'mysql' = 'sqlite';
  if (source !== ZS_SOURCE) {
    const cfg = await databaseConfig(viewer.workspaceId, source);
    if (!cfg) throw new RunError('database_not_found', undefined, 404);
    dialect = cfg.engine;
    if (query.kind === 'sql' && cfg.sqlAccess === 'admins' && !isBiAdmin(viewer)) throw new RunError('sql_admins_only', undefined, 403);
  }
  try {
    if (query.kind === 'sql') return { sql: applyParams(query.sql, query.params, values, dialect), dialect };
    const schema = await sourceSchema(viewer, source);
    const built = buildSql(query, schema, dialect, dialect === 'sqlite' ? { allowedJoins: ZS_GUARD.joinKeys } : {});
    return { sql: built.sql, dialect };
  } catch (err) {
    throw toRunError(err);
  }
}

export async function runQuery(viewer: BiViewer, source: string, query: BiQuery, opts: RunOptions = {}): Promise<BiResult> {
  const { sql, dialect } = await compileQuery(viewer, source, query, opts.values);
  const key = createHash('sha256').update(JSON.stringify([viewer.workspaceId, viewer.personId, viewer.role, source, sql])).digest('hex');
  if (!opts.fresh) {
    const hit = await cacheGet(key);
    if (hit) return { ...(JSON.parse(hit) as BiResult), cached: true };
  }
  if (running >= CONCURRENCY) throw new RunError('busy', undefined, 429);
  running++;
  const started = Date.now();
  try {
    let result: BiResult;
    if (dialect === 'sqlite') {
      const check = checkSqlWith(sql, await realTables(), ZS_GUARD);
      if (!check.ok) throw new RunError(`sql_${check.error}`, check.detail);
      const used = ZS_TABLE_NAMES.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(check.sql));
      const ctes = await zsCtes(viewer, used);
      const full = `${ctes.sql}\nSELECT * FROM (\n${check.sql}\n) LIMIT ${BI_MAX_ROWS + 1}`;
      const res = await runReadOnly(full, ctes.args.map((a) => String(a)), BI_MAX_ROWS);
      const rows = res.rows.slice(0, BI_MAX_ROWS).map((r) => r.map((v) => (typeof v === 'bigint' ? Number(v) : typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v)));
      const hints = new Map<string, ColumnType>();
      for (const t of await zsSchema(viewer)) for (const c of t.columns) if (!hints.has(c.name)) hints.set(c.name, c.type);
      // Las fechas propias vienen como texto: el tipo sale del esquema solo para nombres que no son agregados.
      for (const k of [...hints.keys()]) if (hints.get(k) !== 'date') hints.delete(k);
      result = { columns: inferTypes(res.columns, rows, hints), rows, truncated: res.rows.length > BI_MAX_ROWS, sql, cached: false, ms: Date.now() - started };
    } else {
      const cfg = await databaseConfig(viewer.workspaceId, source);
      if (!cfg) throw new RunError('database_not_found', undefined, 404);
      const res = await runExternal(cfg, sql, BI_MAX_ROWS);
      result = { columns: res.columns, rows: res.rows, truncated: res.truncated, sql, cached: false, ms: Date.now() - started };
    }
    await cachePut(viewer.workspaceId, key, JSON.stringify(result), BI_CACHE_TTL).catch(() => undefined);
    return result;
  } catch (err) {
    throw toRunError(err);
  } finally {
    running--;
  }
}

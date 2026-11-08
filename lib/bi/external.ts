/**
 * Bases externas de Analytics (Postgres y MySQL). Server-only.
 *
 * Cada consulta abre su propia conexión (sin pool compartido entre
 * workspaces), resuelve el host con lib/bi/net-guard.ts y se conecta a esa
 * IP, corre adentro de una transacción de solo lectura con tope de tiempo del
 * lado del servidor y del cliente, envuelve el SQL para tener tope de filas,
 * usa el protocolo que acepta una sola sentencia y siempre termina con
 * ROLLBACK. La recomendación sigue siendo un usuario de la base que solo
 * pueda leer.
 */
import { isIP, connect as netConnect } from 'net';
import { resolveDbHost, validHostSyntax, validPort } from './net-guard';
import type { ColumnType, Engine, SchemaTable } from './types';

export interface DbConfig {
  engine: Engine;
  host: string;
  port: number;
  dbname: string;
  username: string;
  password: string;
  /** require: TLS sin validar el certificado; verify: TLS validado; disable: sin TLS. */
  ssl: 'require' | 'verify' | 'disable';
}

export class ExternalDbError extends Error {
  constructor(
    public code: 'invalid_config' | 'connect_failed' | 'timeout' | 'sql_error' | 'result_too_large' | 'private_host' | 'invalid_host' | 'unresolvable_host',
    public detail?: string,
  ) {
    super(code);
  }
}

export const EXT_TIMEOUT_MS = Number(process.env.ANALYTICS_DB_TIMEOUT_MS) || 15_000;
const CONNECT_TIMEOUT_MS = 8_000;
const MAX_CELL = 2_000;
const MAX_RESULT_BYTES = 10 * 1024 * 1024;

export function validateConfig(c: Partial<DbConfig>): c is DbConfig {
  return (
    (c.engine === 'postgres' || c.engine === 'mysql') &&
    typeof c.host === 'string' &&
    validHostSyntax(c.host) &&
    typeof c.port === 'number' &&
    validPort(c.port) &&
    typeof c.dbname === 'string' &&
    /^[^\0]{1,128}$/.test(c.dbname) &&
    typeof c.username === 'string' &&
    /^[^\0]{1,128}$/.test(c.username) &&
    typeof c.password === 'string' &&
    c.password.length <= 1024 &&
    (c.ssl === 'require' || c.ssl === 'verify' || c.ssl === 'disable')
  );
}

/** Quita el `;` final y rechaza más de una sentencia evidente. */
export function cleanUserSql(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (!s) throw new ExternalDbError('sql_error', 'empty');
  return s;
}

function cell(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return '[binary]';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > MAX_CELL ? s.slice(0, MAX_CELL) + '…' : s;
  }
  if (typeof v === 'string') return v.length > MAX_CELL ? v.slice(0, MAX_CELL) + '…' : v;
  return v;
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new ExternalDbError('timeout'));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function scrub(message: string, cfg: DbConfig): string {
  let m = message.slice(0, 400);
  if (cfg.password) m = m.split(cfg.password).join('•••');
  return m;
}

// Tipos de Postgres por OID (los comunes): número, fecha, booleano.
const PG_NUMBER = new Set([20, 21, 23, 26, 700, 701, 1700, 790]);
const PG_DATE = new Set([1082, 1114, 1184, 1083, 1266]);

export interface ExternalResult {
  columns: Array<{ name: string; type: ColumnType }>;
  rows: unknown[][];
  truncated: boolean;
}

async function guardHost(cfg: DbConfig): Promise<string> {
  try {
    return await resolveDbHost(cfg.host);
  } catch (err) {
    const code = (err as { code?: string }).code;
    throw new ExternalDbError(code === 'private_host' || code === 'invalid_host' || code === 'unresolvable_host' ? code : 'invalid_host');
  }
}

async function runPostgres(cfg: DbConfig, sql: string, maxRows: number, timeoutMs: number): Promise<ExternalResult> {
  const ip = await guardHost(cfg);
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: ip,
    port: cfg.port,
    database: cfg.dbname,
    user: cfg.username,
    password: cfg.password,
    ssl: cfg.ssl === 'disable' ? false : { rejectUnauthorized: cfg.ssl === 'verify', servername: isIP(cfg.host) ? undefined : cfg.host },
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs + 1000,
    application_name: 'zerosoft-analytics',
  });
  client.on('error', () => undefined);
  const kill = () => void client.end().catch(() => undefined);
  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS + 1000, kill).catch((err) => {
      if (err instanceof ExternalDbError) throw err;
      throw new ExternalDbError('connect_failed', scrub(String((err as Error).message ?? err), cfg));
    });
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
    const res = await withTimeout(
      client.query({ text: `SELECT * FROM (\n${sql}\n) AS zs_q LIMIT ${maxRows + 1}`, rowMode: 'array', queryMode: 'extended' }),
      timeoutMs + 2000,
      kill,
    );
    await client.query('ROLLBACK').catch(() => undefined);
    const columns = res.fields.map((f) => ({ name: f.name, type: (PG_NUMBER.has(f.dataTypeID) ? 'number' : PG_DATE.has(f.dataTypeID) ? 'date' : f.dataTypeID === 16 ? 'bool' : 'text') as ColumnType }));
    const rows = res.rows.slice(0, maxRows).map((r) => r.map((v, i) => (columns[i].type === 'number' && typeof v === 'string' ? Number(v) : cell(v))));
    return { columns, rows, truncated: res.rows.length > maxRows };
  } catch (err) {
    if (err instanceof ExternalDbError) throw err;
    const msg = String((err as Error)?.message ?? err);
    if (/statement timeout|canceling statement/i.test(msg)) throw new ExternalDbError('timeout');
    throw new ExternalDbError('sql_error', scrub(msg, cfg));
  } finally {
    await withTimeout(client.end(), 2000, () => undefined).catch(() => undefined);
  }
}

async function runMysql(cfg: DbConfig, sql: string, maxRows: number, timeoutMs: number): Promise<ExternalResult> {
  const ip = await guardHost(cfg);
  const mysql = await import('mysql2/promise');
  let conn: Awaited<ReturnType<typeof mysql.createConnection>> | null = null;
  const kill = () => {
    try {
      conn?.destroy();
    } catch {
      // ya cerrada
    }
  };
  try {
    conn = await withTimeout(
      mysql.createConnection({
        // Conexión a la IP ya validada; el nombre queda para TLS.
        host: cfg.host,
        stream: () => netConnect({ host: ip, port: cfg.port }),
        port: cfg.port,
        user: cfg.username,
        password: cfg.password,
        database: cfg.dbname,
        ssl: cfg.ssl === 'disable' ? undefined : { rejectUnauthorized: cfg.ssl === 'verify' },
        connectTimeout: CONNECT_TIMEOUT_MS,
        multipleStatements: false,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: false,
      }),
      CONNECT_TIMEOUT_MS + 1000,
      kill,
    ).catch((err) => {
      if (err instanceof ExternalDbError) throw err;
      throw new ExternalDbError('connect_failed', scrub(String((err as Error).message ?? err), cfg));
    });
    await conn.query(`SET SESSION max_execution_time = ${Math.floor(timeoutMs)}`);
    await conn.query('START TRANSACTION READ ONLY');
    const [rows, fields] = await withTimeout(
      conn.query({ sql: `SELECT * FROM (\n${sql}\n) AS zs_q LIMIT ${maxRows + 1}`, rowsAsArray: true, timeout: timeoutMs }),
      timeoutMs + 2000,
      kill,
    );
    await conn.query('ROLLBACK').catch(() => undefined);
    const list = (fields ?? []) as Array<{ name: string; columnType?: number; type?: number }>;
    const columns = list.map((f) => {
      const t = f.columnType ?? f.type ?? 253;
      const type: ColumnType = [0, 1, 2, 3, 4, 5, 8, 9, 246].includes(t) ? 'number' : [7, 10, 12, 14].includes(t) ? 'date' : 'text';
      return { name: f.name, type };
    });
    const data = rows as unknown[][];
    return {
      columns,
      rows: data.slice(0, maxRows).map((r) => r.map((v, i) => (columns[i]?.type === 'number' && typeof v === 'string' ? Number(v) : cell(v)))),
      truncated: data.length > maxRows,
    };
  } catch (err) {
    if (err instanceof ExternalDbError) throw err;
    const msg = String((err as Error)?.message ?? err);
    if (/max_execution_time|maximum statement execution time|timeout/i.test(msg)) throw new ExternalDbError('timeout');
    throw new ExternalDbError('sql_error', scrub(msg, cfg));
  } finally {
    if (conn) await conn.end().catch(() => kill());
  }
}

export async function runExternal(cfg: DbConfig, userSql: string, maxRows: number, timeoutMs = EXT_TIMEOUT_MS): Promise<ExternalResult> {
  if (!validateConfig(cfg)) throw new ExternalDbError('invalid_config');
  const sql = cleanUserSql(userSql);
  const out = cfg.engine === 'postgres' ? await runPostgres(cfg, sql, maxRows, timeoutMs) : await runMysql(cfg, sql, maxRows, timeoutMs);
  if (JSON.stringify(out.rows).length > MAX_RESULT_BYTES) throw new ExternalDbError('result_too_large');
  return out;
}

/** Tablas y columnas (hasta 300 tablas) para el navegador de esquema y el constructor. */
export async function introspect(cfg: DbConfig): Promise<SchemaTable[]> {
  const sql =
    cfg.engine === 'postgres'
      ? `SELECT CASE WHEN c.table_schema = 'public' THEN c.table_name ELSE c.table_schema || '.' || c.table_name END AS t, c.column_name, c.data_type
         FROM information_schema.columns c
         WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'pg_toast%'
         ORDER BY c.table_schema, c.table_name, c.ordinal_position`
      : `SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS column_name, c.DATA_TYPE AS data_type
         FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = DATABASE()
         ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`;
  const res = await runExternal(cfg, sql, 20_000);
  const tables = new Map<string, SchemaTable>();
  for (const [t, col, type] of res.rows as Array<[string, string, string]>) {
    if (!tables.has(t)) {
      if (tables.size >= 300) break;
      tables.set(t, { name: t, columns: [] });
    }
    tables.get(t)!.columns.push({ name: col, type: sqlTypeToColumn(type) });
  }
  return [...tables.values()];
}

export function sqlTypeToColumn(type: string): ColumnType {
  const t = type.toLowerCase();
  if (/int|numeric|decimal|real|double|float|money|serial/.test(t)) return 'number';
  if (/date|time/.test(t)) return 'date';
  if (/bool/.test(t)) return 'bool';
  return 'text';
}

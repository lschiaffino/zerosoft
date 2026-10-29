/**
 * Corre una consulta del editor SQL de Analytics con un límite duro de tiempo
 * y en modo de solo lectura. Server-only.
 *
 * - Base local (file:, self-host y tests): la consulta corre en un proceso
 *   hijo de Node con su propia conexión libsql, `PRAGMA query_only = 1` y un
 *   tope de memoria de JS; si pasa el tiempo, el proceso se mata (SIGKILL).
 *   libsql corre las consultas en el hilo que las llama: en el proceso del
 *   servidor, un producto cartesiano lo congelaría entero.
 * - Turso (remoto): la consulta corre en el servidor de Turso dentro de una
 *   transacción de solo lectura (la rechaza si escribe); acá se deja de
 *   esperar al vencer el tiempo y la transacción se cierra.
 */
import { spawn } from 'child_process';
import { ensureMigrated, getClient } from '../db';

export const SQL_TIMEOUT_MS = Number(process.env.ANALYTICS_SQL_TIMEOUT_MS) || 8000;

export class SqlRunError extends Error {
  constructor(
    public code: 'timeout' | 'sql_error',
    public detail?: string,
  ) {
    super(code);
  }
}

export interface SqlRunResult {
  columns: string[];
  rows: unknown[][];
}

const DB_URL = process.env.TURSO_DATABASE_URL ?? `file:${process.cwd()}/data/zerosoftware.db`;

/**
 * Programa del proceso hijo: lee {path, sql, args, max} de stdin y escribe
 * {columns, rows} o {error}. Resuelve libsql desde el directorio de la app (el
 * bundle del servidor no puede resolverlo por su cuenta).
 */
const CHILD = `
const input = [];
process.stdin.on('data', (d) => input.push(d));
process.stdin.on('end', () => {
  let out;
  try {
    const { path, sql, args, max } = JSON.parse(Buffer.concat(input).toString());
    const Database = require('module').createRequire(process.cwd() + '/package.json')('libsql');
    const db = new Database(path);
    db.exec('PRAGMA query_only = 1');
    const st = db.prepare(sql);
    st.raw(true);
    const columns = st.columns().map((c) => c.name);
    const rows = [];
    for (const r of st.iterate(...args)) {
      rows.push(r);
      if (rows.length > max) break;
    }
    out = { columns, rows };
  } catch (err) {
    out = { error: String((err && err.message) || err).slice(0, 500) };
  }
  process.stdout.write(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v instanceof Uint8Array ? '[blob]' : v)));
});
`;

function runInChild(path: string, sql: string, args: string[], max: number, timeoutMs: number): Promise<SqlRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', '-e', CHILD], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new SqlRunError('timeout')));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      // Un resultado de más de 20 MB tampoco se acepta.
      if (size > 20 * 1024 * 1024) {
        child.kill('SIGKILL');
        finish(() => reject(new SqlRunError('sql_error', 'result_too_large')));
        return;
      }
      chunks.push(d);
    });
    child.on('error', (err) => finish(() => reject(new SqlRunError('sql_error', err.message))));
    child.on('close', () =>
      finish(() => {
        try {
          const out = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { columns?: string[]; rows?: unknown[][]; error?: string };
          if (out.error || !out.columns) reject(new SqlRunError('sql_error', out.error ?? 'no_result'));
          else resolve({ columns: out.columns, rows: out.rows ?? [] });
        } catch {
          reject(new SqlRunError('sql_error', 'bad_output'));
        }
      }),
    );
    child.stdin.end(JSON.stringify({ path, sql, args, max }));
  });
}

export async function runReadOnly(sql: string, args: string[], max: number, timeoutMs = SQL_TIMEOUT_MS): Promise<SqlRunResult> {
  await ensureMigrated();
  if (DB_URL.startsWith('file:')) {
    return runInChild(DB_URL.slice('file:'.length), sql, args, max, timeoutMs);
  }
  const tx = await getClient().transaction('read');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      tx.execute({ sql, args }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SqlRunError('timeout')), timeoutMs);
      }),
    ]);
    return { columns: res.columns, rows: res.rows.slice(0, max + 1).map((row) => res.columns.map((_, i) => row[i])) };
  } catch (err) {
    if (err instanceof SqlRunError) throw err;
    throw new SqlRunError('sql_error', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    tx.close();
  }
}

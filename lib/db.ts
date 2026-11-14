import {
  createClient,
  type Client,
  type InValue,
  type ResultSet,
  type Transaction,
  type TransactionMode,
} from '@libsql/client';
import fs from 'fs';
import { runMigrations } from './schema/migrations';
import { handleBase, isValidHandle, pickHandle } from './schema/handles';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'zerosoftware.db');

const DB_URL = process.env.TURSO_DATABASE_URL ?? `file:${DB_PATH}`;
const IS_REMOTE = !DB_URL.startsWith('file:');

let _client: Client | null = null;

const BUSY_WAIT_MS = 5000;

/**
 * SQLite local (self-host, tests): una transacción interactiva se lleva la conexión y libsql abre otra
 * sin busy_timeout, así que otra escritura del mismo proceso falla al instante con SQLITE_BUSY. Un
 * busy_timeout no sirve: la espera es síncrona, frena el event loop y la transacción nunca termina.
 * Se reintenta cediendo el turno. Turso no pasa por acá: espera del lado del servidor.
 */
async function retryBusy<T>(run: () => Promise<T>, onSnapshot?: () => Promise<void>): Promise<T> {
  const deadline = Date.now() + BUSY_WAIT_MS;
  for (let wait = 2; ; wait = Math.min(wait * 2, 50)) {
    try {
      return await run();
    } catch (err) {
      if (!/SQLITE_BUSY|database is locked/i.test(String(err)) || Date.now() >= deadline) throw err;
      // WAL: la conexión quedó con una lectura vieja abierta (una consulta que no se cerró) y ninguna
      // escritura suya va a pasar por más que espere. Se abre otra conexión y se reintenta.
      if (onSnapshot && (err as { extendedCode?: string }).extendedCode === 'SQLITE_BUSY_SNAPSHOT') await onSnapshot();
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

/**
 * DB_LOCK_DEBUG=1 (e2e): avisa en el log cuando la base local queda tomada más de 3 s, con las transacciones
 * interactivas abiertas de este proceso (edad y dónde se abrieron), y cuando una consulta o el event loop se
 * frenan. Sirve para encontrar quién retiene el lock cuando un test falla con SQLITE_BUSY.
 */
function lockDebug(client: Client) {
  const open = new Map<Transaction, { at: number; stack: string }>();
  const tx = client.transaction.bind(client);
  client.transaction = (async (mode?: TransactionMode) => {
    const t = await tx(mode);
    open.set(t, { at: Date.now(), stack: (new Error('tx').stack ?? '').split('\n').slice(2, 9).join('\n') });
    for (const k of ['commit', 'rollback', 'close'] as const) {
      const orig = (t[k] as () => unknown).bind(t);
      (t as unknown as Record<string, unknown>)[k] = () => {
        open.delete(t);
        return orig();
      };
    }
    return t;
  }) as Client['transaction'];
  for (const k of ['execute', 'batch', 'executeMultiple'] as const) {
    const orig = (client[k] as (...a: unknown[]) => Promise<unknown>).bind(client);
    (client as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
      const t0 = Date.now();
      try {
        return await orig(...a);
      } finally {
        const ms = Date.now() - t0;
        if (ms > 500) console.log(`[dblock] ${k} lento ${ms}ms ${JSON.stringify(a[0]).slice(0, 300)}`);
      }
    };
  }
  const probe = createClient({ url: DB_URL });
  let last = Date.now();
  let lockedSince: number | null = null;
  let reported = 0;
  setInterval(() => {
    const now = Date.now();
    if (now - last > 1500) console.log(`[dblock] event loop frenado ${now - last - 1000}ms`);
    last = now;
    void (async () => {
      try {
        await probe.execute('BEGIN IMMEDIATE');
        await probe.execute('ROLLBACK');
        if (lockedSince !== null && now - lockedSince > 3000) console.log(`[dblock] la base se liberó tras ${now - lockedSince}ms`);
        lockedSince = null;
      } catch (err) {
        if (!/SQLITE_BUSY|locked/i.test(String(err))) return;
        lockedSince ??= now;
        if (now - lockedSince > 3000 && now - reported > 5000) {
          reported = now;
          const txs = [...open.values()].map((v) => `  abierta hace ${now - v.at}ms\n${v.stack}`).join('\n');
          console.log(`[dblock] base tomada hace ${now - lockedSince}ms; transacciones abiertas acá: ${open.size}\n${txs}`);
        }
      }
    })();
  }, 1000).unref?.();
}

/**
 * Cliente libsql crudo (para transacciones interactivas).
 * createClient no hace I/O al construir: es safe llamarlo de forma sync.
 */
export function getClient(): Client {
  if (_client) return _client;
  if (!IS_REMOTE) fs.mkdirSync(DATA_DIR, { recursive: true });
  _client = createClient({
    url: DB_URL,
    authToken: IS_REMOTE ? process.env.TURSO_AUTH_TOKEN : undefined,
  });
  if (!IS_REMOTE) {
    const begin = _client.transaction.bind(_client) as (mode?: TransactionMode) => Promise<Transaction>;
    _client.transaction = ((mode?: TransactionMode) => retryBusy(() => begin(mode))) as Client['transaction'];
    if (process.env.DB_LOCK_DEBUG === '1') lockDebug(_client);
  }
  return _client;
}

let _migratePromise: Promise<void> | null = null;

/**
 * Corre las migraciones pendientes una sola vez por proceso (ver lib/schema/). Es lazy porque getDb() es sync pero
 * migrar es async: cada statement del shim await-ea esta promesa antes de
 * ejecutar, así ninguna query puede correr antes del CREATE TABLE.
 * Idempotente; si falla, se resetea para permitir reintento.
 */
export function ensureMigrated(): Promise<void> {
  if (!_migratePromise) {
    const p = (async () => {
      const client = getClient();
      if (!IS_REMOTE) {
        await client.execute('PRAGMA foreign_keys = ON');
        await client.execute('PRAGMA busy_timeout = 5000');
        // WAL: lectores concurrentes durante el build estático de Next.
        await client.execute('PRAGMA journal_mode = WAL');
      }
      await runMigrations(client);
    })();
    _migratePromise = p;
    p.catch(() => {
      if (_migratePromise === p) _migratePromise = null;
    });
  }
  return _migratePromise;
}

// ---------- Shim async con la forma de better-sqlite3 ----------

export interface RunResult {
  changes: number;
  lastInsertRowid: number | undefined;
}

export interface Statement {
  get(...args: InValue[]): Promise<unknown>;
  all(...args: InValue[]): Promise<unknown[]>;
  run(...args: InValue[]): Promise<RunResult>;
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): Promise<void>;
}

interface Executor {
  execute(stmt: { sql: string; args: InValue[] }): Promise<ResultSet>;
}

function toRunResult(res: ResultSet): RunResult {
  return {
    changes: Number(res.rowsAffected),
    lastInsertRowid: res.lastInsertRowid == null ? undefined : Number(res.lastInsertRowid),
  };
}

/**
 * Las filas de libsql son objetos "Row" (índices + columnas, prototipo propio).
 * Se copian a objetos planos: así se pueden pasar de Server a Client Components
 * y serializar sin sorpresas.
 */
function plainRows(res: ResultSet): Record<string, unknown>[] {
  return res.rows.map((row) => {
    const out: Record<string, unknown> = {};
    res.columns.forEach((col, i) => {
      out[col] = row[i];
    });
    return out;
  });
}

/**
 * DB_QUERY_STATS=1: cuenta las consultas y lo escribe en el log cada 5 s
 * (para medir carga, p. ej. el tiempo real de Talk). Apagado no hace nada.
 */
const QUERY_STATS = process.env.DB_QUERY_STATS === '1';
let queryCount = 0;
if (QUERY_STATS) {
  setInterval(() => console.log(`[dbstats] t=${Date.now()} total=${queryCount}`), 5000).unref?.();
}

function makeStatement(executor: Executor, sql: string, ready: () => Promise<void>): Statement {
  const exec = executor;
  if (QUERY_STATS) {
    executor = {
      execute: (stmt) => {
        queryCount++;
        return exec.execute(stmt);
      },
    };
  }
  return {
    async get(...args: InValue[]) {
      await ready();
      const res = await executor.execute({ sql, args });
      // libsql devuelve rows[]; better-sqlite3 devuelve undefined si no hay fila.
      return plainRows(res)[0];
    },
    async all(...args: InValue[]) {
      await ready();
      const res = await executor.execute({ sql, args });
      return plainRows(res);
    },
    async run(...args: InValue[]) {
      await ready();
      const res = await executor.execute({ sql, args });
      return toRunResult(res);
    },
  };
}

let _db: Db | null = null;

/** Singleton sync (createClient no hace I/O). Todas las operaciones son async. */
export function getDb(): Db {
  if (_db) return _db;
  const client = getClient();
  const executor: Executor = IS_REMOTE
    ? client
    : {
        execute: (stmt) =>
          retryBusy(
            () => client.execute(stmt),
            async () => {
              try {
                await client.reconnect();
              } catch {
                // Sin conexión nueva se sigue reintentando con la que hay.
              }
            },
          ),
      };
  _db = {
    prepare: (sql) => makeStatement(executor, sql, ensureMigrated),
    exec: async (sql) => {
      await ensureMigrated();
      await client.executeMultiple(sql);
    },
  };
  return _db;
}

export interface BatchStatement {
  sql: string;
  args: InValue[];
}

export interface BatchResult {
  rows: Record<string, unknown>[];
  changes: number;
}

/**
 * Varias sentencias en una sola ida a la base, en una transacción (todas o
 * ninguna) y en orden: en Turso cada consulta suelta es una ida y vuelta, y lo
 * que corre por cada mensaje de WhatsApp las junta acá. Una sentencia puede
 * depender de la anterior por lo que quedó escrito (p. ej. un UPDATE con
 * EXISTS sobre la fila que insertó la anterior).
 */
export async function dbBatch(stmts: BatchStatement[]): Promise<BatchResult[]> {
  await ensureMigrated();
  const client = getClient();
  if (QUERY_STATS) queryCount++;
  const run = () => client.batch(stmts, 'write');
  // SQLite local: si otra escritura tiene tomada la base se reintenta cediendo el turno, como las consultas sueltas.
  const res = IS_REMOTE
    ? await run()
    : await retryBusy(run, async () => {
        try {
          await client.reconnect();
        } catch {
          // Sin conexión nueva se sigue reintentando con la que hay.
        }
      });
  return res.map((r) => ({ rows: plainRows(r), changes: Number(r.rowsAffected) }));
}

const NOOP_READY = (): Promise<void> => Promise.resolve();

/**
 * Db acotada a una transacción interactiva. No espera migración: los sitios
 * que abren transacciones ya await-earon ensureMigrated() antes.
 */
export function txDb(tx: Transaction): Db {
  return {
    prepare: (sql) => makeStatement(tx, sql, NOOP_READY),
    exec: async (sql) => {
      await tx.executeMultiple(sql);
    },
  };
}

export * from './schema/types';
import type { UserRow } from './schema/types';

// ---------- Users ----------

/** Email como clave de una cuenta: sin espacios, en minúsculas y en NFC. */
export function normalizeEmail(email: string): string {
  return email.normalize('NFC').trim().toLowerCase();
}

/**
 * La cuenta de un email sin importar mayúsculas ni la forma Unicode: compara
 * contra email_norm (normalizeEmail, calculado en JS; 145_users_email_norm).
 * Una fila sin email_norm (escrita por fuera de upsertUser) cae a lower(email).
 * `email` no se reescribe; si hubiera dos, gana la que coincide exacto y
 * después la más vieja.
 */
async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const clean = normalizeEmail(email);
  return (await getDb()
    .prepare(
      `SELECT * FROM users WHERE email_norm = ? OR (email_norm IS NULL AND lower(email) = ?)
       ORDER BY (email = ?) DESC, created_at, id LIMIT 1`,
    )
    .get(clean, clean, clean)) as UserRow | undefined;
}

export async function upsertUser(u: {
  email: string;
  name?: string | null;
  image?: string | null;
  id?: string;
}): Promise<UserRow> {
  const db = getDb();
  const existing = await findUserByEmail(u.email);
  if (existing) {
    await db
      // El nombre que la persona cambió en zerosoft (onboarding, Ajustes) no lo pisa el de Google.
      .prepare(
        "UPDATE users SET name = CASE WHEN json_extract(COALESCE(profile, '{}'), '$.nameEdited') = 1 THEN name ELSE COALESCE(?, name) END, image = COALESCE(?, image), email_norm = COALESCE(email_norm, ?) WHERE id = ?",
      )
      .run(u.name ?? null, u.image ?? null, normalizeEmail(existing.email), existing.id);
    return (await db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id)) as UserRow;
  }
  // Dos requests concurrentes del mismo usuario nuevo (o dos usuarios con el
  // mismo handle base) compiten acá: el email se resuelve con ON CONFLICT y el
  // handle se reintenta con el siguiente libre.
  const base = handleBase(u.email);
  for (let attempt = 0; ; attempt++) {
    const taken = new Set(
      ((await db
        .prepare("SELECT handle FROM users WHERE handle = ? OR handle LIKE ?")
        .all(base, `${base}-%`)) as Array<{ handle: string }>).map((r) => r.handle),
    );
    try {
      await db
        .prepare(
          'INSERT INTO users (id, email, email_norm, name, image, handle) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING',
        )
        .run(u.id ?? crypto.randomUUID(), normalizeEmail(u.email), normalizeEmail(u.email), u.name ?? null, u.image ?? null, pickHandle(u.email, taken));
      break;
    } catch (err) {
      if (attempt >= 4 || !/UNIQUE constraint failed: users\.handle/.test(String(err))) throw err;
    }
  }
  return (await findUserByEmail(u.email)) as UserRow;
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  return findUserByEmail(email);
}

export async function getUserById(id: string): Promise<UserRow | undefined> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow | undefined;
}

/** Cambia el handle público (links /book/<handle>/…). */
export async function setUserHandle(
  userId: string,
  handle: string,
): Promise<{ ok: true } | { ok: false; code: 'invalid_handle' | 'handle_taken' }> {
  const h = handle.trim().toLowerCase();
  if (!isValidHandle(h)) return { ok: false, code: 'invalid_handle' };
  const taken = (await getDb().prepare('SELECT id FROM users WHERE handle = ?').get(h)) as { id: string } | undefined;
  if (taken && taken.id !== userId) return { ok: false, code: 'handle_taken' };
  try {
    await getDb().prepare('UPDATE users SET handle = ? WHERE id = ?').run(h, userId);
  } catch {
    return { ok: false, code: 'handle_taken' };
  }
  return { ok: true };
}

import {
  createClient,
  type Client,
  type InValue,
  type ResultSet,
  type Transaction,
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

function makeStatement(executor: Executor, sql: string, ready: () => Promise<void>): Statement {
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
  _db = {
    prepare: (sql) => makeStatement(client, sql, ensureMigrated),
    exec: async (sql) => {
      await ensureMigrated();
      await client.executeMultiple(sql);
    },
  };
  return _db;
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

export async function upsertUser(u: {
  email: string;
  name?: string | null;
  image?: string | null;
  id?: string;
}): Promise<UserRow> {
  const db = getDb();
  const existing = (await db.prepare('SELECT * FROM users WHERE email = ?').get(u.email)) as
    | UserRow
    | undefined;
  if (existing) {
    await db
      .prepare('UPDATE users SET name = COALESCE(?, name), image = COALESCE(?, image) WHERE id = ?')
      .run(u.name ?? null, u.image ?? null, existing.id);
    return (await db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id)) as UserRow;
  }
  const id = u.id ?? crypto.randomUUID();
  const base = handleBase(u.email);
  const taken = new Set(
    ((await db
      .prepare("SELECT handle FROM users WHERE handle = ? OR handle LIKE ?")
      .all(base, `${base}-%`)) as Array<{ handle: string }>).map((r) => r.handle),
  );
  await db
    .prepare('INSERT INTO users (id, email, name, image, handle) VALUES (?, ?, ?, ?, ?)')
    .run(id, u.email, u.name ?? null, u.image ?? null, pickHandle(u.email, taken));
  return (await db.prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  return (await getDb().prepare('SELECT * FROM users WHERE email = ?').get(email)) as
    | UserRow
    | undefined;
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

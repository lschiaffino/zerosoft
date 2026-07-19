import {
  createClient,
  type Client,
  type InValue,
  type ResultSet,
  type Transaction,
} from '@libsql/client';
import fs from 'fs';
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
 * Corre el DDL una sola vez por proceso. Es lazy porque getDb() es sync pero
 * migrar es async: cada statement del shim await-ea esta promesa antes de
 * ejecutar, así ninguna query puede correr antes del CREATE TABLE.
 * Idempotente; si falla, se resetea para permitir reintento.
 */
export function ensureMigrated(): Promise<void> {
  if (!_migratePromise) {
    const p = (async () => {
      const client = getClient();
      if (!IS_REMOTE) await client.execute('PRAGMA foreign_keys = ON');
      await client.executeMultiple(DDL);
      // Columnas añadidas después del DDL inicial: ALTER idempotente
      // (falla con "duplicate column" si ya existe; se ignora).
      for (const alter of [
        'ALTER TABLE crm_activities ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE integrations ADD COLUMN last_sync_at TEXT',
      ]) {
        try {
          await client.execute(alter);
        } catch {
          /* la columna ya existe */
        }
      }
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

function makeStatement(executor: Executor, sql: string, ready: () => Promise<void>): Statement {
  return {
    async get(...args: InValue[]) {
      await ready();
      const res = await executor.execute({ sql, args });
      // libsql devuelve rows[]; better-sqlite3 devuelve undefined si no hay fila.
      return res.rows[0];
    },
    async all(...args: InValue[]) {
      await ready();
      const res = await executor.execute({ sql, args });
      return res.rows;
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

// ---------- DDL ----------

const DDL = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      image TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      title TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      password_hash TEXT,
      expires_at TEXT,
      max_clicks INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      clicks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      referrer TEXT,
      country TEXT,
      device TEXT,
      browser TEXT,
      os TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clicks_link_ts ON clicks(link_id, ts);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

    -- ---------- CRM ----------

    CREATE TABLE IF NOT EXISTS crm_contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      lifecycle_stage TEXT NOT NULL DEFAULT 'lead',
      lead_status TEXT NOT NULL DEFAULT 'new',
      source TEXT NOT NULL DEFAULT '',
      company_id TEXT,
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_user ON crm_contacts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(user_id, email);

    CREATE TABLE IF NOT EXISTS crm_companies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      employees INTEGER,
      phone TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      lifecycle_stage TEXT NOT NULL DEFAULT 'lead',
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_companies_user ON crm_companies(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS crm_pipelines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_stages (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      probability INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      is_won INTEGER NOT NULL DEFAULT 0,
      is_lost INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline ON crm_stages(pipeline_id, position);

    CREATE TABLE IF NOT EXISTS crm_deals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pipeline_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      close_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      source TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      lost_reason TEXT NOT NULL DEFAULT '',
      position REAL NOT NULL DEFAULT 0,
      closed_at TEXT,
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_deals_user ON crm_deals(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage_id, position);

    CREATE TABLE IF NOT EXISTS crm_deal_contacts (
      deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (deal_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS crm_activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('note', 'task', 'call', 'meeting', 'email')),
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      due_at TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      duration_min INTEGER,
      contact_id TEXT,
      company_id TEXT,
      deal_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_activities_user ON crm_activities(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_activities_due ON crm_activities(user_id, done, due_at);

    CREATE TABLE IF NOT EXISTS crm_lists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT 'contacts',
      kind TEXT NOT NULL CHECK (kind IN ('static', 'dynamic')) DEFAULT 'static',
      filter TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_list_members (
      list_id TEXT NOT NULL REFERENCES crm_lists(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS crm_custom_fields (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'boolean')),
      options TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crm_saved_views (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      name TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_imports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      errors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- Integraciones (Gmail, etc.) ----------

    CREATE TABLE IF NOT EXISTS integrations (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL DEFAULT 0,
      scope TEXT NOT NULL DEFAULT '',
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS crm_emails (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      gmail_id TEXT NOT NULL,
      thread_id TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'in',
      from_email TEXT NOT NULL DEFAULT '',
      to_emails TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, gmail_id)
    );
    CREATE INDEX IF NOT EXISTS idx_crm_emails_contact ON crm_emails(user_id, contact_id, sent_at DESC);
  `;

// ---------- Tipos ----------

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  created_at: string;
}

export interface LinkRow {
  id: string;
  user_id: string;
  slug: string;
  url: string;
  title: string | null;
  tags: string; // JSON string[]
  password_hash: string | null;
  expires_at: string | null;
  max_clicks: number | null;
  archived: 0 | 1;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  clicks: number;
  created_at: string;
  updated_at: string;
}

export interface ClickRow {
  id: number;
  link_id: string;
  ts: string;
  referrer: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked: 0 | 1;
}

// ---------- CRM ----------

export interface CrmContactRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  website: string;
  city: string;
  country: string;
  lifecycle_stage: string;
  lead_status: string;
  source: string;
  company_id: string | null;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface CrmCompanyRow {
  id: string;
  user_id: string;
  name: string;
  domain: string;
  industry: string;
  employees: number | null;
  phone: string;
  website: string;
  city: string;
  country: string;
  lifecycle_stage: string;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface CrmPipelineRow {
  id: string;
  user_id: string;
  name: string;
  position: number;
  created_at: string;
}

export interface CrmStageRow {
  id: string;
  pipeline_id: string;
  name: string;
  probability: number;
  position: number;
  is_won: 0 | 1;
  is_lost: 0 | 1;
}

export interface CrmDealRow {
  id: string;
  user_id: string;
  pipeline_id: string;
  stage_id: string;
  name: string;
  amount: number;
  currency: string;
  close_date: string | null;
  priority: string;
  source: string;
  description: string;
  lost_reason: string;
  position: number;
  closed_at: string | null;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface CrmActivityRow {
  id: string;
  user_id: string;
  type: 'note' | 'task' | 'call' | 'meeting' | 'email';
  subject: string;
  body: string;
  due_at: string | null;
  done: 0 | 1;
  done_at: string | null;
  pinned: 0 | 1;
  direction: string;
  outcome: string;
  duration_min: number | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmListRow {
  id: string;
  user_id: string;
  name: string;
  entity: string;
  kind: 'static' | 'dynamic';
  filter: string; // JSON ContactFilter subset
  created_at: string;
}

export interface CrmCustomFieldRow {
  id: string;
  user_id: string;
  entity: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options: string; // JSON string[]
  position: number;
}

export interface CrmSavedViewRow {
  id: string;
  user_id: string;
  entity: string;
  name: string;
  query: string; // JSON object
  created_at: string;
}

export interface CrmImportRow {
  id: string;
  user_id: string;
  entity: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string; // JSON string[]
  created_at: string;
}

export interface IntegrationRow {
  user_id: string;
  provider: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmEmailRow {
  id: string;
  user_id: string;
  contact_id: string;
  gmail_id: string;
  thread_id: string;
  direction: 'in' | 'out';
  from_email: string;
  to_emails: string;
  subject: string;
  snippet: string;
  sent_at: string;
  created_at: string;
}

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
  await db
    .prepare('INSERT INTO users (id, email, name, image) VALUES (?, ?, ?, ?)')
    .run(id, u.email, u.name ?? null, u.image ?? null);
  return (await db.prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  return (await getDb().prepare('SELECT * FROM users WHERE email = ?').get(email)) as
    | UserRow
    | undefined;
}

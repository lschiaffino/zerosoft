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
      if (!IS_REMOTE) {
        await client.execute('PRAGMA foreign_keys = ON');
        await client.execute('PRAGMA busy_timeout = 5000');
      }
      await client.executeMultiple(DDL);
      // Columnas añadidas después del DDL inicial: ALTER idempotente
      // (falla con "duplicate column" si ya existe; se ignora).
      for (const alter of [
        'ALTER TABLE crm_activities ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE crm_activities ADD COLUMN project_id TEXT',
        'ALTER TABLE crm_activities ADD COLUMN owner_id TEXT',
        'CREATE INDEX IF NOT EXISTS idx_crm_activities_project ON crm_activities(user_id, project_id, done)',
        'ALTER TABLE integrations ADD COLUMN last_sync_at TEXT',
        'ALTER TABLE users ADD COLUMN active_team_id TEXT',
        'ALTER TABLE crm_contacts ADD COLUMN owner_id TEXT',
        'ALTER TABLE crm_companies ADD COLUMN owner_id TEXT',
        'ALTER TABLE crm_deals ADD COLUMN owner_id TEXT',
        'ALTER TABLE links ADD COLUMN redirect_type INTEGER NOT NULL DEFAULT 302',
        'ALTER TABLE links ADD COLUMN og_title TEXT',
        'ALTER TABLE links ADD COLUMN og_description TEXT',
        'ALTER TABLE links ADD COLUMN og_image TEXT',
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
      redirect_type INTEGER NOT NULL DEFAULT 302,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      og_title TEXT,
      og_description TEXT,
      og_image TEXT,
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
      owner_id TEXT,
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
      owner_id TEXT,
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
      owner_id TEXT,
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

    CREATE TABLE IF NOT EXISTS crm_task_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#666666',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_task_projects_user ON crm_task_projects(user_id, archived, name);

    CREATE TABLE IF NOT EXISTS crm_task_files (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_task_files_activity ON crm_task_files(activity_id, created_at DESC);

    -- Audit trail: una fila por cada cambio de propiedad de contact/company/deal.
    CREATE TABLE IF NOT EXISTS crm_property_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      actor_email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_prop_events ON crm_property_events(user_id, entity, entity_id, created_at DESC);

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

    CREATE TABLE IF NOT EXISTS crm_saved_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}',
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

    -- ---------- Teams (workspace compartido del owner) ----------

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id);

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      email TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id, status);

    -- ---------- Docs ----------

    CREATE TABLE IF NOT EXISTS docs_pages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES docs_pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      icon TEXT,
      content TEXT NOT NULL DEFAULT '[]',
      is_public INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_docs_pages_user ON docs_pages(user_id, archived, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_docs_pages_parent ON docs_pages(parent_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_docs_pages_title ON docs_pages(user_id, title);

    CREATE TABLE IF NOT EXISTS docs_shares (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('public', 'team', 'user')),
      target_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_docs_shares_page ON docs_shares(page_id);
    CREATE INDEX IF NOT EXISTS idx_docs_shares_target ON docs_shares(kind, target_id);

    -- ---------- Calendar ----------

    CREATE TABLE IF NOT EXISTS calendar_users (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      week_start INTEGER NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 0 AND 6),
      buffer_before_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
      buffer_after_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
      min_notice_hours INTEGER NOT NULL DEFAULT 0 CHECK (min_notice_hours >= 0),
      max_booking_days INTEGER NOT NULL DEFAULT 30 CHECK (max_booking_days >= 1),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_event_types (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      duration_min INTEGER NOT NULL CHECK (duration_min >= 1),
      location TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#000000',
      active INTEGER NOT NULL DEFAULT 1,
      booking_rules TEXT NOT NULL DEFAULT '{}',
      fields TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_event_types_user_slug ON calendar_event_types(user_id, slug);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_event_types_team_slug ON calendar_event_types(team_id, slug) WHERE team_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_calendar_event_types_user ON calendar_event_types(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS calendar_availability (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_availability_event_type ON calendar_availability(event_type_id);

    CREATE TABLE IF NOT EXISTS calendar_bookings (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
      invitee_email TEXT NOT NULL,
      invitee_name TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'no_show')),
      answers TEXT NOT NULL DEFAULT '{}',
      cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_event_type ON calendar_bookings(event_type_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_starts_at ON calendar_bookings(starts_at);

    CREATE TABLE IF NOT EXISTS calendar_blocked_slots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_blocked_slots_user ON calendar_blocked_slots(user_id, starts_at);

    -- ---------- Track ----------

    CREATE TABLE IF NOT EXISTS track_projects (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT,
      color TEXT NOT NULL DEFAULT '#000000',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_projects_team ON track_projects(team_id, status, name);

    CREATE TABLE IF NOT EXISTS track_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#666666',
      position INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'todo' CHECK (category IN ('backlog', 'todo', 'in_progress', 'done', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_statuses_project ON track_statuses(project_id, position);

    CREATE TABLE IF NOT EXISTS track_cycles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_cycles_project ON track_cycles(project_id, start_at);

    CREATE TABLE IF NOT EXISTS track_issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '[]',
      status_id TEXT REFERENCES track_statuses(id) ON DELETE SET NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cycle_id TEXT REFERENCES track_cycles(id) ON DELETE SET NULL,
      estimate INTEGER CHECK (estimate >= 0),
      parent_id TEXT REFERENCES track_issues(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, identifier)
    );
    CREATE INDEX IF NOT EXISTS idx_track_issues_project ON track_issues(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_track_issues_status ON track_issues(status_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_track_issues_assignee ON track_issues(assignee_id, status_id);

    CREATE TABLE IF NOT EXISTS track_issue_comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_comments_issue ON track_issue_comments(issue_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS track_issue_relations (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      related_issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'related' CHECK (type IN ('blocks', 'related', 'duplicates')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (issue_id, related_issue_id)
    );
  `;

// ---------- Tipos ----------

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  active_team_id?: string | null;
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
  redirect_type: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
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
  owner_id: string | null;
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
  owner_id: string | null;
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
  owner_id: string | null;
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
  owner_id: string | null;
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
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmTaskProjectRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  archived: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CrmTaskFileRow {
  id: string;
  activity_id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  created_at: string;
}

export interface CrmPropertyEventRow {
  id: string;
  user_id: string;
  entity: string;
  entity_id: string;
  field: string;
  old_value: string;
  new_value: string;
  actor_email: string;
  created_at: string;
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

export interface CrmSavedReportRow {
  id: string;
  user_id: string;
  name: string;
  report_type: string;
  filters: string; // JSON object
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

export interface TeamRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface TeamInviteRow {
  id: string;
  team_id: string;
  email: string;
  token: string;
  role: 'owner' | 'member';
  status: 'pending' | 'accepted' | 'revoked';
  invited_by: string;
  created_at: string;
  expires_at: string | null;
}

// ---------- Docs ----------

export interface DocsPageRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  content: string; // JSON DocsBlock[]
  is_public: 0 | 1;
  archived: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface DocsShareRow {
  id: string;
  page_id: string;
  kind: 'public' | 'team' | 'user';
  target_id: string | null;
  created_at: string;
}

// ---------- Calendar ----------

export interface CalendarUserRow {
  id: string;
  user_id: string;
  timezone: string;
  week_start: number;
  buffer_before_min: number;
  buffer_after_min: number;
  min_notice_hours: number;
  max_booking_days: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventTypeRow {
  id: string;
  user_id: string;
  team_id: string | null;
  slug: string;
  title: string;
  duration_min: number;
  location: string;
  description: string;
  color: string;
  active: 0 | 1;
  booking_rules: string; // JSON CalendarBookingRules
  fields: string; // JSON CalendarCustomField[]
  created_at: string;
  updated_at: string;
}

export interface CalendarAvailabilityRow {
  id: string;
  event_type_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface CalendarBookingRow {
  id: string;
  event_type_id: string;
  invitee_email: string;
  invitee_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: 'confirmed' | 'cancelled' | 'no_show';
  answers: string; // JSON object
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarBlockedSlotRow {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

// ---------- Track ----------

export interface TrackProjectRow {
  id: string;
  team_id: string | null;
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  color: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface TrackStatusRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  position: number;
  category: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
  created_at: string;
}

export interface TrackCycleRow {
  id: string;
  project_id: string;
  name: string;
  start_at: string;
  end_at: string;
  created_at: string;
}

export interface TrackIssueRow {
  id: string;
  project_id: string;
  identifier: string;
  title: string;
  description: string; // JSON TrackBlock[]
  status_id: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  assignee_id: string | null;
  creator_id: string;
  cycle_id: string | null;
  estimate: number | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackIssueCommentRow {
  id: string;
  issue_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface TrackIssueRelationRow {
  id: string;
  issue_id: string;
  related_issue_id: string;
  type: 'blocks' | 'related' | 'duplicates';
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

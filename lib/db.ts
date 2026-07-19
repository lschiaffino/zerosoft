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
        // WAL: lectores concurrentes durante el build estático de Next.
        await client.execute('PRAGMA journal_mode = WAL');
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
        'ALTER TABLE track_issues ADD COLUMN due_date TEXT',
        'ALTER TABLE track_issues ADD COLUMN start_date TEXT',
        'ALTER TABLE track_issues ADD COLUMN labels TEXT NOT NULL DEFAULT \'[]\'',
        'ALTER TABLE chat_visitors ADD COLUMN notes TEXT',
        'ALTER TABLE chat_visitors ADD COLUMN metadata TEXT NOT NULL DEFAULT \'{}\'',
        'ALTER TABLE chat_conversations ADD COLUMN first_response_at TEXT',
        'ALTER TABLE chat_conversations ADD COLUMN resolved_at TEXT',
        'ALTER TABLE chat_conversations ADD COLUMN sla_breach_at TEXT',
        'ALTER TABLE chat_messages ADD COLUMN read_at TEXT',
        'ALTER TABLE crm_emails ADD COLUMN source TEXT NOT NULL DEFAULT \'gmail\'',
        'ALTER TABLE crm_emails ADD COLUMN body_html TEXT',
        'ALTER TABLE crm_emails ADD COLUMN body_text TEXT',
        'ALTER TABLE docs_pages ADD COLUMN cover_url TEXT',
        'ALTER TABLE users ADD COLUMN seeded_at TEXT',
        // Calendar F3: branding, single-use links, round-robin y host asignado.
        'ALTER TABLE calendar_event_types ADD COLUMN brand_color TEXT',
        'ALTER TABLE calendar_event_types ADD COLUMN welcome_message TEXT NOT NULL DEFAULT \'\'',
        'ALTER TABLE calendar_event_types ADD COLUMN logo_url TEXT',
        'ALTER TABLE calendar_event_types ADD COLUMN single_use INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE calendar_event_types ADD COLUMN used_at TEXT',
        'ALTER TABLE calendar_event_types ADD COLUMN rr_cursor INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE calendar_bookings ADD COLUMN host_user_id TEXT',
        // Chat F4: bot, office hours, snooze y CSAT.
        'ALTER TABLE chat_widgets ADD COLUMN bot_enabled INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE chat_widgets ADD COLUMN bot_greeting TEXT',
        'ALTER TABLE chat_widgets ADD COLUMN bot_source TEXT NOT NULL DEFAULT \'canned\'',
        'ALTER TABLE chat_widgets ADD COLUMN office_hours TEXT',
        'ALTER TABLE chat_conversations ADD COLUMN snoozed_until TEXT',
        'ALTER TABLE chat_conversations ADD COLUMN csat_score INTEGER',
        'ALTER TABLE chat_conversations ADD COLUMN csat_comment TEXT',
      ]) {
        try {
          await client.execute(alter);
        } catch {
          /* la columna ya existe */
        }
      }
      // El CHECK de track_issue_views.view_type no admite ALTER: si la tabla
      // existe y no reconoce 'gantt', se reconstruye (una sola vez; el nuevo
      // DDL ya incluye 'gantt', así que el guard la hace idempotente).
      const viewsTable = await client.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'track_issue_views'",
      );
      const viewsSql = viewsTable.rows.length > 0 ? String(viewsTable.rows[0].sql ?? '') : '';
      if (viewsSql && !viewsSql.includes("'gantt'")) {
        await client.executeMultiple(`
          CREATE TABLE track_issue_views_new (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            view_type TEXT NOT NULL CHECK (view_type IN ('list', 'board', 'calendar', 'gantt')),
            filters TEXT NOT NULL DEFAULT '{}',
            sort TEXT NOT NULL DEFAULT 'newest',
            columns TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO track_issue_views_new (id, project_id, user_id, name, view_type, filters, sort, columns, is_default, created_at, updated_at)
            SELECT id, project_id, user_id, name, view_type, filters, sort, columns, is_default, created_at, updated_at FROM track_issue_views;
          DROP TABLE track_issue_views;
          ALTER TABLE track_issue_views_new RENAME TO track_issue_views;
          CREATE INDEX IF NOT EXISTS idx_track_issue_views_project ON track_issue_views(project_id, user_id);
        `);
      }
      // Chat F4: los CHECK de status/priority/sender_type no admiten ALTER.
      // Si la tabla existe con el CHECK viejo, se reconstruye (una sola vez;
      // el DDL nuevo ya incluye los valores nuevos, así el guard es
      // idempotente). foreign_keys se apaga durante el rebuild: con FK ON el
      // DROP TABLE dispara un DELETE implícito que cascadearía a los hijos
      // (chat_messages / chat_typing).
      const chatTables = await client.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('chat_conversations', 'chat_messages', 'chat_sla_policies')",
      );
      const chatSql = new Map(
        chatTables.rows.map((r) => [String(r.name), String(r.sql ?? '')]),
      );
      const needsConversations = (chatSql.get('chat_conversations') ?? '') !== '' && !chatSql.get('chat_conversations')!.includes("'pending'");
      const needsMessages = (chatSql.get('chat_messages') ?? '') !== '' && !chatSql.get('chat_messages')!.includes("'bot'");
      const needsSla = (chatSql.get('chat_sla_policies') ?? '') !== '' && !chatSql.get('chat_sla_policies')!.includes("'medium'");
      if (needsConversations || needsMessages || needsSla) {
        try {
          await client.execute('PRAGMA foreign_keys = OFF');
        } catch {
          /* remoto puede no soportarlo */
        }
        try {
          if (needsConversations) {
            await client.executeMultiple(`
              CREATE TABLE chat_conversations_new (
                id TEXT PRIMARY KEY,
                widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
                visitor_id TEXT NOT NULL REFERENCES chat_visitors(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'snoozed')),
                assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
                priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
                subject TEXT,
                first_response_at TEXT,
                resolved_at TEXT,
                sla_breach_at TEXT,
                snoozed_until TEXT,
                csat_score INTEGER,
                csat_comment TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              INSERT INTO chat_conversations_new (id, widget_id, visitor_id, status, assigned_to, priority, subject, first_response_at, resolved_at, sla_breach_at, snoozed_until, csat_score, csat_comment, created_at, updated_at)
                SELECT id, widget_id, visitor_id,
                  CASE WHEN status = 'closed' THEN 'resolved' ELSE status END,
                  assigned_to,
                  CASE WHEN priority = 'normal' THEN 'medium' ELSE priority END,
                  subject, first_response_at, resolved_at, sla_breach_at, snoozed_until, csat_score, csat_comment, created_at, updated_at
                FROM chat_conversations;
              DROP TABLE chat_conversations;
              ALTER TABLE chat_conversations_new RENAME TO chat_conversations;
              CREATE INDEX IF NOT EXISTS idx_chat_conversations_widget ON chat_conversations(widget_id, status, updated_at DESC);
              CREATE INDEX IF NOT EXISTS idx_chat_conversations_visitor ON chat_conversations(visitor_id);
            `);
          }
          if (needsMessages) {
            await client.executeMultiple(`
              CREATE TABLE chat_messages_new (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
                sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'user', 'system', 'bot')),
                user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                body TEXT NOT NULL,
                attachments TEXT NOT NULL DEFAULT '[]',
                read_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              INSERT INTO chat_messages_new (id, conversation_id, sender_type, user_id, body, attachments, read_at, created_at)
                SELECT id, conversation_id, sender_type, user_id, body, attachments, read_at, created_at FROM chat_messages;
              DROP TABLE chat_messages;
              ALTER TABLE chat_messages_new RENAME TO chat_messages;
              CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at ASC);
            `);
          }
          if (needsSla) {
            await client.executeMultiple(`
              CREATE TABLE chat_sla_policies_new (
                id TEXT PRIMARY KEY,
                widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                first_response_minutes INTEGER NOT NULL DEFAULT 60,
                resolution_minutes INTEGER,
                priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              INSERT INTO chat_sla_policies_new (id, widget_id, name, first_response_minutes, resolution_minutes, priority, active, created_at, updated_at)
                SELECT id, widget_id, name, first_response_minutes, resolution_minutes,
                  CASE WHEN priority = 'normal' THEN 'medium' ELSE priority END,
                  active, created_at, updated_at
                FROM chat_sla_policies;
              DROP TABLE chat_sla_policies;
              ALTER TABLE chat_sla_policies_new RENAME TO chat_sla_policies;
              CREATE INDEX IF NOT EXISTS idx_chat_sla_widget ON chat_sla_policies(widget_id, priority, active);
            `);
          }
        } finally {
          try {
            await client.execute('PRAGMA foreign_keys = ON');
          } catch {
            /* remoto puede no soportarlo */
          }
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

    CREATE TABLE IF NOT EXISTS crm_dashboards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_dashboards_user ON crm_dashboards(user_id, position);

    CREATE TABLE IF NOT EXISTS crm_dashboard_widgets (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL REFERENCES crm_dashboards(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      w INTEGER NOT NULL DEFAULT 4,
      h INTEGER NOT NULL DEFAULT 3,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_dashboard_widgets_dash ON crm_dashboard_widgets(dashboard_id, position);

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
      source TEXT NOT NULL DEFAULT 'gmail',
      direction TEXT NOT NULL DEFAULT 'in',
      from_email TEXT NOT NULL DEFAULT '',
      to_emails TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      body_html TEXT,
      body_text TEXT,
      sent_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, gmail_id)
    );
    CREATE INDEX IF NOT EXISTS idx_crm_emails_contact ON crm_emails(user_id, contact_id, sent_at DESC);

    CREATE TABLE IF NOT EXISTS crm_workflows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_workflows_user ON crm_workflows(user_id, enabled, updated_at DESC);

    CREATE TABLE IF NOT EXISTS crm_workflow_triggers (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crm_workflow_actions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crm_workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trigger_entity TEXT NOT NULL DEFAULT '',
      trigger_entity_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      output TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_wf ON crm_workflow_runs(workflow_id, started_at DESC);

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
      cover_url TEXT,
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
      brand_color TEXT,
      welcome_message TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      single_use INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      rr_cursor INTEGER NOT NULL DEFAULT 0,
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
      host_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_event_type ON calendar_bookings(event_type_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_starts_at ON calendar_bookings(starts_at);

    -- Pool de hosts para eventos de equipo (round-robin por position + rr_cursor).
    CREATE TABLE IF NOT EXISTS calendar_event_hosts (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_type_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_event_hosts_event ON calendar_event_hosts(event_type_id, position);

    -- Recordatorios programados de bookings (ej. 24h antes).
    CREATE TABLE IF NOT EXISTS calendar_reminders (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES calendar_bookings(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'reminder_24h' CHECK (kind IN ('reminder_24h')),
      send_at TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_reminders_due ON calendar_reminders(sent_at, send_at);

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

    CREATE TABLE IF NOT EXISTS track_issue_views (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      view_type TEXT NOT NULL CHECK (view_type IN ('list', 'board', 'calendar', 'gantt')),
      filters TEXT NOT NULL DEFAULT '{}',
      sort TEXT NOT NULL DEFAULT 'newest',
      columns TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_views_project ON track_issue_views(project_id, user_id);

    CREATE TABLE IF NOT EXISTS track_issue_attachments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_attachments_issue ON track_issue_attachments(issue_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS track_issue_activities (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('comment', 'status_change', 'assignee_change', 'priority_change', 'cycle_change', 'due_date_change', 'estimate_change', 'title_change', 'description_change', 'relation_added', 'relation_removed', 'attachment_added', 'subtask_added', 'created', 'closed', 'reopened')),
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_activities_issue ON track_issue_activities(issue_id, created_at DESC);

    -- ---------- Chat ----------

    CREATE TABLE IF NOT EXISTS chat_widgets (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#000000',
      position TEXT NOT NULL DEFAULT 'bottom-right' CHECK (position IN ('bottom-right', 'bottom-left')),
      welcome_message TEXT,
      fields TEXT NOT NULL DEFAULT '[]',
      bot_enabled INTEGER NOT NULL DEFAULT 0,
      bot_greeting TEXT,
      bot_source TEXT NOT NULL DEFAULT 'canned' CHECK (bot_source IN ('canned', 'docs')),
      office_hours TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_widgets_user ON chat_widgets(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_widgets_team ON chat_widgets(team_id);

    CREATE TABLE IF NOT EXISTS chat_visitors (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      email TEXT,
      name TEXT,
      notes TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (widget_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_visitors_widget ON chat_visitors(widget_id);
    CREATE INDEX IF NOT EXISTS idx_chat_visitors_search ON chat_visitors(widget_id, email, name);

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      visitor_id TEXT NOT NULL REFERENCES chat_visitors(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'snoozed')),
      assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      subject TEXT,
      first_response_at TEXT,
      resolved_at TEXT,
      sla_breach_at TEXT,
      snoozed_until TEXT,
      csat_score INTEGER,
      csat_comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_widget ON chat_conversations(widget_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_visitor ON chat_conversations(visitor_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'user', 'system', 'bot')),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]',
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS chat_typing (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'user')),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TEXT NOT NULL,
      UNIQUE (conversation_id, sender_type, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_typing_conversation ON chat_typing(conversation_id, expires_at);

    CREATE TABLE IF NOT EXISTS chat_assignment_rules (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('all', 'keyword', 'time', 'round_robin')),
      match_value TEXT,
      assign_to TEXT REFERENCES users(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_rules_widget ON chat_assignment_rules(widget_id, position);

    CREATE TABLE IF NOT EXISTS chat_sla_policies (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      first_response_minutes INTEGER NOT NULL DEFAULT 60,
      resolution_minutes INTEGER,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sla_widget ON chat_sla_policies(widget_id, priority, active);

    CREATE TABLE IF NOT EXISTS chat_canned_responses (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      shortcut TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (widget_id, shortcut)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_canned_widget_shortcut ON chat_canned_responses(widget_id, shortcut);

    -- ---------- Notifications ----------

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      href TEXT,
      read_at TEXT,
      source_type TEXT,
      source_id TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at, created_at DESC);
  `;

// ---------- Tipos ----------

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  active_team_id?: string | null;
  seeded_at?: string | null;
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

export interface CrmDashboardRow {
  id: string;
  user_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CrmDashboardWidgetRow {
  id: string;
  dashboard_id: string;
  type: string;
  config: string; // JSON object
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
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
  source: 'gmail' | 'zerosoft';
  direction: 'in' | 'out';
  from_email: string;
  to_emails: string;
  subject: string;
  snippet: string;
  body_html: string | null;
  body_text: string | null;
  sent_at: string;
  created_at: string;
}

export interface CrmWorkflowRow {
  id: string;
  user_id: string;
  name: string;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CrmWorkflowTriggerRow {
  id: string;
  workflow_id: string;
  type: string;
  config: string; // JSON
  position: number;
}

export interface CrmWorkflowActionRow {
  id: string;
  workflow_id: string;
  type: string;
  config: string; // JSON
  position: number;
}

export interface CrmWorkflowRunRow {
  id: string;
  workflow_id: string;
  user_id: string;
  trigger_entity: string;
  trigger_entity_id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  output: string; // JSON
  started_at: string;
  finished_at: string | null;
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
  cover_url: string | null;
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
  brand_color: string | null;
  welcome_message: string;
  logo_url: string | null;
  single_use: 0 | 1;
  used_at: string | null;
  rr_cursor: number;
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
  host_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventHostRow {
  id: string;
  event_type_id: string;
  user_id: string;
  position: number;
  created_at: string;
}

export interface CalendarReminderRow {
  id: string;
  booking_id: string;
  kind: 'reminder_24h';
  send_at: string;
  sent_at: string | null;
  created_at: string;
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
  start_date: string | null;
  due_date: string | null;
  labels: string; // JSON TrackLabel[]
  created_at: string;
  updated_at: string;
}

export interface TrackIssueViewRow {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  view_type: 'list' | 'board' | 'calendar' | 'gantt';
  filters: string; // JSON IssueFilters
  sort: string;
  columns: string | null; // JSON string[]
  is_default: 0 | 1;
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

export interface TrackIssueAttachmentRow {
  id: string;
  issue_id: string;
  user_id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  created_at: string;
}

export interface TrackIssueActivityRow {
  id: string;
  issue_id: string;
  user_id: string;
  type:
    | 'comment'
    | 'status_change'
    | 'assignee_change'
    | 'priority_change'
    | 'cycle_change'
    | 'due_date_change'
    | 'estimate_change'
    | 'title_change'
    | 'description_change'
    | 'relation_added'
    | 'relation_removed'
    | 'attachment_added'
    | 'subtask_added'
    | 'created'
    | 'closed'
    | 'reopened';
  meta: string;
  created_at: string;
}

// ---------- Chat ----------

export interface ChatWidgetRow {
  id: string;
  team_id: string | null;
  user_id: string;
  name: string;
  color: string;
  position: 'bottom-right' | 'bottom-left';
  welcome_message: string | null;
  fields: string; // JSON ChatFieldDef[]
  bot_enabled: 0 | 1;
  bot_greeting: string | null;
  bot_source: 'canned' | 'docs';
  office_hours: string | null; // JSON OfficeHoursConfig
  created_at: string;
  updated_at: string;
}

export interface ChatVisitorRow {
  id: string;
  widget_id: string;
  external_id: string;
  email: string | null;
  name: string | null;
  notes: string | null;
  metadata: string; // JSON object
  created_at: string;
}

export interface ChatConversationRow {
  id: string;
  widget_id: string;
  visitor_id: string;
  status: 'open' | 'pending' | 'resolved' | 'snoozed';
  assigned_to: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  subject: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  sla_breach_at: string | null;
  snoozed_until: string | null;
  csat_score: number | null;
  csat_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'user' | 'system' | 'bot';
  user_id: string | null;
  body: string;
  attachments: string; // JSON ChatAttachment[]
  read_at: string | null;
  created_at: string;
}

export interface ChatTypingRow {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'user';
  user_id: string | null;
  expires_at: string;
}

export interface ChatAssignmentRuleRow {
  id: string;
  widget_id: string;
  name: string;
  match_type: 'all' | 'keyword' | 'time' | 'round_robin';
  match_value: string | null;
  assign_to: string | null;
  position: number;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ChatSlaPolicyRow {
  id: string;
  widget_id: string;
  name: string;
  first_response_minutes: number;
  resolution_minutes: number | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ChatCannedResponseRow {
  id: string;
  widget_id: string;
  shortcut: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: 'mention' | 'assigned' | 'status_change' | 'comment' | 'subtask' | 'relation' | 'chat_message';
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  source_type: string;
  source_id: string;
  meta: string;
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

export async function getUserById(id: string): Promise<UserRow | undefined> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow | undefined;
}

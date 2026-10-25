import type { Client } from '@libsql/client';
import { baseline } from './baseline';
import { pickHandle } from './handles';
import { stripSyncedChildren, syncedChildren } from '../docs-synced-refs';
import type { DocsBlock } from '../docs-types';
import { ACTIVITY_DATE_TABLES, ACTIVITY_DATE_TRIGGERS, activityDateTriggersSql, activityDatesUpdateSql } from '../crm-activity-dates';

/**
 * Migraciones versionadas. Cada una corre una sola vez por base y queda
 * registrada en schema_migrations. Reglas:
 * - Nunca editar ni reordenar una migración ya publicada: agregar una nueva.
 * - Deben tolerar correr en paralelo (varias instancias serverless arrancando a
 *   la vez): usar IF NOT EXISTS y `addColumn`, que ignora "duplicate column".
 * - Para reconstruir tablas (cambiar CHECK/UNIQUE) usar `client.migrate([...])`,
 *   que corre el batch con foreign keys apagadas (un DROP TABLE con FK
 *   prendidas cascadea borrando las tablas hijas).
 */
export interface Migration {
  id: string;
  up(client: Client): Promise<void>;
}

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

export const MIGRATIONS: Migration[] = [
  { id: '001_baseline', up: baseline },
  {
    // Track: dueño del proyecto. Antes solo había team_id y los proyectos
    // personales eran visibles para todos los usuarios sin team.
    id: '002_track_project_owner',
    async up(client) {
      await addColumn(
        client,
        'ALTER TABLE track_projects ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE',
      );
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_track_projects_owner ON track_projects(owner_id, team_id, status, name)',
      );
      // Backfill: proyectos de team → owner del team; personales → creador del
      // primer issue. Los que no se pueden atribuir quedan NULL (invisibles)
      // en vez de compartidos con todos.
      await client.execute(
        `UPDATE track_projects SET owner_id = (SELECT owner_id FROM teams WHERE teams.id = track_projects.team_id)
         WHERE owner_id IS NULL AND team_id IS NOT NULL`,
      );
      await client.execute(
        `UPDATE track_projects SET owner_id = (
           SELECT creator_id FROM track_issues WHERE track_issues.project_id = track_projects.id
           ORDER BY created_at ASC LIMIT 1)
         WHERE owner_id IS NULL AND team_id IS NULL`,
      );
    },
  },
  {
    // Rate limit compartido entre instancias (lib/rate-limit.ts).
    id: '003_rate_limits',
    async up(client) {
      await client.execute(
        `CREATE TABLE IF NOT EXISTS rate_limits (
           key TEXT NOT NULL,
           window_start INTEGER NOT NULL,
           count INTEGER NOT NULL DEFAULT 0,
           expires_at INTEGER NOT NULL,
           PRIMARY KEY (key, window_start)
         )`,
      );
      await client.execute('CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at)');
    },
  },
  {
    // API keys: quién la creó (member de un team) para listar/revocar por persona.
    id: '004_api_keys_created_by',
    async up(client) {
      await addColumn(client, 'ALTER TABLE api_keys ADD COLUMN created_by TEXT');
      await client.execute('UPDATE api_keys SET created_by = user_id WHERE created_by IS NULL');
    },
  },
  {
    // Handle público por usuario: los links de Cal pasan a ser /book/<handle>/<slug>.
    // Antes eran /book/<slug> y el slug solo era único por usuario: todos los
    // "30min" apuntaban al primer usuario que lo creó.
    id: '005_user_handles',
    async up(client) {
      await addColumn(client, 'ALTER TABLE users ADD COLUMN handle TEXT');
      await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle) WHERE handle IS NOT NULL',
      );
      const rows = (await client.execute('SELECT id, email FROM users WHERE handle IS NULL ORDER BY created_at ASC')).rows;
      const taken = new Set(
        (await client.execute('SELECT handle FROM users WHERE handle IS NOT NULL')).rows.map((r) => String(r.handle)),
      );
      for (const r of rows) {
        const handle = pickHandle(String(r.email), taken);
        taken.add(handle);
        await client.execute({
          sql: 'UPDATE users SET handle = ? WHERE id = ? AND handle IS NULL',
          args: [handle, String(r.id)],
        });
      }
    },
  },
  {
    // Cal: link de gestión para el invitado (cancelar/reprogramar), host siempre
    // explícito y un índice único que impide dos reservas del mismo host a la
    // misma hora (carreras entre requests simultáneas).
    id: '006_booking_manage_and_uniqueness',
    async up(client) {
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN manage_token TEXT');
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN rescheduled_from TEXT');
      const missing = (await client.execute('SELECT id FROM calendar_bookings WHERE manage_token IS NULL')).rows;
      for (const r of missing) {
        await client.execute({
          sql: 'UPDATE calendar_bookings SET manage_token = ? WHERE id = ? AND manage_token IS NULL',
          args: [crypto.randomUUID().replace(/-/g, ''), String(r.id)],
        });
      }
      await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_bookings_manage ON calendar_bookings(manage_token)',
      );
      await client.execute(
        `UPDATE calendar_bookings SET host_user_id = (
           SELECT user_id FROM calendar_event_types e WHERE e.id = calendar_bookings.event_type_id)
         WHERE host_user_id IS NULL`,
      );
      try {
        await client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_bookings_host_slot
           ON calendar_bookings(host_user_id, starts_at) WHERE status = 'confirmed'`,
        );
      } catch {
        // Si ya hay duplicados históricos el índice no se puede crear; la
        // verificación en createBooking sigue protegiendo los nuevos.
      }
    },
  },
  {
    // Cal ↔ Google Calendar: id del evento creado en el calendario del host y
    // link de la reunión (Google Meet) generado.
    id: '007_booking_google_event',
    async up(client) {
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN google_event_id TEXT');
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN meeting_url TEXT');
    },
  },
  {
    // Webhooks salientes del workspace (Cal, Link…) y su registro de entregas.
    id: '008_webhooks',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          events TEXT NOT NULL DEFAULT '[]',
          secret TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id, active);
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id TEXT PRIMARY KEY,
          webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
          attempts INTEGER NOT NULL DEFAULT 0,
          response_code INTEGER,
          last_error TEXT,
          next_attempt_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          delivered_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at DESC);
      `);
    },
  },
  {
    // Link: dominios propios. El slug pasa de ser único global a único por
    // dominio (NULL = dominio por defecto). Cambiar un UNIQUE de columna exige
    // reconstruir la tabla: se hace con client.migrate (foreign keys apagadas,
    // así el DROP no borra los clicks en cascada) y solo si sigue el UNIQUE viejo.
    id: '009_link_domains',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS link_domains (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          hostname TEXT NOT NULL UNIQUE,
          verified INTEGER NOT NULL DEFAULT 0,
          verified_at TEXT,
          root_url TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_link_domains_user ON link_domains(user_id);
      `);
      const current = await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'links'");
      const sql = String(current.rows[0]?.sql ?? '');
      if (sql && !/domain_id/.test(sql)) {
        const cols =
          'id, user_id, slug, url, title, tags, password_hash, expires_at, max_clicks, archived, redirect_type, utm_source, utm_medium, utm_campaign, og_title, og_description, og_image, clicks, created_at, updated_at';
        await client.migrate([
          `CREATE TABLE links_new (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            domain_id TEXT REFERENCES link_domains(id),
            slug TEXT NOT NULL,
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
          )`,
          `INSERT INTO links_new (${cols}) SELECT ${cols} FROM links`,
          'DROP TABLE links',
          'ALTER TABLE links_new RENAME TO links',
          'CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id, created_at DESC)',
        ]);
      }
      await client.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_links_domain_slug ON links(COALESCE(domain_id, ''), slug)",
      );
    },
  },
  {
    // Link-in-bio: página pública /@handle con los links elegidos.
    id: '010_link_bio',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS link_bio (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          bio TEXT NOT NULL DEFAULT '',
          avatar_url TEXT,
          published INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
      await addColumn(client, 'ALTER TABLE links ADD COLUMN bio_position INTEGER');
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_links_bio ON links(user_id, bio_position) WHERE bio_position IS NOT NULL',
      );
    },
  },
  {
    // Idioma del invitado: los emails de Cal (confirmación, recordatorio,
    // cancelación) salen en el idioma en que reservó.
    id: '011_booking_locale',
    async up(client) {
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
    },
  },
  {
    // CRM: el trigger task_due lo dispara el cron cuando la tarea vence (antes
    // se disparaba al crearla). Las tareas ya vencidas quedan marcadas como
    // disparadas para no generar una avalancha en el primer tick.
    id: '012_crm_task_due_fired',
    async up(client) {
      await addColumn(client, 'ALTER TABLE crm_activities ADD COLUMN due_fired_at TEXT');
      await client.execute(
        `UPDATE crm_activities SET due_fired_at = datetime('now')
         WHERE type = 'task' AND due_at IS NOT NULL AND due_at <= datetime('now') AND due_fired_at IS NULL`,
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_crm_activities_due_pending ON crm_activities(due_at)
         WHERE type = 'task' AND done = 0 AND due_fired_at IS NULL`,
      );
    },
  },  {
    // CRM ↔ suite: la actividad "meeting" sabe de qué reserva de Cal viene y la
    // nota de chat de qué conversación (para actualizarlas, no duplicarlas).
    id: '013_crm_activity_sources',
    async up(client) {
      await addColumn(client, 'ALTER TABLE crm_activities ADD COLUMN booking_id TEXT');
      await addColumn(client, 'ALTER TABLE crm_activities ADD COLUMN chat_conversation_id TEXT');
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_crm_activities_booking ON crm_activities(user_id, booking_id) WHERE booking_id IS NOT NULL',
      );
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_crm_activities_chat ON crm_activities(user_id, chat_conversation_id) WHERE chat_conversation_id IS NOT NULL',
      );
    },
  },
  {
    // Feedback de usuarios y visitantes (ideas, bugs). user_id es opcional:
    // el formulario público acepta envíos sin cuenta.
    id: '014_feedback',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          email TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('idea', 'bug', 'other')),
          product TEXT NOT NULL CHECK (product IN ('link', 'crm', 'cal', 'track', 'chat', 'docs', 'site', 'other')),
          message TEXT NOT NULL,
          page_url TEXT,
          user_agent TEXT,
          status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'done')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC)');
    },
  },
  {
    // AI: consumo de tokens por workspace (user_id = dueño del workspace) y
    // feature. Base de la cuota mensual gratis y de la facturación en la nube.
    id: '015_ai_usage',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS ai_usage (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          feature TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage(user_id, created_at)');
    },
  },
  {
    // Chat: bot_source admite 'ai'. Las bases nuevas tienen un CHECK que no se
    // puede alterar: se reconstruye la tabla reescribiendo solo el CHECK del
    // SQL original (conserva columnas agregadas por otras migraciones). Las
    // bases viejas (columna agregada por ALTER, sin CHECK) no necesitan nada.
    id: '015_ai_chat_bot_source',
    async up(client) {
      const current = await client.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_widgets'",
      );
      const sql = String(current.rows[0]?.sql ?? '');
      const check = /CHECK\s*\(\s*bot_source\s+IN\s*\(\s*'canned'\s*,\s*'docs'\s*\)\s*\)/i;
      if (!sql || !check.test(sql)) return;
      const newSql = sql
        .replace(check, "CHECK (bot_source IN ('canned', 'docs', 'ai'))")
        .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?chat_widgets["`]?/i, 'CREATE TABLE chat_widgets_new');
      const cols = (await client.execute('PRAGMA table_info(chat_widgets)')).rows
        .map((r) => `"${String(r.name)}"`)
        .join(', ');
      const indexes = (
        await client.execute(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_widgets' AND sql IS NOT NULL",
        )
      ).rows.map((r) => String(r.sql));
      await client.migrate([
        'DROP TABLE IF EXISTS chat_widgets_new',
        newSql,
        `INSERT INTO chat_widgets_new (${cols}) SELECT ${cols} FROM chat_widgets`,
        'DROP TABLE chat_widgets',
        'ALTER TABLE chat_widgets_new RENAME TO chat_widgets',
        ...indexes,
      ]);
    },
  },
  {
    // Roadmap: ítems (ideas/bugs) que salen del feedback y de las
    // conversaciones de soporte, sus señales (de dónde vino cada pedido) y los
    // votos públicos (uno por IP hasheada por ítem).
    id: '016_roadmap_items_signals_votes',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS roadmap_items (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          product TEXT NOT NULL DEFAULT 'other',
          kind TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea', 'bug')),
          status TEXT NOT NULL DEFAULT 'proposed'
            CHECK (status IN ('proposed', 'planned', 'in_progress', 'done', 'declined')),
          votes INTEGER NOT NULL DEFAULT 0,
          is_public INTEGER NOT NULL DEFAULT 0,
          shipped_changelog_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_roadmap_items_status ON roadmap_items(status, votes DESC)');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS roadmap_signals (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
          source TEXT NOT NULL CHECK (source IN ('feedback', 'chat')),
          source_id TEXT NOT NULL,
          excerpt TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_roadmap_signals_item ON roadmap_signals(item_id, created_at DESC)');
      await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_signals_source ON roadmap_signals(source, source_id)',
      );
      await client.execute(`
        CREATE TABLE IF NOT EXISTS roadmap_votes (
          item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
          ip_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (item_id, ip_hash)
        )`);
    },
  },
  {
    // Roadmap público inicial: lo que ya está en el plan de trabajo (no promesas
    // nuevas). Ids fijos para que sea idempotente; después se edita desde el admin.
    id: '016_roadmap_seed',
    async up(client) {
      const now = new Date().toISOString();
      const items: Array<[string, string, string, string, string]> = [
        ['rm_seed_agents', 'Agents: AI agents that answer in Chat and take actions', 'Agents with instructions, knowledge (Docs, URLs) and tools across the suite (CRM, Cal, Track), with human handoff.', 'other', 'in_progress'],
        ['rm_seed_flow', 'Flow: visual automations across every app', 'An open-source n8n/Zapier: triggers from every product, webhooks, schedules, conditions, delays, HTTP and AI steps.', 'other', 'in_progress'],
        ['rm_seed_notes', 'Notes: quick notes, notebooks and search', 'An Evernote-style app for personal notes, with tags, pinning, checklists and full-text search.', 'other', 'planned'],
        ['rm_seed_board', 'Board: an infinite whiteboard', 'A Miro-style canvas to sketch, plan and share boards by link.', 'other', 'planned'],
        ['rm_seed_robots', 'Robots: browser automations', 'Record steps in the browser and run them on a schedule or from Flow.', 'other', 'planned'],
        ['rm_seed_crm_email', 'CRM: automatic Gmail sync, templates and open/click tracking', 'Emails sync in the background, templates with variables, and opens and clicks on the contact timeline.', 'crm', 'planned'],
        ['rm_seed_crm_sequences', 'CRM: follow-up sequences', 'Multi-step email and task sequences that stop when the contact replies or books a meeting.', 'crm', 'planned'],
        ['rm_seed_crm_quotes', 'CRM: products, line items and quotes', 'A product catalog, line items on deals and a public quote page your customer can accept.', 'crm', 'planned'],
        ['rm_seed_track_tasks', 'Track: inline tasks, checkboxes and drag & drop', 'Add tasks inline or with C, check them off, edit in place and drag across the board. Plus a My tasks view.', 'track', 'done'],
        ['rm_seed_chat_ai', 'Chat: AI bot that answers from your public docs', 'Answers every visitor message until a teammate replies, and hands off when unsure.', 'chat', 'done'],
      ];
      for (const [id, title, description, product, status] of items) {
        await client.execute({
          sql: `INSERT OR IGNORE INTO roadmap_items (id, title, description, product, kind, status, votes, is_public, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'idea', ?, 0, 1, ?, ?)`,
          args: [id, title, description, product, status, now, now],
        });
      }
    },
  },
  {
    // Flow: automatizaciones visuales (grafo de nodos) entre las apps y
    // servicios externos. user_id = workspace (dueño). Ver lib/flow*.ts.
    id: '017_flow_tables',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_flows (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 0,
          graph TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
          version INTEGER NOT NULL DEFAULT 1,
          trigger_type TEXT,
          trigger_event TEXT,
          next_run_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_flows_user ON flow_flows(user_id, updated_at)');
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_flow_flows_trigger ON flow_flows(user_id, enabled, trigger_type, trigger_event)',
      );
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_flow_flows_schedule ON flow_flows(trigger_type, enabled, next_run_at)',
      );
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_runs (
          id TEXT PRIMARY KEY,
          flow_id TEXT NOT NULL REFERENCES flow_flows(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          trigger_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed', 'waiting')),
          input TEXT NOT NULL DEFAULT '{}',
          context TEXT NOT NULL DEFAULT '{}',
          error TEXT,
          chain_depth INTEGER NOT NULL DEFAULT 0,
          chain_seen TEXT NOT NULL DEFAULT '[]',
          step_count INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_runs_flow ON flow_runs(flow_id, created_at DESC)');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_runs_status ON flow_runs(status, created_at)');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
          node_id TEXT NOT NULL,
          node_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped', 'waiting')),
          input TEXT,
          output TEXT,
          error TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_steps_run ON flow_steps(run_id, started_at)');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_jobs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
          node_id TEXT NOT NULL,
          run_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          payload TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_jobs_due ON flow_jobs(run_at)');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_jobs_run ON flow_jobs(run_id)');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_webhooks (
          id TEXT PRIMARY KEY,
          flow_id TEXT NOT NULL REFERENCES flow_flows(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          node_id TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          UNIQUE (flow_id, node_id)
        )`);
    },
  },
  {
    // Feedback: 'flow' como producto. Mismo rebuild que 015_ai_chat_bot_source
    // (reescribe solo el CHECK y conserva columnas, filas e índices).
    id: '017_flow_feedback_product',
    async up(client) {
      const current = await client.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'feedback'",
      );
      const sql = String(current.rows[0]?.sql ?? '');
      const check = /CHECK\s*\(\s*product\s+IN\s*\(([^)]*)\)\s*\)/i;
      const m = check.exec(sql);
      if (!sql || !m || /'flow'/.test(m[1])) return;
      const newSql = sql
        .replace(check, `CHECK (product IN (${m[1].trim()}, 'flow'))`)
        .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?feedback["`]?/i, 'CREATE TABLE feedback_new');
      const cols = (await client.execute('PRAGMA table_info(feedback)')).rows
        .map((r) => `"${String(r.name)}"`)
        .join(', ');
      const indexes = (
        await client.execute(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'feedback' AND sql IS NOT NULL",
        )
      ).rows.map((r) => String(r.sql));
      await client.migrate([
        'DROP TABLE IF EXISTS feedback_new',
        newSql,
        `INSERT INTO feedback_new (${cols}) SELECT ${cols} FROM feedback`,
        'DROP TABLE feedback',
        'ALTER TABLE feedback_new RENAME TO feedback',
        ...indexes,
      ]);
    },
  },
  {
    // Flow salió: el ítem del roadmap pasa a "hecho".
    id: '017_flow_roadmap_done',
    async up(client) {
      await client.execute(
        "UPDATE roadmap_items SET status = 'done', updated_at = datetime('now') WHERE id = 'rm_seed_flow' AND status = 'in_progress'",
      );
    },
  },
  {
    // Notes: notas personales (por persona dentro del workspace), con libretas,
    // tags (JSON), fijadas, papelera y link público opcional.
    id: '018_notes_core',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS note_notebooks (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_note_notebooks_owner ON note_notebooks(workspace_id, person_id, name)',
      );
      await client.execute(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          notebook_id TEXT REFERENCES note_notebooks(id) ON DELETE SET NULL,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '[]',
          body_text TEXT NOT NULL DEFAULT '',
          tags TEXT NOT NULL DEFAULT '[]',
          pinned INTEGER NOT NULL DEFAULT 0,
          source_url TEXT,
          share_token TEXT UNIQUE,
          trashed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes(workspace_id, person_id, trashed_at, updated_at DESC)',
      );
      await client.execute('CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id)');
    },
  },
  {
    // Búsqueda full-text de Notes con FTS5 (libsql la trae en modo archivo y en
    // Turso). Si el motor no la soporta, la migración no falla: lib/notes.ts
    // detecta que falta notes_fts y cae a LIKE.
    id: '018_notes_fts',
    async up(client) {
      try {
        await client.execute(
          "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(note_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2')",
        );
      } catch {
        return;
      }
      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts (note_id, title, body) VALUES (new.id, new.title, new.body_text);
        END`);
      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE OF title, body_text ON notes BEGIN
          DELETE FROM notes_fts WHERE note_id = old.id;
          INSERT INTO notes_fts (note_id, title, body) VALUES (new.id, new.title, new.body_text);
        END`);
      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
          DELETE FROM notes_fts WHERE note_id = old.id;
        END`);
      // Notas previas (si las hubiera) entran al índice.
      await client.execute(
        'INSERT INTO notes_fts (note_id, title, body) SELECT id, title, body_text FROM notes WHERE id NOT IN (SELECT note_id FROM notes_fts)',
      );
    },
  },
  {
    // Board: pizarras del workspace (visibles para el team). La escena de
    // Excalidraw va como JSON con versión para last-write-wins con chequeo.
    id: '018_board_core',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS boards (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          scene TEXT NOT NULL DEFAULT '',
          scene_bytes INTEGER NOT NULL DEFAULT 0,
          thumbnail TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          share_token TEXT UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_boards_workspace ON boards(workspace_id, updated_at DESC)');
    },
  },
  {
    // Feedback: Notes y Board como productos. Se saca el CHECK de `product`
    // (la validación vive en zod, FEEDBACK_PRODUCTS) para que sumar productos
    // no exija reconstruir la tabla cada vez. Mismo método que 015.
    id: '018_notes_feedback_products',
    async up(client) {
      const current = await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'feedback'");
      const sql = String(current.rows[0]?.sql ?? '');
      const check = /\s*CHECK\s*\(\s*product\s+IN\s*\([^)]*\)\s*\)/i;
      if (!sql || !check.test(sql)) return;
      const newSql = sql
        .replace(check, '')
        .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?feedback["`]?/i, 'CREATE TABLE feedback_new');
      const cols = (await client.execute('PRAGMA table_info(feedback)')).rows.map((r) => `"${String(r.name)}"`).join(', ');
      const indexes = (
        await client.execute(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'feedback' AND sql IS NOT NULL",
        )
      ).rows.map((r) => String(r.sql));
      await client.migrate([
        'DROP TABLE IF EXISTS feedback_new',
        newSql,
        `INSERT INTO feedback_new (${cols}) SELECT ${cols} FROM feedback`,
        'DROP TABLE feedback',
        'ALTER TABLE feedback_new RENAME TO feedback',
        ...indexes,
      ]);
    },
  },
  {
    // Notes y Board salieron: sus ítems del roadmap pasan a "hecho".
    id: '018_notes_board_roadmap_done',
    async up(client) {
      await client.execute(
        "UPDATE roadmap_items SET status = 'done', updated_at = datetime('now') WHERE id IN ('rm_seed_notes', 'rm_seed_board') AND status IN ('planned', 'in_progress')",
      );
    },
  },
  {
    // Agents: agentes de AI con instrucciones, conocimiento y herramientas de
    // la suite. user_id = workspace (dueño). Ver lib/agents*.ts.
    id: '019_agents_tables',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL DEFAULT '',
          instructions TEXT NOT NULL DEFAULT '',
          welcome_message TEXT NOT NULL DEFAULT '',
          model TEXT,
          temperature REAL NOT NULL DEFAULT 0.3,
          knowledge TEXT NOT NULL DEFAULT '{}',
          tools TEXT NOT NULL DEFAULT '{}',
          handoff TEXT NOT NULL DEFAULT '{}',
          guardrails TEXT NOT NULL DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1,
          public_handle TEXT UNIQUE,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id, updated_at)');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_knowledge_urls (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
          error TEXT,
          fetched_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (agent_id, url)
        )`);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_conversations (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          channel TEXT NOT NULL CHECK (channel IN ('playground', 'public', 'api', 'chat')),
          chat_conversation_id TEXT UNIQUE,
          visitor_key TEXT,
          title TEXT NOT NULL DEFAULT '',
          handed_off INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_conversations_agent ON agent_conversations(agent_id, updated_at DESC)',
      );
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          run_id TEXT,
          created_at TEXT NOT NULL
        )`);
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON agent_messages(conversation_id, created_at)',
      );
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_tool_calls (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          input TEXT NOT NULL DEFAULT '{}',
          output TEXT,
          error TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )`);
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_conversation ON agent_tool_calls(conversation_id, created_at)',
      );
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_feedback (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
          message_id TEXT NOT NULL UNIQUE,
          rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
          note TEXT NOT NULL DEFAULT '',
          created_by TEXT,
          created_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_agent_feedback_agent ON agent_feedback(agent_id, created_at)');
    },
  },
  {
    // Chat: un widget puede delegar en un agente (bot_source = 'agent' +
    // agent_id). Mismo rebuild seguro que 015_ai_chat_bot_source: reescribe solo
    // el CHECK conservando columnas, filas e índices (client.migrate apaga las
    // FKs durante el batch, así no se borran conversaciones en cascada).
    id: '019_agents_chat_widget_agent',
    async up(client) {
      const current = await client.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_widgets'",
      );
      const sql = String(current.rows[0]?.sql ?? '');
      const check = /CHECK\s*\(\s*bot_source\s+IN\s*\(([^)]*)\)\s*\)/i;
      const m = check.exec(sql);
      if (sql && m && !/'agent'/.test(m[1])) {
        const newSql = sql
          .replace(check, `CHECK (bot_source IN (${m[1].trim()}, 'agent'))`)
          .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?chat_widgets["`]?/i, 'CREATE TABLE chat_widgets_new');
        const cols = (await client.execute('PRAGMA table_info(chat_widgets)')).rows
          .map((r) => `"${String(r.name)}"`)
          .join(', ');
        const indexes = (
          await client.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_widgets' AND sql IS NOT NULL",
          )
        ).rows.map((r) => String(r.sql));
        await client.migrate([
          'DROP TABLE IF EXISTS chat_widgets_new',
          newSql,
          `INSERT INTO chat_widgets_new (${cols}) SELECT ${cols} FROM chat_widgets`,
          'DROP TABLE chat_widgets',
          'ALTER TABLE chat_widgets_new RENAME TO chat_widgets',
          ...indexes,
        ]);
      }
      const hasAgentId = (await client.execute('PRAGMA table_info(chat_widgets)')).rows.some(
        (r) => String(r.name) === 'agent_id',
      );
      if (!hasAgentId) {
        try {
          await client.execute('ALTER TABLE chat_widgets ADD COLUMN agent_id TEXT');
        } catch (err) {
          // Otra instancia migrando a la vez ya la agregó.
          if (!/duplicate column/i.test(String(err))) throw err;
        }
      }
    },
  },
  {
    // Feedback: 'agents' como producto (mismo rebuild que 017_flow_feedback_product).
    id: '019_agents_feedback_product',
    async up(client) {
      const current = await client.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'feedback'",
      );
      const sql = String(current.rows[0]?.sql ?? '');
      const check = /CHECK\s*\(\s*product\s+IN\s*\(([^)]*)\)\s*\)/i;
      const m = check.exec(sql);
      if (!sql || !m || /'agents'/.test(m[1])) return;
      const newSql = sql
        .replace(check, `CHECK (product IN (${m[1].trim()}, 'agents'))`)
        .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?feedback["`]?/i, 'CREATE TABLE feedback_new');
      const cols = (await client.execute('PRAGMA table_info(feedback)')).rows
        .map((r) => `"${String(r.name)}"`)
        .join(', ');
      const indexes = (
        await client.execute(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'feedback' AND sql IS NOT NULL",
        )
      ).rows.map((r) => String(r.sql));
      await client.migrate([
        'DROP TABLE IF EXISTS feedback_new',
        newSql,
        `INSERT INTO feedback_new (${cols}) SELECT ${cols} FROM feedback`,
        'DROP TABLE feedback',
        'ALTER TABLE feedback_new RENAME TO feedback',
        ...indexes,
      ]);
    },
  },
  {
    // Agents salió: su ítem del roadmap pasa a "hecho".
    id: '019_agents_roadmap_done',
    async up(client) {
      await client.execute(
        "UPDATE roadmap_items SET status = 'done', updated_at = datetime('now') WHERE id = 'rm_seed_agents' AND status IN ('planned', 'in_progress')",
      );
    },
  },
  {
    // Robots: automatizaciones de navegador (RPA) que corren en un Chromium
    // aislado (Vercel Sandbox o runner local). user_id = workspace (dueño).
    // robot_usage mide minutos por mes (cuota); robot_runtime guarda el id
    // del snapshot del sandbox. Ver lib/robots*.ts.
    id: '020_robots_tables',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS robots (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          steps TEXT NOT NULL DEFAULT '[]',
          inputs TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 1,
          schedule TEXT,
          next_run_at TEXT,
          timeout_sec INTEGER NOT NULL DEFAULT 120,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_robots_user ON robots(user_id, updated_at)');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_robots_schedule ON robots(enabled, next_run_at)');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS robot_runs (
          id TEXT PRIMARY KEY,
          robot_id TEXT NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
          trigger TEXT NOT NULL DEFAULT 'manual',
          input TEXT NOT NULL DEFAULT '{}',
          output TEXT NOT NULL DEFAULT '{}',
          error TEXT,
          logs TEXT NOT NULL DEFAULT '[]',
          screenshots TEXT NOT NULL DEFAULT '[]',
          backend TEXT,
          created_by TEXT,
          locked_until TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          duration_ms INTEGER
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_robot_runs_robot ON robot_runs(robot_id, created_at)');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_robot_runs_user ON robot_runs(user_id, status, created_at)');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS robot_usage (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          month TEXT NOT NULL,
          runs INTEGER NOT NULL DEFAULT 0,
          ms INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, month)
        )`);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS robot_runtime (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
    },
  },
  {
    // Robots salió: su ítem del roadmap pasa a "hecho".
    id: '020_robots_roadmap_done',
    async up(client) {
      await client.execute(
        "UPDATE roadmap_items SET status = 'done', updated_at = datetime('now') WHERE id = 'rm_seed_robots' AND status IN ('planned', 'in_progress')",
      );
    },
  },
  {
    // CRM email (bloque 2): sync incremental de Gmail, threads, tracking de
    // aperturas/clicks, templates/snippets y secuencias.
    id: '021_crm_email_sales',
    async up(client) {
      for (const sql of [
        "ALTER TABLE crm_emails ADD COLUMN message_id TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE crm_emails ADD COLUMN in_reply_to TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE crm_emails ADD COLUMN cc_emails TEXT NOT NULL DEFAULT ''",
        'ALTER TABLE crm_emails ADD COLUMN person_id TEXT',
        'ALTER TABLE crm_emails ADD COLUMN activity_id TEXT',
        'ALTER TABLE crm_emails ADD COLUMN tracking_token TEXT',
        'ALTER TABLE crm_emails ADD COLUMN open_count INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE crm_emails ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE crm_emails ADD COLUMN first_opened_at TEXT',
        'ALTER TABLE crm_emails ADD COLUMN last_opened_at TEXT',
        'ALTER TABLE crm_emails ADD COLUMN replied_at TEXT',
        'ALTER TABLE crm_emails ADD COLUMN enrollment_id TEXT',
        'ALTER TABLE crm_emails ADD COLUMN step_id TEXT',
      ]) {
        await addColumn(client, sql);
      }
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_crm_emails_thread ON crm_emails(user_id, thread_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_emails_tracking ON crm_emails(tracking_token) WHERE tracking_token IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_crm_emails_step ON crm_emails(step_id) WHERE step_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS crm_email_contacts (
          email_id TEXT NOT NULL REFERENCES crm_emails(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (email_id, contact_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_email_contacts_contact ON crm_email_contacts(user_id, contact_id);
        INSERT OR IGNORE INTO crm_email_contacts (email_id, contact_id, user_id)
          SELECT id, contact_id, user_id FROM crm_emails;

        CREATE TABLE IF NOT EXISTS crm_email_sync (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          history_id TEXT,
          status TEXT NOT NULL DEFAULT 'idle',
          error TEXT,
          last_sync_at TEXT,
          last_full_sync_at TEXT,
          locked_until TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, person_id)
        );
        INSERT OR IGNORE INTO crm_email_sync (user_id, person_id)
          SELECT user_id, user_id FROM integrations WHERE provider = 'gmail';

        CREATE TABLE IF NOT EXISTS crm_email_events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email_id TEXT NOT NULL REFERENCES crm_emails(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_email_events_email ON crm_email_events(email_id, kind, created_at);

        CREATE TABLE IF NOT EXISTS crm_email_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          tracking_enabled INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_email_unsubscribes (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, email)
        );

        CREATE TABLE IF NOT EXISTS crm_email_templates (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_by TEXT,
          kind TEXT NOT NULL DEFAULT 'template',
          name TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_email_templates_user ON crm_email_templates(user_id, kind, name);

        CREATE TABLE IF NOT EXISTS crm_sequences (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_by TEXT,
          name TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          window_start TEXT NOT NULL DEFAULT '09:00',
          window_end TEXT NOT NULL DEFAULT '17:00',
          business_days INTEGER NOT NULL DEFAULT 1,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_sequences_user ON crm_sequences(user_id, archived, updated_at DESC);

        CREATE TABLE IF NOT EXISTS crm_sequence_steps (
          id TEXT PRIMARY KEY,
          sequence_id TEXT NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          type TEXT NOT NULL,
          wait_days INTEGER NOT NULL DEFAULT 0,
          template_id TEXT,
          subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          new_thread INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_crm_sequence_steps_seq ON crm_sequence_steps(sequence_id, position);

        CREATE TABLE IF NOT EXISTS crm_sequence_enrollments (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          sequence_id TEXT NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
          contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL,
          enrolled_by TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          exit_reason TEXT,
          current_step INTEGER NOT NULL DEFAULT 0,
          next_run_at TEXT,
          thread_id TEXT NOT NULL DEFAULT '',
          last_message_id TEXT NOT NULL DEFAULT '',
          thread_subject TEXT NOT NULL DEFAULT '',
          locked_until TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_crm_seq_enroll_due ON crm_sequence_enrollments(status, next_run_at);
        CREATE INDEX IF NOT EXISTS idx_crm_seq_enroll_contact ON crm_sequence_enrollments(user_id, contact_id, status);
        CREATE INDEX IF NOT EXISTS idx_crm_seq_enroll_seq ON crm_sequence_enrollments(sequence_id, status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_seq_enroll_live ON crm_sequence_enrollments(sequence_id, contact_id)
          WHERE status IN ('active', 'paused');
      `);
    },
  },
  {
    // Email de ventas del CRM salió: sus ítems del roadmap pasan a "hecho".
    id: '021_crm_email_roadmap_done',
    async up(client) {
      await client.execute(
        "UPDATE roadmap_items SET status = 'done', updated_at = datetime('now') WHERE id IN ('rm_seed_crm_email', 'rm_seed_crm_sequences') AND status IN ('planned', 'in_progress')",
      );
    },
  },
  {
    // CRM — modelo de datos nivel HubSpot (bloque 3): asociaciones
    // many-to-many con primaria (deal↔company, contact↔company con label),
    // jerarquía de empresas, tags, productos, line items, quotes,
    // multi-moneda y presets de import. crm_contacts.company_id queda como
    // espejo de la empresa primaria (compatibilidad). Ver lib/crm-assoc.ts.
    id: '022_crm_model_tables',
    async up(client) {
      await addColumn(client, 'ALTER TABLE crm_companies ADD COLUMN parent_company_id TEXT');
      await addColumn(client, 'ALTER TABLE crm_deals ADD COLUMN amount_override INTEGER NOT NULL DEFAULT 0');
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_crm_companies_parent ON crm_companies(user_id, parent_company_id);

        CREATE TABLE IF NOT EXISTS crm_contact_companies (
          contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          is_primary INTEGER NOT NULL DEFAULT 0,
          label TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (contact_id, company_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_contact_companies_company ON crm_contact_companies(company_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contact_companies_primary
          ON crm_contact_companies(contact_id) WHERE is_primary = 1;

        CREATE TABLE IF NOT EXISTS crm_deal_companies (
          deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          company_id TEXT NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (deal_id, company_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_deal_companies_company ON crm_deal_companies(company_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_deal_companies_primary
          ON crm_deal_companies(deal_id) WHERE is_primary = 1;

        CREATE TABLE IF NOT EXISTS crm_tags (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT 'crm',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tags_name ON crm_tags(user_id, name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS crm_record_tags (
          tag_id TEXT NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity TEXT NOT NULL CHECK (entity IN ('contact', 'company', 'deal')),
          record_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (tag_id, entity, record_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_record_tags_record ON crm_record_tags(user_id, entity, record_id);

        CREATE TRIGGER IF NOT EXISTS trg_crm_contacts_del_tags AFTER DELETE ON crm_contacts BEGIN
          DELETE FROM crm_record_tags WHERE entity = 'contact' AND record_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_crm_companies_del_tags AFTER DELETE ON crm_companies BEGIN
          DELETE FROM crm_record_tags WHERE entity = 'company' AND record_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trg_crm_deals_del_tags AFTER DELETE ON crm_deals BEGIN
          DELETE FROM crm_record_tags WHERE entity = 'deal' AND record_id = OLD.id;
        END;

        CREATE TABLE IF NOT EXISTS crm_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          base_currency TEXT NOT NULL DEFAULT 'USD',
          quote_accept_moves_deal INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_exchange_rates (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          currency TEXT NOT NULL,
          rate REAL NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, currency)
        );

        CREATE TABLE IF NOT EXISTS crm_products (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sku TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          price REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'USD',
          recurring TEXT NOT NULL DEFAULT 'none' CHECK (recurring IN ('none', 'monthly', 'yearly')),
          tax_pct REAL NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_products_user ON crm_products(user_id, active, name);

        CREATE TABLE IF NOT EXISTS crm_line_items (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES crm_products(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          sku TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          quantity REAL NOT NULL DEFAULT 1,
          unit_price REAL NOT NULL DEFAULT 0,
          discount_pct REAL NOT NULL DEFAULT 0,
          tax_pct REAL NOT NULL DEFAULT 0,
          recurring TEXT NOT NULL DEFAULT 'none',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_line_items_deal ON crm_line_items(deal_id, position);

        CREATE TABLE IF NOT EXISTS crm_quotes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          number TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
          token TEXT NOT NULL UNIQUE,
          currency TEXT NOT NULL DEFAULT 'USD',
          items TEXT NOT NULL DEFAULT '[]',
          subtotal REAL NOT NULL DEFAULT 0,
          discount_total REAL NOT NULL DEFAULT 0,
          tax_total REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          expires_at TEXT,
          terms TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          sender_name TEXT NOT NULL DEFAULT '',
          sender_email TEXT NOT NULL DEFAULT '',
          sender_company TEXT NOT NULL DEFAULT '',
          recipient_name TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL DEFAULT '',
          recipient_company TEXT NOT NULL DEFAULT '',
          created_by TEXT,
          sent_at TEXT,
          accepted_at TEXT,
          declined_at TEXT,
          signer_name TEXT NOT NULL DEFAULT '',
          signer_ip_hash TEXT NOT NULL DEFAULT '',
          decline_reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_quotes_user ON crm_quotes(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_quotes_deal ON crm_quotes(deal_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_import_presets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity TEXT NOT NULL,
          name TEXT NOT NULL,
          mapping TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_import_presets_user ON crm_import_presets(user_id, entity, name);
      `);

      // Backfill contact ↔ company: la empresa actual pasa a ser la primaria
      // (solo si la empresa es del mismo workspace).
      await client.execute(`
        INSERT OR IGNORE INTO crm_contact_companies (contact_id, company_id, user_id, is_primary, label, created_at)
        SELECT c.id, c.company_id, c.user_id, 1, '', c.created_at
        FROM crm_contacts c
        JOIN crm_companies co ON co.id = c.company_id AND co.user_id = c.user_id
        WHERE c.company_id IS NOT NULL`);

      // Backfill deal ↔ company. Si algún día existió crm_deals.company_id se
      // usa como primaria; si no, la empresa del primer contacto vinculado.
      // Las empresas de los demás contactos quedan asociadas (no primarias),
      // igual que las mostraba la ficha de empresa hasta ahora.
      const dealCols = (await client.execute('PRAGMA table_info(crm_deals)')).rows.map((r) => String(r.name));
      if (dealCols.includes('company_id')) {
        await client.execute(`
          INSERT OR IGNORE INTO crm_deal_companies (deal_id, company_id, user_id, is_primary)
          SELECT d.id, d.company_id, d.user_id, 1 FROM crm_deals d
          JOIN crm_companies co ON co.id = d.company_id AND co.user_id = d.user_id
          WHERE d.company_id IS NOT NULL`);
      }
      await client.execute(`
        INSERT OR IGNORE INTO crm_deal_companies (deal_id, company_id, user_id, is_primary)
        SELECT d.id, c.company_id, d.user_id, 1
        FROM crm_deals d
        JOIN crm_contacts c ON c.id = (
          SELECT dc.contact_id FROM crm_deal_contacts dc
          JOIN crm_contacts cc ON cc.id = dc.contact_id
          JOIN crm_companies cco ON cco.id = cc.company_id AND cco.user_id = cc.user_id
          WHERE dc.deal_id = d.id
          ORDER BY dc.rowid LIMIT 1)
        WHERE NOT EXISTS (SELECT 1 FROM crm_deal_companies x WHERE x.deal_id = d.id AND x.is_primary = 1)`);
      await client.execute(`
        INSERT OR IGNORE INTO crm_deal_companies (deal_id, company_id, user_id, is_primary)
        SELECT DISTINCT d.id, c.company_id, d.user_id, 0
        FROM crm_deals d
        JOIN crm_deal_contacts dc ON dc.deal_id = d.id
        JOIN crm_contacts c ON c.id = dc.contact_id
        JOIN crm_companies co ON co.id = c.company_id AND co.user_id = d.user_id`);
    },
  },
  {
    // Productos, line items y quotes salieron: su ítem del roadmap pasa a "hecho".
    id: '022_crm_model_roadmap_done',
    async up(client) {
      await client.execute(
        "UPDATE roadmap_items SET status = 'done', updated_at = datetime('now') WHERE id = 'rm_seed_crm_quotes' AND status IN ('planned', 'in_progress')",
      );
    },
  },
  {
    // CRM bloque 4: formularios (hosted + embed), envíos y lead scoring.
    id: '023_crm_forms_scoring',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_forms (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          slug TEXT,
          token TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
          fields TEXT NOT NULL DEFAULT '[]',
          settings TEXT NOT NULL DEFAULT '{}',
          submission_count INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_forms_slug ON crm_forms(slug) WHERE slug IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_crm_forms_user ON crm_forms(user_id, status, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_form_submissions (
          id TEXT PRIMARY KEY,
          form_id TEXT NOT NULL REFERENCES crm_forms(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id TEXT REFERENCES crm_contacts(id) ON DELETE SET NULL,
          contact_created INTEGER NOT NULL DEFAULT 0,
          data TEXT NOT NULL DEFAULT '{}',
          utm TEXT NOT NULL DEFAULT '{}',
          page_url TEXT NOT NULL DEFAULT '',
          referrer TEXT NOT NULL DEFAULT '',
          ip_hash TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_form_submissions_form ON crm_form_submissions(form_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_form_submissions_contact ON crm_form_submissions(user_id, contact_id, created_at);

        CREATE TABLE IF NOT EXISTS crm_score_rules (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL CHECK (kind IN ('property', 'activity')),
          config TEXT NOT NULL DEFAULT '{}',
          points INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_score_rules_user ON crm_score_rules(user_id, position);

        CREATE TABLE IF NOT EXISTS crm_score_state (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          last_full_run TEXT
        );
      `);
      await addColumn(client, 'ALTER TABLE crm_contacts ADD COLUMN score INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, "ALTER TABLE crm_contacts ADD COLUMN score_breakdown TEXT NOT NULL DEFAULT '[]'");
      await addColumn(client, 'ALTER TABLE crm_contacts ADD COLUMN score_updated_at TEXT');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_crm_contacts_score ON crm_contacts(user_id, score)');
    },
  },
  {
    // CRM bloque 5: visibilidad por owner, equipos de venta, scopes de API
    // keys, round-robin de leads y cuotas.
    id: '023_crm_teams_visibility',
    async up(client) {
      await addColumn(client, "ALTER TABLE crm_settings ADD COLUMN member_visibility TEXT NOT NULL DEFAULT 'all'");
      // '*' = todos los scopes: las keys existentes siguen funcionando igual.
      await addColumn(client, "ALTER TABLE api_keys ADD COLUMN scopes TEXT NOT NULL DEFAULT '*'");
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_sales_teams (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_sales_teams_user ON crm_sales_teams(user_id, name);

        CREATE TABLE IF NOT EXISTS crm_sales_team_members (
          team_id TEXT NOT NULL REFERENCES crm_sales_teams(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          PRIMARY KEY (team_id, person_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_sales_team_members_person ON crm_sales_team_members(user_id, person_id);

        CREATE TABLE IF NOT EXISTS crm_assignment_rules (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          enabled INTEGER NOT NULL DEFAULT 0,
          sources TEXT NOT NULL DEFAULT '[]',
          pool TEXT NOT NULL DEFAULT '[]',
          cursor INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_member_availability (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          available INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, person_id)
        );

        CREATE TABLE IF NOT EXISTS crm_assignment_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id TEXT REFERENCES crm_contacts(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT '',
          method TEXT NOT NULL DEFAULT 'round_robin',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_assignment_history_user ON crm_assignment_history(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_quotas (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          metric TEXT NOT NULL CHECK (metric IN ('won_value', 'won_count', 'meetings')),
          period TEXT NOT NULL CHECK (period IN ('month', 'quarter')),
          target REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_quotas_unique ON crm_quotas(user_id, person_id, metric, period);
      `);
    },
  },
  {
    // Docs: orden manual entre hermanos del árbol de páginas y ajustes de
    // página persistidos (texto chico / ancho completo). position NULL = sin
    // orden manual (se ordena como antes, por updated_at).
    id: '024_docs_page_layout',
    async up(client) {
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN position INTEGER');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN small_text INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN full_width INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    // Flow: credenciales por workspace (cifradas con AES-256-GCM, ver
    // lib/flow-credentials.ts). Las usan los nodos de integraciones y Robots.
    id: '026_flow_credentials',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_credentials (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          hint TEXT NOT NULL DEFAULT '',
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_credentials_name ON flow_credentials(user_id, name)');
    },
  },
  {
    // Flow: historial de versiones (un snapshot del grafo por guardado), flow
    // de error, re-ejecución desde un paso y sub-flows.
    id: '026_flow_versions_errors',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_versions (
          id TEXT PRIMARY KEY,
          flow_id TEXT NOT NULL REFERENCES flow_flows(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          graph TEXT NOT NULL,
          created_by TEXT,
          created_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_versions_flow ON flow_versions(flow_id, created_at DESC)');
      await addColumn(client, 'ALTER TABLE flow_flows ADD COLUMN error_flow_id TEXT');
      await addColumn(client, 'ALTER TABLE flow_runs ADD COLUMN rerun_of TEXT');
      await addColumn(client, 'ALTER TABLE flow_runs ADD COLUMN parent_run_id TEXT');
    },
  },
  {
    // Robots: sesión guardada (cookies + localStorage cifrados) entre corridas.
    id: '026_robot_sessions',
    async up(client) {
      await addColumn(client, 'ALTER TABLE robots ADD COLUMN persist_session INTEGER NOT NULL DEFAULT 0');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS robot_sessions (
          robot_id TEXT PRIMARY KEY REFERENCES robots(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
    },
  },
  {
    // Docs → centro de ayuda: `published` (página web pública en /h/<handle>/<slug>)
    // separado de `is_public` (que pasa a significar "la IA del Chat puede
    // leerla"). slug estable por workspace + feedback "¿Te sirvió?".
    id: '025_docs_help_center',
    async up(client) {
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN published INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN slug TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN published_at TEXT');
      await client.executeMultiple(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_pages_slug ON docs_pages(user_id, slug) WHERE slug IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_docs_pages_published ON docs_pages(user_id, published, archived);
        CREATE TABLE IF NOT EXISTS docs_feedback (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          helpful INTEGER NOT NULL CHECK (helpful IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_docs_feedback_page ON docs_feedback(page_id, helpful);
      `);
    },
  },
  {
    // Docs: rol de los shares (ver / editar) para invitar miembros.
    id: '025_docs_share_roles',
    async up(client) {
      await addColumn(client, "ALTER TABLE docs_shares ADD COLUMN role TEXT NOT NULL DEFAULT 'view'");
    },
  },
  {
    // Docs: historial de versiones (snapshots al guardar, con tope por página).
    id: '025_docs_versions',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS docs_versions (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          title TEXT NOT NULL DEFAULT '',
          icon TEXT,
          content TEXT NOT NULL DEFAULT '[]',
          kind TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto', 'manual', 'restore')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_docs_versions_page ON docs_versions(page_id, created_at DESC);
      `);
    },
  },
  {
    // Chat: notas internas (mensajes de agente que el visitante nunca ve),
    // tags de conversación, macros (acciones en canned responses) y la
    // pestaña de ayuda del widget (artículos publicados de Docs).
    id: '025_chat_inbox_tools',
    async up(client) {
      await addColumn(client, 'ALTER TABLE chat_messages ADD COLUMN is_note INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, "ALTER TABLE chat_canned_responses ADD COLUMN actions TEXT NOT NULL DEFAULT '{}'");
      await addColumn(client, 'ALTER TABLE chat_widgets ADD COLUMN help_enabled INTEGER NOT NULL DEFAULT 0');
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS chat_conversation_tags (
          conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (conversation_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_chat_conversation_tags_tag ON chat_conversation_tags(tag, conversation_id);
      `);
    },
  },
  // ---------- Cal (fase D9) ----------
  {
    // Cal: horarios reutilizables (nombre, zona, horas semanales) asignables a
    // tipos de evento + excepciones por fecha. No destructiva: la
    // disponibilidad por evento (calendar_availability) queda intacta; cada
    // conjunto distinto de reglas de un usuario pasa a un horario y el evento
    // apunta a él. El más usado queda como horario por defecto.
    id: '027_cal_schedules',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS calendar_schedules (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_schedules_user ON calendar_schedules(user_id, is_default DESC, name);

        CREATE TABLE IF NOT EXISTS calendar_schedule_rules (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES calendar_schedules(id) ON DELETE CASCADE,
          day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_schedule_rules_schedule ON calendar_schedule_rules(schedule_id, day_of_week);

        -- start_time/end_time NULL = día no disponible; con horas, reemplazan
        -- las horas semanales de esa fecha (puede haber varios rangos).
        CREATE TABLE IF NOT EXISTS calendar_schedule_overrides (
          id TEXT PRIMARY KEY,
          schedule_id TEXT NOT NULL REFERENCES calendar_schedules(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          start_time TEXT,
          end_time TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_schedule_overrides_schedule ON calendar_schedule_overrides(schedule_id, date);
      `);
      await addColumn(
        client,
        'ALTER TABLE calendar_event_types ADD COLUMN schedule_id TEXT REFERENCES calendar_schedules(id) ON DELETE SET NULL',
      );

      const users = (
        await client.execute(
          `SELECT DISTINCT e.user_id FROM calendar_event_types e
           WHERE e.schedule_id IS NULL
             AND EXISTS (SELECT 1 FROM calendar_availability a WHERE a.event_type_id = e.id)
             AND NOT EXISTS (SELECT 1 FROM calendar_schedules s WHERE s.user_id = e.user_id)`,
        )
      ).rows.map((r) => String(r.user_id));
      for (const userId of users) {
        const tzRow = (await client.execute({ sql: 'SELECT timezone FROM calendar_users WHERE user_id = ?', args: [userId] }))
          .rows[0];
        const tz = tzRow ? String(tzRow.timezone) : 'UTC';
        const rules = (
          await client.execute({
            sql: `SELECT e.id AS event_type_id, e.title, a.day_of_week, a.start_time, a.end_time
                  FROM calendar_event_types e JOIN calendar_availability a ON a.event_type_id = e.id
                  WHERE e.user_id = ? AND e.schedule_id IS NULL
                  ORDER BY e.created_at, e.id, a.day_of_week, a.start_time, a.end_time`,
            args: [userId],
          })
        ).rows;
        // Firma de cada evento = sus reglas ordenadas; eventos con la misma
        // firma comparten horario.
        const byEvent = new Map<string, { title: string; rules: Array<[number, string, string]> }>();
        for (const r of rules) {
          const key = String(r.event_type_id);
          const entry = byEvent.get(key) ?? { title: String(r.title), rules: [] };
          entry.rules.push([Number(r.day_of_week), String(r.start_time), String(r.end_time)]);
          byEvent.set(key, entry);
        }
        const groups = new Map<string, { title: string; rules: Array<[number, string, string]>; events: string[] }>();
        for (const [eventId, entry] of byEvent) {
          const sig = JSON.stringify(entry.rules);
          const g = groups.get(sig) ?? { title: entry.title, rules: entry.rules, events: [] };
          g.events.push(eventId);
          groups.set(sig, g);
        }
        const ordered = [...groups.values()].sort((a, b) => b.events.length - a.events.length);
        for (let i = 0; i < ordered.length; i++) {
          const g = ordered[i];
          const scheduleId = crypto.randomUUID();
          await client.execute({
            sql: 'INSERT INTO calendar_schedules (id, user_id, name, timezone, is_default) VALUES (?, ?, ?, ?, ?)',
            args: [scheduleId, userId, i === 0 ? 'Horario principal' : g.title.slice(0, 80), tz, i === 0 ? 1 : 0],
          });
          for (const [dow, start, end] of g.rules) {
            await client.execute({
              sql: 'INSERT INTO calendar_schedule_rules (id, schedule_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
              args: [crypto.randomUUID(), scheduleId, dow, start, end],
            });
          }
          for (const eventId of g.events) {
            await client.execute({
              sql: 'UPDATE calendar_event_types SET schedule_id = ? WHERE id = ? AND schedule_id IS NULL',
              args: [scheduleId, eventId],
            });
          }
        }
      }
    },
  },
  {
    // Cal: workflows de recordatorio por tipo de evento. Cada paso manda un
    // email (invitado o anfitrión) offset_min minutos antes (<0) o después
    // (>0) del inicio. Las corridas se programan por reserva y las despacha
    // el cron de recordatorios.
    id: '027_cal_workflows',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS calendar_workflow_steps (
          id TEXT PRIMARY KEY,
          event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          recipient TEXT NOT NULL CHECK (recipient IN ('guest', 'host')),
          offset_min INTEGER NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_workflow_steps_event ON calendar_workflow_steps(event_type_id, position);

        CREATE TABLE IF NOT EXISTS calendar_workflow_runs (
          id TEXT PRIMARY KEY,
          step_id TEXT NOT NULL REFERENCES calendar_workflow_steps(id) ON DELETE CASCADE,
          booking_id TEXT NOT NULL REFERENCES calendar_bookings(id) ON DELETE CASCADE,
          send_at TEXT NOT NULL,
          sent_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (step_id, booking_id)
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_workflow_runs_due ON calendar_workflow_runs(sent_at, send_at);
        CREATE INDEX IF NOT EXISTS idx_calendar_workflow_runs_booking ON calendar_workflow_runs(booking_id);
      `);
    },
  },
  {
    // Cal: cobro con Stripe Checkout. Clave secreta del workspace cifrada
    // (lib/secret-box.ts), precio por tipo de evento y reservas 'pending'
    // (hold sin pagar que vence). Agregar 'pending' al CHECK de status exige
    // reconstruir calendar_bookings: se copia el CREATE actual de
    // sqlite_master (conserva las columnas agregadas con ALTER) y sus índices.
    id: '027_cal_payments',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS calendar_payment_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          stripe_secret_key TEXT NOT NULL DEFAULT '',
          stripe_webhook_secret TEXT NOT NULL DEFAULT '',
          webhook_token TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      await addColumn(client, 'ALTER TABLE calendar_event_types ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, "ALTER TABLE calendar_event_types ADD COLUMN currency TEXT NOT NULL DEFAULT 'usd'");
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'none'");
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN hold_expires_at TEXT');
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN stripe_session_id TEXT');
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN currency TEXT NOT NULL DEFAULT ''");

      const tableSql = async () =>
        String(
          (await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_bookings'"))
            .rows[0]?.sql ?? '',
        );
      const sql = await tableSql();
      if (sql && !/'pending'/.test(sql)) {
        const createNew = sql
          .replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?["`]?calendar_bookings["`]?/i, 'CREATE TABLE calendar_bookings_new')
          .replace(
            /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i,
            (_m, list: string) => `CHECK (status IN (${list}, 'pending'))`,
          );
        const indexes = (
          await client.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'calendar_bookings' AND sql IS NOT NULL",
          )
        ).rows.map((r) =>
          String(r.sql).replace(
            /^CREATE (UNIQUE )?INDEX\s+(IF NOT EXISTS\s+)?/i,
            (_m, u?: string) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `,
          ),
        );
        try {
          await client.migrate([
            'DROP TABLE IF EXISTS calendar_bookings_new',
            createNew,
            'INSERT INTO calendar_bookings_new SELECT * FROM calendar_bookings',
            'DROP TABLE calendar_bookings',
            'ALTER TABLE calendar_bookings_new RENAME TO calendar_bookings',
            ...indexes,
          ]);
        } catch (err) {
          // Otra instancia ya reconstruyó la tabla (carrera al arrancar).
          if (!/'pending'/.test(await tableSql())) throw err;
        }
      }
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_calendar_bookings_pending ON calendar_bookings(status, hold_expires_at)',
      );
    },
  },
  // ---------- Track d9 (027_track_*) ----------
  {
    // Track: labels del workspace (workspace_id = team activo o, en el
    // workspace personal, el id del dueño). Los labels libres que ya tenían
    // los issues (JSON en track_issues.labels) se copian como labels del
    // workspace, deduplicados por nombre; el JSON del issue se conserva y solo
    // se reescriben los ids para apuntar al label del workspace.
    id: '027_track_labels',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS track_labels (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#666666',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_track_labels_name ON track_labels(workspace_id, name COLLATE NOCASE);
      `);
      const rows = (
        await client.execute(
          `SELECT i.id, i.labels, COALESCE(p.team_id, p.owner_id) AS ws
           FROM track_issues i JOIN track_projects p ON p.id = i.project_id
           WHERE i.labels IS NOT NULL AND i.labels != '[]' AND COALESCE(p.team_id, p.owner_id) IS NOT NULL`,
        )
      ).rows;
      const byName = new Map<string, { id: string; name: string; color: string }>();
      const existing = (await client.execute('SELECT id, workspace_id, name, color FROM track_labels')).rows;
      for (const r of existing) {
        byName.set(`${r.workspace_id}\u0000${String(r.name).toLowerCase()}`, {
          id: String(r.id),
          name: String(r.name),
          color: String(r.color),
        });
      }
      const usedIds = new Set(existing.map((r) => String(r.id)));
      for (const r of rows) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(r.labels));
        } catch {
          continue;
        }
        if (!Array.isArray(parsed)) continue;
        const ws = String(r.ws);
        const next: Array<{ id: string; name: string; color: string }> = [];
        for (const l of parsed as Array<Record<string, unknown>>) {
          const name = String(l?.name ?? '').trim().slice(0, 50);
          if (!name) continue;
          const key = `${ws}\u0000${name.toLowerCase()}`;
          let label = byName.get(key);
          if (!label) {
            const raw = typeof l.id === 'string' && l.id && !usedIds.has(l.id) ? l.id : crypto.randomUUID();
            label = { id: raw, name, color: typeof l.color === 'string' && l.color ? l.color.slice(0, 20) : '#666666' };
            await client.execute({
              sql: 'INSERT OR IGNORE INTO track_labels (id, workspace_id, name, color) VALUES (?, ?, ?, ?)',
              args: [label.id, ws, label.name, label.color],
            });
            usedIds.add(label.id);
            byName.set(key, label);
          }
          if (!next.some((x) => x.id === label!.id)) next.push(label);
        }
        await client.execute({
          sql: 'UPDATE track_issues SET labels = ? WHERE id = ?',
          args: [JSON.stringify(next), String(r.id)],
        });
      }
    },
  },
  {
    // Track: integración con GitHub por webhook (sin GitHub App). Un webhook
    // por workspace: secreto cifrado (lib/secret-box), repos aceptados y qué
    // hacer al abrir / mergear un PR. track_issue_links guarda PRs y commits
    // vinculados a issues.
    id: '027_track_github',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS track_github (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL UNIQUE,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          secret TEXT NOT NULL,
          repos TEXT NOT NULL DEFAULT '[]',
          on_pr_open TEXT NOT NULL DEFAULT 'in_progress',
          on_pr_merge TEXT NOT NULL DEFAULT 'done',
          last_delivery_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS track_issue_links (
          id TEXT PRIMARY KEY,
          issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('pr', 'commit')),
          repo TEXT NOT NULL,
          ref TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL DEFAULT 'open',
          branch TEXT,
          author TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (issue_id, kind, repo, ref)
        );
        CREATE INDEX IF NOT EXISTS idx_track_issue_links_issue ON track_issue_links(issue_id, created_at DESC);
      `);
    },
  },
  {
    // Track: triage. Issues creados desde afuera (API, Chat, Flow, GitHub)
    // entran a una cola por proyecto si el proyecto tiene triage activo.
    id: '027_track_triage',
    async up(client) {
      await addColumn(client, 'ALTER TABLE track_projects ADD COLUMN triage_enabled INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, "ALTER TABLE track_issues ADD COLUMN source TEXT NOT NULL DEFAULT 'app'");
      await addColumn(client, 'ALTER TABLE track_issues ADD COLUMN triage INTEGER NOT NULL DEFAULT 0');
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_track_issues_triage ON track_issues(project_id, triage, created_at DESC)',
      );
    },
  },
  {
    // Track: el color de los labels se pinta en style={{ background }}; antes
    // se aceptaba cualquier string (p. ej. url(...)). Los que no son hex
    // vuelven al gris por defecto, en track_labels y en la copia de cada issue.
    id: '028_track_label_colors',
    async up(client) {
      const isHex = (c: unknown) => typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
      const labels = (await client.execute('SELECT id, color FROM track_labels')).rows;
      for (const r of labels) {
        if (isHex(r.color)) continue;
        await client.execute({ sql: "UPDATE track_labels SET color = '#666666' WHERE id = ?", args: [String(r.id)] });
      }
      const issues = (
        await client.execute("SELECT id, labels FROM track_issues WHERE labels IS NOT NULL AND labels != '[]'")
      ).rows;
      for (const r of issues) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(r.labels));
        } catch {
          continue;
        }
        if (!Array.isArray(parsed)) continue;
        const list = parsed as Array<Record<string, unknown>>;
        if (list.every((l) => isHex(l?.color))) continue;
        const next = list.map((l) => (isHex(l?.color) ? l : { ...l, color: '#666666' }));
        await client.execute({
          sql: 'UPDATE track_issues SET labels = ? WHERE id = ?',
          args: [JSON.stringify(next), String(r.id)],
        });
      }
    },
  },
  {
    // Link: segmentación por país/dispositivo, A/B y deep links (JSON en la
    // misma fila del link: el redirect sigue siendo una sola query), origen de
    // cada visita (link | qr) y variante servida, escaneos QR separados y
    // estilo de QR por link (tabla aparte: el logo no viaja en el hot path).
    // Índice (link_id, ts, source) para el dashboard del workspace.
    id: '027_link_targeting_qr',
    async up(client) {
      await addColumn(client, 'ALTER TABLE links ADD COLUMN targeting TEXT');
      await addColumn(client, 'ALTER TABLE links ADD COLUMN qr_scans INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, "ALTER TABLE clicks ADD COLUMN source TEXT NOT NULL DEFAULT 'link'");
      await addColumn(client, 'ALTER TABLE clicks ADD COLUMN variant TEXT');
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_clicks_link_ts_source ON clicks(link_id, ts, source);
        CREATE TABLE IF NOT EXISTS link_qr_styles (
          link_id TEXT PRIMARY KEY REFERENCES links(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          fg TEXT NOT NULL DEFAULT '#000000',
          bg TEXT NOT NULL DEFAULT '#ffffff',
          dots TEXT NOT NULL DEFAULT 'square',
          logo TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    // Cal: el índice único (host, inicio) cubre también los holds 'pending',
    // así dos reservas pagas simultáneas al mismo horario no llegan las dos a
    // Checkout. Antes se liberan los holds vencidos y los que ya chocan con
    // una reserva confirmada u otro hold (queda el más viejo). El DROP y el
    // CREATE van en una transacción: si hay duplicados históricos entre
    // confirmadas, queda el índice anterior.
    id: '028_cal_pending_slot',
    async up(client) {
      const ts = new Date().toISOString();
      await client.execute({
        sql: `UPDATE calendar_bookings SET status = 'cancelled', payment_status = 'expired', cancel_reason = 'payment_expired'
              WHERE status = 'pending' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?`,
        args: [ts],
      });
      await client.execute(
        `UPDATE calendar_bookings SET status = 'cancelled', cancel_reason = 'slot_taken'
         WHERE status = 'pending' AND host_user_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM calendar_bookings o
           WHERE o.host_user_id = calendar_bookings.host_user_id AND o.starts_at = calendar_bookings.starts_at
             AND o.id != calendar_bookings.id
             AND (o.status = 'confirmed' OR (o.status = 'pending' AND o.rowid < calendar_bookings.rowid)))`,
      );
      try {
        await client.batch(
          [
            'DROP INDEX IF EXISTS idx_calendar_bookings_host_slot',
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_bookings_host_slot
             ON calendar_bookings(host_user_id, starts_at) WHERE status IN ('confirmed', 'pending')`,
          ],
          'write',
        );
      } catch {
        // Duplicados históricos entre confirmadas: queda el índice anterior.
      }
    },
  },
  {
    // Link: TXT de propiedad por dominio propio (anti-squatting y anti-takeover
    // de CNAME colgante). Los ya verificados no lo necesitan.
    id: '028_link_domain_verify_token',
    async up(client) {
      await addColumn(client, 'ALTER TABLE link_domains ADD COLUMN verify_token TEXT');
    },
  },
  {
    // Track: igual que 028_track_label_colors para proyectos y statuses (su
    // color también se pinta en style={{ background }}): lo que no es hex
    // vuelve al color por defecto.
    id: '029_track_project_status_colors',
    async up(client) {
      const isHex = (c: unknown) => typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
      for (const [table, fallback] of [
        ['track_projects', '#000000'],
        ['track_statuses', '#666666'],
      ] as const) {
        const rows = (await client.execute(`SELECT id, color FROM ${table}`)).rows;
        for (const r of rows) {
          if (r.color === null || isHex(r.color)) continue;
          await client.execute({ sql: `UPDATE ${table} SET color = ? WHERE id = ?`, args: [fallback, String(r.id)] });
        }
      }
    },
  },
  {
    // Track: child_count (subconsulta por fila), el borrado de subtasks y la
    // lista de hijos filtran por parent_id; sin índice era un scan completo.
    id: '029_track_issues_parent_index',
    async up(client) {
      await client.execute('CREATE INDEX IF NOT EXISTS idx_track_issues_parent ON track_issues(parent_id)');
    },
  },
  {
    // Track: el progreso de los cycles (listCyclesWithProgress) cuenta issues
    // por cycle_id y status; sin índice cada subconsulta recorría toda la
    // tabla (de todos los workspaces). También lo usa el ON DELETE SET NULL.
    id: '030_track_issues_cycle_index',
    async up(client) {
      await client.execute('CREATE INDEX IF NOT EXISTS idx_track_issues_cycle ON track_issues(cycle_id, status_id)');
    },
  },
  {
    // Cal: los pasos de workflow que fallan siempre (email que el proveedor
    // rechaza) dejan de reintentarse después de unos intentos; sin contador
    // ocupaban el lote del cron y frenaban los envíos de toda la instancia.
    id: '031_cal_workflow_run_attempts',
    async up(client) {
      await addColumn(client, 'ALTER TABLE calendar_workflow_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE calendar_workflow_runs ADD COLUMN failed_at TEXT');
    },
  },
  {
    // Docs: restaurar una página de la papelera revive solo las subpáginas que
    // se archivaron con ella, no las que ya se habían mandado a la papelera por
    // su cuenta. Lo ya archivado debajo de un padre archivado se asume cascada
    // (era el comportamiento previo al restaurar).
    id: '032_docs_archived_by_parent',
    async up(client) {
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN archived_by_parent INTEGER NOT NULL DEFAULT 0');
      await client.execute(
        `UPDATE docs_pages SET archived_by_parent = 1
         WHERE archived = 1 AND parent_id IN (SELECT id FROM docs_pages WHERE archived = 1)`,
      );
    },
  },
  {
    // Docs: "¿Te sirvió?" cuenta un voto por visitante (id anónimo del
    // navegador); recargar la página ya no suma otro voto.
    id: '033_docs_feedback_voter',
    async up(client) {
      await addColumn(client, 'ALTER TABLE docs_feedback ADD COLUMN voter TEXT');
      await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_feedback_voter ON docs_feedback(page_id, voter) WHERE voter IS NOT NULL',
      );
    },
  },
  {
    // Board público de feedback (feedback.zerosoft.ai):
    // - roadmap_items: estados públicos idea / considering (además de los
    //   existentes; proposed queda como triage privado). Se reconstruye la
    //   tabla para cambiar el CHECK preservando filas e índices. Columnas para
    //   autor, motivo de cierre, contador de comentarios y fecha del último
    //   cambio de estado.
    // - roadmap_votes: un voto por usuario (UNIQUE item + user). Los votos por
    //   IP anteriores quedan como legado y se siguen contando.
    // - comentarios, eventos de estado (timeline), suscripciones y entradas
    //   del changelog publicadas desde el admin (sin deploy).
    // - votes se recalcula con COUNT (antes había incrementos sueltos).
    id: '034_feedback_board',
    async up(client) {
      const statuses = "'proposed', 'idea', 'considering', 'planned', 'in_progress', 'done', 'declined'";
      const current = await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'roadmap_items'");
      const sql = String(current.rows[0]?.sql ?? '');
      const check = /CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)/i;
      if (sql && check.test(sql) && !/'considering'/.test(sql)) {
        const newSql = sql
          .replace(check, `CHECK (status IN (${statuses}))`)
          .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?roadmap_items["`]?/i, 'CREATE TABLE roadmap_items_new');
        const cols = (await client.execute('PRAGMA table_info(roadmap_items)')).rows
          .map((r) => `"${String(r.name)}"`)
          .join(', ');
        const indexes = (
          await client.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'roadmap_items' AND sql IS NOT NULL",
          )
        ).rows.map((r) => String(r.sql));
        await client.migrate([
          'DROP TABLE IF EXISTS roadmap_items_new',
          newSql,
          `INSERT INTO roadmap_items_new (${cols}) SELECT ${cols} FROM roadmap_items`,
          'DROP TABLE roadmap_items',
          'ALTER TABLE roadmap_items_new RENAME TO roadmap_items',
          ...indexes,
        ]);
      }
      await addColumn(client, 'ALTER TABLE roadmap_items ADD COLUMN author_id TEXT REFERENCES users(id) ON DELETE SET NULL');
      await addColumn(client, 'ALTER TABLE roadmap_items ADD COLUMN declined_reason TEXT');
      await addColumn(client, 'ALTER TABLE roadmap_items ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE roadmap_items ADD COLUMN status_changed_at TEXT');
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_roadmap_items_public ON roadmap_items(is_public, status, votes DESC)',
      );

      const votes = await client.execute('PRAGMA table_info(roadmap_votes)');
      const hasUser = votes.rows.some((r) => String(r.name) === 'user_id');
      if (!hasUser) {
        await client.migrate([
          'DROP TABLE IF EXISTS roadmap_votes_new',
          `CREATE TABLE roadmap_votes_new (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
            user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
            ip_hash TEXT,
            created_at TEXT NOT NULL,
            CHECK (user_id IS NOT NULL OR ip_hash IS NOT NULL),
            UNIQUE (item_id, user_id),
            UNIQUE (item_id, ip_hash)
          )`,
          `INSERT INTO roadmap_votes_new (id, item_id, user_id, ip_hash, created_at)
           SELECT lower(hex(randomblob(16))), item_id, NULL, ip_hash, created_at FROM roadmap_votes`,
          'DROP TABLE roadmap_votes',
          'ALTER TABLE roadmap_votes_new RENAME TO roadmap_votes',
        ]);
      }
      await client.execute('CREATE INDEX IF NOT EXISTS idx_roadmap_votes_user ON roadmap_votes(user_id, item_id)');

      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS roadmap_comments (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          body TEXT NOT NULL,
          is_official INTEGER NOT NULL DEFAULT 0,
          pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_roadmap_comments_item ON roadmap_comments(item_id, pinned DESC, created_at);
        CREATE TABLE IF NOT EXISTS roadmap_status_events (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
          from_status TEXT,
          to_status TEXT NOT NULL,
          note TEXT,
          actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          changelog_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_roadmap_status_events_item ON roadmap_status_events(item_id, created_at);
        CREATE TABLE IF NOT EXISTS roadmap_subscriptions (
          item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason TEXT NOT NULL DEFAULT 'manual' CHECK (reason IN ('author', 'vote', 'comment', 'manual')),
          active INTEGER NOT NULL DEFAULT 1,
          locale TEXT NOT NULL DEFAULT 'en',
          created_at TEXT NOT NULL,
          PRIMARY KEY (item_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS changelog_entries (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          title_en TEXT NOT NULL,
          title_es TEXT NOT NULL DEFAULT '',
          title_pt TEXT NOT NULL DEFAULT '',
          body_en TEXT NOT NULL DEFAULT '',
          body_es TEXT NOT NULL DEFAULT '',
          body_pt TEXT NOT NULL DEFAULT '',
          products TEXT NOT NULL DEFAULT '[]',
          published INTEGER NOT NULL DEFAULT 1,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_changelog_entries_date ON changelog_entries(published, date DESC, created_at DESC);
      `);

      await client.execute(
        `UPDATE roadmap_items SET votes =
           (SELECT COUNT(*) FROM roadmap_signals s WHERE s.item_id = roadmap_items.id) +
           (SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = roadmap_items.id)`,
      );
    },
  },
  {
    // Cal: la marca (color, logo, nombre) es del workspace y se ve en todas
    // las páginas públicas (/book, /r, gestión). El color y el logo del tipo
    // de evento quedan como excepción opcional.
    id: '035_cal_workspace_brand',
    async up(client) {
      await addColumn(client, 'ALTER TABLE calendar_users ADD COLUMN brand_color TEXT');
      await addColumn(client, 'ALTER TABLE calendar_users ADD COLUMN logo_url TEXT');
      await addColumn(client, 'ALTER TABLE calendar_users ADD COLUMN display_name TEXT');
    },
  },
  {
    // Las ideas del roadmap inicial de Agents, Flow, Notes, Board y Robots se
    // cargaron como 'other' (todavía no existían en la taxonomía). Ahora llevan
    // su producto, así el board muestra su línea. Solo toca las que siguen en
    // 'other' (si alguien las recategorizó desde el admin, se respeta).
    id: '036_roadmap_seed_products',
    async up(client) {
      for (const product of ['agents', 'flow', 'notes', 'board', 'robots']) {
        await client.execute({
          sql: "UPDATE roadmap_items SET product = ? WHERE id = ? AND product = 'other'",
          args: [product, `rm_seed_${product}`],
        });
      }
    },
  },
  {
    // Ideas que vienen de la investigación de gaps (research/ideas.json y
    // POST /api/roadmap/ingest): registro de cada título ya importado, así
    // una idea borrada o rechazada desde el admin no vuelve a aparecer.
    id: '037_roadmap_imports',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS roadmap_imports (
          title_key TEXT PRIMARY KEY,
          item_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
    },
  },
  {
    // Identidad del visitante del chat: el email que manda el widget es
    // declarado (no verificado) salvo que venga firmado con el secreto del
    // widget (HMAC) o lo cargue alguien del equipo. El secreto vive en su
    // propia tabla para que ningún SELECT * de chat_widgets lo exponga.
    id: '038_chat_visitor_identity',
    async up(client) {
      await addColumn(client, 'ALTER TABLE chat_visitors ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
      await client.execute(`
        CREATE TABLE IF NOT EXISTS chat_widget_secrets (
          widget_id TEXT PRIMARY KEY REFERENCES chat_widgets(id) ON DELETE CASCADE,
          secret TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
    },
  },
  {
    // Link: pasar los query params del link corto al destino (prendido por
    // defecto, como Dub) y a dónde mandar un link vencido o inexistente en
    // vez de la página de error de zerosoft (por link y por dominio propio).
    id: '039_link_params_fallbacks',
    async up(client) {
      await addColumn(client, 'ALTER TABLE links ADD COLUMN forward_params INTEGER NOT NULL DEFAULT 1');
      await addColumn(client, 'ALTER TABLE links ADD COLUMN expired_url TEXT');
      await addColumn(client, 'ALTER TABLE link_domains ADD COLUMN not_found_url TEXT');
      await addColumn(client, 'ALTER TABLE link_domains ADD COLUMN expired_url TEXT');
    },
  },
  {
    // Cal: cada reserva guarda sus buffers (los del event type o, si no
    // tiene, los del workspace) para que la próxima reserva respete también
    // los de la existente, no solo los propios. Backfill de las vivas.
    id: '040_cal_booking_buffers',
    async up(client) {
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN buffer_before_min INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN buffer_after_min INTEGER NOT NULL DEFAULT 0');
      for (const [rule, column] of [
        ['bufferBeforeMin', 'buffer_before_min'],
        ['bufferAfterMin', 'buffer_after_min'],
      ] as const) {
        await client.execute({
          sql: `UPDATE calendar_bookings SET ${column} = COALESCE(
                  (SELECT CASE WHEN json_valid(e.booking_rules) THEN CAST(json_extract(e.booking_rules, '$.${rule}') AS INTEGER) END
                     FROM calendar_event_types e WHERE e.id = calendar_bookings.event_type_id),
                  (SELECT cu.${column} FROM calendar_event_types e JOIN calendar_users cu ON cu.user_id = e.user_id
                     WHERE e.id = calendar_bookings.event_type_id),
                  0)
                WHERE status IN ('confirmed', 'pending') AND ends_at > ?`,
          args: [new Date().toISOString()],
        });
      }
    },
  },
  {
    // Umbral de deal rotting por etapa (estilo Pipedrive). NULL = default 14.
    id: '041_crm_stage_rotting_days',
    async up(client) {
      await addColumn(client, 'ALTER TABLE crm_stages ADD COLUMN rotting_days INTEGER');
    },
  },
  {
    // Track: el autor puede editar sus comentarios (marca "editado").
    id: '042_track_comment_edits',
    async up(client) {
      await addColumn(client, 'ALTER TABLE track_issue_comments ADD COLUMN updated_at TEXT');
    },
  },
  {
    // Idioma del widget de Chat ('auto' = el de la página / navegador) y
    // respuestas de personas del equipo en conversaciones de Agents derivadas
    // (agent_messages.author_id = quien respondió; NULL = el agente).
    id: '043_chat_widget_locale_agent_replies',
    async up(client) {
      await addColumn(client, "ALTER TABLE chat_widgets ADD COLUMN locale TEXT NOT NULL DEFAULT 'auto'");
      await addColumn(client, 'ALTER TABLE agent_messages ADD COLUMN author_id TEXT');
    },
  },
  {
    // Agents: casos de prueba guardados (pregunta + comportamiento esperado,
    // juzgados por un LLM en modo simulación), headers secretos de
    // http_request (cifrados con lib/secret-box) y el origen de una
    // conversación ('flow' cuando la abrió un nodo de Flow; channel sigue 'api').
    id: '048_agents_tests_secrets_source',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS agent_test_cases (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          question TEXT NOT NULL,
          expected TEXT NOT NULL,
          last_status TEXT CHECK (last_status IN ('pass', 'fail', 'error')),
          last_reason TEXT NOT NULL DEFAULT '',
          last_reply TEXT NOT NULL DEFAULT '',
          last_tools TEXT NOT NULL DEFAULT '[]',
          last_run_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`);
      await client.execute('CREATE INDEX IF NOT EXISTS idx_agent_test_cases_agent ON agent_test_cases(agent_id, created_at)');
      await addColumn(client, "ALTER TABLE agents ADD COLUMN http_secrets TEXT NOT NULL DEFAULT '[]'");
      await addColumn(client, 'ALTER TABLE agent_conversations ADD COLUMN source TEXT');
    },
  },
  {
    // Chat: estado "ausente" de cada agente (el round-robin lo saltea),
    // edición y borrado de mensajes y notas del agente (edited_at, deleted_at)
    // y aviso por email de respuestas no leídas: minutos de espera por widget
    // (0 = apagado) y offline_email_at como claim por mensaje. Las respuestas
    // sin leer que ya existían quedan marcadas, así el deploy no manda emails
    // de conversaciones viejas.
    id: '047_chat_away_edits_offline_email',
    async up(client) {
      await addColumn(client, 'ALTER TABLE chat_widgets ADD COLUMN offline_email_minutes INTEGER NOT NULL DEFAULT 10');
      await addColumn(client, 'ALTER TABLE chat_messages ADD COLUMN edited_at TEXT');
      await addColumn(client, 'ALTER TABLE chat_messages ADD COLUMN deleted_at TEXT');
      await addColumn(client, 'ALTER TABLE chat_messages ADD COLUMN offline_email_at TEXT');
      await client.execute(
        "UPDATE chat_messages SET offline_email_at = created_at WHERE sender_type = 'user' AND read_at IS NULL AND offline_email_at IS NULL",
      );
      await client.execute(`
        CREATE TABLE IF NOT EXISTS chat_agent_status (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          away INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
    },
  },
  {
    // Docs: las subpáginas heredan los shares de sus ancestros salvo que se
    // corte la herencia (1 = hereda, el default; 0 = solo sus propios shares).
    id: '045_docs_share_inheritance',
    async up(client) {
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN inherit_shares INTEGER NOT NULL DEFAULT 1');
    },
  },
  {
    // Cal: UTM de la página de reserva guardado en cada reserva (JSON) y
    // aprobación del anfitrión: 'pending' = la reserva ('pending', sin hold
    // de pago) espera que la confirme; 'approved' / 'declined' = respondió.
    // 'none' = el evento no pide confirmación.
    id: '050_cal_booking_utm_approval',
    async up(client) {
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN utm TEXT NOT NULL DEFAULT '{}'");
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN approval TEXT NOT NULL DEFAULT 'none'");
    },
  },
  {
    // Track: suscripción a issues. Quien crea, quien queda asignado y quien
    // comenta se suscribe solo (INSERT OR IGNORE); subscribed = 0 guarda que
    // la persona se dio de baja, para no volver a suscribirla sola.
    id: '046_track_issue_subscriptions',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS track_issue_subscriptions (
          issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subscribed INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (issue_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_track_issue_subscriptions_user ON track_issue_subscriptions(user_id);
      `);
    },
  },
  {
    // CRM: papelera (los borrados de contactos, empresas, deals y actividades
    // quedan 90 días como snapshot restaurable, ver lib/crm-trash.ts), fechas
    // de actividad mantenidas por triggers en cada registro
    // (lib/crm-activity-dates.ts) y tareas que se repiten.
    id: '049_crm_trash_activity_dates_task_repeat',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_trash (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity TEXT NOT NULL CHECK (entity IN ('contact', 'company', 'deal', 'activity')),
          record_id TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          owner_id TEXT,
          deleted_by TEXT NOT NULL DEFAULT '',
          deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
          snapshot TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_crm_trash_user ON crm_trash(user_id, deleted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_trash_deleted ON crm_trash(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id) WHERE contact_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_crm_activities_company ON crm_activities(company_id) WHERE company_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities(deal_id) WHERE deal_id IS NOT NULL;
      `);
      for (const { table } of ACTIVITY_DATE_TABLES) {
        await addColumn(client, `ALTER TABLE ${table} ADD COLUMN last_activity_at TEXT`);
        await addColumn(client, `ALTER TABLE ${table} ADD COLUMN last_contacted_at TEXT`);
        await addColumn(client, `ALTER TABLE ${table} ADD COLUMN next_activity_at TEXT`);
      }
      await addColumn(client, "ALTER TABLE crm_activities ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none'");
      await addColumn(client, 'ALTER TABLE crm_activities ADD COLUMN repeat_next_id TEXT');
      // Versión 1: esta base todavía no tiene task_kind (077 recrea los triggers).
      await client.executeMultiple(activityDateTriggersSql(1));
      for (const { table } of ACTIVITY_DATE_TABLES) await client.execute(activityDatesUpdateSql(table, undefined, 1));
    },
  },  {
    // Chat: atributos de conversación definidos por widget (JSON
    // ChatAttributeDef[], ver lib/chat-attributes.ts) y sus valores por
    // conversación (JSON objeto id → valor). Agents: cada corrida queda en
    // agent_runs (estado y pasos, para la pestaña Analítica y las alertas),
    // alerts_enabled por agente y agent_alert_state como throttle del email
    // de alertas (un claim por agente con la fecha del último envío).
    id: '056_chat_attributes_agent_runs_alerts',
    async up(client) {
      await addColumn(client, "ALTER TABLE chat_widgets ADD COLUMN conversation_attributes TEXT NOT NULL DEFAULT '[]'");
      await addColumn(client, "ALTER TABLE chat_conversations ADD COLUMN attributes TEXT NOT NULL DEFAULT '{}'");
      await addColumn(client, 'ALTER TABLE agents ADD COLUMN alerts_enabled INTEGER NOT NULL DEFAULT 1');
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
          channel TEXT NOT NULL,
          status TEXT NOT NULL,
          steps INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_agent ON agent_tool_calls(agent_id, created_at);
        CREATE TABLE IF NOT EXISTS agent_alert_state (
          agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
          last_sent_at TEXT,
          last_kinds TEXT NOT NULL DEFAULT '[]',
          locale TEXT NOT NULL DEFAULT 'en'
        );
      `);
    },
  },
  {
    // Robots: avisos por email y pausa automática del schedule tras N fallas
    // seguidas, advertencias (pasos con continueOnError), captura de la falla
    // (URL, DOM y screenshot del paso que falló) y retención de corridas.
    id: '053_robots_alerts_failures_retention',
    async up(client) {
      await addColumn(client, 'ALTER TABLE robots ADD COLUMN failure_alerts INTEGER NOT NULL DEFAULT 1');
      await addColumn(client, 'ALTER TABLE robots ADD COLUMN pause_after INTEGER NOT NULL DEFAULT 3');
      await addColumn(client, 'ALTER TABLE robots ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE robots ADD COLUMN last_alert_at TEXT');
      await addColumn(client, 'ALTER TABLE robots ADD COLUMN paused_at TEXT');
      await addColumn(client, "ALTER TABLE robots ADD COLUMN alert_locale TEXT NOT NULL DEFAULT 'en'");
      await addColumn(client, 'ALTER TABLE robots ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE robot_runs ADD COLUMN warnings INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE robot_runs ADD COLUMN failure TEXT');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_robot_runs_created ON robot_runs(created_at)');
    },
  },
  {
    // Flow: ajustes por workspace (retención del historial de corridas e
    // idioma de los avisos), aviso por email al dueño cuando una corrida
    // falla (como mucho uno por flow y hora: failure_email_at) y replay
    // automático de corridas fallidas (replay_at = cuándo se reintenta).
    id: '051_flow_alerts_retention',
    async up(client) {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS flow_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          retention_days INTEGER NOT NULL DEFAULT 30,
          locale TEXT NOT NULL DEFAULT 'en',
          updated_at TEXT NOT NULL
        )`);
      await addColumn(client, 'ALTER TABLE flow_flows ADD COLUMN failure_alerts INTEGER NOT NULL DEFAULT 1');
      await addColumn(client, 'ALTER TABLE flow_flows ADD COLUMN auto_replay INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE flow_flows ADD COLUMN failure_email_at TEXT');
      await addColumn(client, 'ALTER TABLE flow_runs ADD COLUMN replay_at TEXT');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_runs_replay ON flow_runs(replay_at) WHERE replay_at IS NOT NULL');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_flow_runs_user_created ON flow_runs(user_id, created_at)');
    },
  },
  {
    // Link: utm_term/utm_content y plantillas de UTM del workspace; quién creó
    // cada link (created_by, null en los viejos) y un id externo único por
    // workspace para la API v1; comentarios internos por link; ciudad, región
    // y URL completa del referrer en cada click; filtro de links (ids, tags,
    // dominios) en los webhooks de eventos link.* (JSON, null = todos).
    id: '052_link_utm_creator_comments_geo',
    async up(client) {
      await addColumn(client, 'ALTER TABLE links ADD COLUMN utm_term TEXT');
      await addColumn(client, 'ALTER TABLE links ADD COLUMN utm_content TEXT');
      await addColumn(client, 'ALTER TABLE links ADD COLUMN created_by TEXT');
      await addColumn(client, 'ALTER TABLE links ADD COLUMN external_id TEXT');
      await addColumn(client, 'ALTER TABLE clicks ADD COLUMN city TEXT');
      await addColumn(client, 'ALTER TABLE clicks ADD COLUMN region TEXT');
      await addColumn(client, 'ALTER TABLE clicks ADD COLUMN referrer_url TEXT');
      await addColumn(client, 'ALTER TABLE webhooks ADD COLUMN filters TEXT');
      await client.executeMultiple(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_links_user_external ON links(user_id, external_id) WHERE external_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_links_user_creator ON links(user_id, created_by);
        CREATE TABLE IF NOT EXISTS link_utm_templates (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          utm_source TEXT,
          utm_medium TEXT,
          utm_campaign TEXT,
          utm_term TEXT,
          utm_content TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, name)
        );
        CREATE TABLE IF NOT EXISTS link_comments (
          id TEXT PRIMARY KEY,
          link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
          author_id TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_link_comments_link ON link_comments(link_id, created_at);
      `);
    },
  },
  {
    // Notes: historial de versiones (snapshots al guardar, con tope por nota,
    // ver lib/notes-versions.ts) y recordatorios con fecha y hora (uno por
    // nota; sent_at es el claim del cron, ver lib/notes-reminders.ts).
    id: '054_notes_versions_reminders',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS note_versions (
          id TEXT PRIMARY KEY,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '[]',
          kind TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto', 'manual', 'restore')),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS note_reminders (
          note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          remind_at TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          locale TEXT NOT NULL DEFAULT 'en',
          sent_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_note_reminders_due ON note_reminders(sent_at, remind_at);
      `);
    },
  },
  {
    // Board: imágenes en el storage de uploads (fuera del JSON de la escena),
    // historial por hora con restauración como copia, hilos de comentarios
    // anclados al lienzo y biblioteca de formas del workspace.
    id: '055_board_files_history_comments_library',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS board_files (
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          url TEXT NOT NULL,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY (board_id, file_id)
        );
        CREATE INDEX IF NOT EXISTS idx_board_files_url ON board_files(url);
        CREATE TABLE IF NOT EXISTS board_snapshots (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          scene TEXT NOT NULL,
          scene_bytes INTEGER NOT NULL DEFAULT 0,
          element_count INTEGER NOT NULL DEFAULT 0,
          thumbnail TEXT,
          version INTEGER NOT NULL,
          edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          content_at TEXT NOT NULL,
          taken_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_board_snapshots_board ON board_snapshots(board_id, taken_at DESC);
        CREATE TABLE IF NOT EXISTS board_comment_threads (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          element_id TEXT,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          resolved_at TEXT,
          resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_board_threads_board ON board_comment_threads(board_id, created_at);
        CREATE TABLE IF NOT EXISTS board_comments (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES board_comment_threads(id) ON DELETE CASCADE,
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_board_comments_thread ON board_comments(thread_id, created_at);
        CREATE TABLE IF NOT EXISTS board_libraries (
          workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          items TEXT NOT NULL DEFAULT '[]',
          bytes INTEGER NOT NULL DEFAULT 0,
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    // Cal: invitados extra por reserva (JSON de emails) y reuniones únicas con
    // horarios elegidos a mano (JSON de inicios ISO; NULL = evento normal).
    // CRM: archivos adjuntos a contactos, empresas y deals (las FKs en cascada
    // hacen que la papelera los guarde en el snapshot) y tipos nuevos de
    // custom field (el CHECK del tipo obliga a reconstruir la tabla).
    id: '057_cal_guests_one_off_crm_files_field_types',
    async up(client) {
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN guests TEXT NOT NULL DEFAULT '[]'");
      await addColumn(client, 'ALTER TABLE calendar_event_types ADD COLUMN one_off_times TEXT');
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_record_files (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          contact_id TEXT REFERENCES crm_contacts(id) ON DELETE CASCADE,
          company_id TEXT REFERENCES crm_companies(id) ON DELETE CASCADE,
          deal_id TEXT REFERENCES crm_deals(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT '',
          size INTEGER NOT NULL DEFAULT 0,
          url TEXT NOT NULL,
          uploaded_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_record_files_contact ON crm_record_files(contact_id) WHERE contact_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_crm_record_files_company ON crm_record_files(company_id) WHERE company_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_crm_record_files_deal ON crm_record_files(deal_id) WHERE deal_id IS NOT NULL;
      `);
      const tableSql = async () =>
        String(
          (await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'crm_custom_fields'"))
            .rows[0]?.sql ?? '',
        );
      const sql = await tableSql();
      if (sql && !/'multiselect'/.test(sql)) {
        const createNew = sql
          .replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?["`]?crm_custom_fields["`]?/i, 'CREATE TABLE crm_custom_fields_new')
          .replace(
            /CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)\s*\)/i,
            (_m, list: string) => `CHECK (type IN (${list}, 'multiselect', 'url', 'phone', 'currency', 'user'))`,
          );
        const indexes = (
          await client.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'crm_custom_fields' AND sql IS NOT NULL",
          )
        ).rows.map((r) =>
          String(r.sql).replace(
            /^CREATE (UNIQUE )?INDEX\s+(IF NOT EXISTS\s+)?/i,
            (_m, u?: string) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `,
          ),
        );
        try {
          await client.migrate([
            'DROP TABLE IF EXISTS crm_custom_fields_new',
            createNew,
            'INSERT INTO crm_custom_fields_new SELECT * FROM crm_custom_fields',
            'DROP TABLE crm_custom_fields',
            'ALTER TABLE crm_custom_fields_new RENAME TO crm_custom_fields',
            ...indexes,
          ]);
        } catch (err) {
          // Otra instancia ya reconstruyó la tabla (carrera al arrancar).
          if (!/'multiselect'/.test(await tableSql())) throw err;
        }
      }
    },
  },  {
    // Track: avisos por email (inmediato, resumen diario o nada, por persona;
    // cursor_at marca hasta dónde ya se mandó y digest_day reclama el resumen
    // del día), cycles automáticos con arrastre de lo sin terminar
    // (completed_at marca el cycle ya cerrado), plantillas de issue por
    // proyecto, issues que se repiten, milestones con fecha objetivo,
    // posponer avisos de la bandeja (notifications.snoozed_until) y
    // recordatorios por issue y persona.
    id: '059_track_notify_cycles_templates_recurring_milestones',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS track_notify_prefs (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          email_mode TEXT NOT NULL DEFAULT 'digest' CHECK (email_mode IN ('immediate', 'digest', 'off')),
          timezone TEXT,
          locale TEXT,
          cursor_at TEXT,
          digest_day TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS track_milestones (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          target_date TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_track_milestones_project ON track_milestones(project_id, target_date);
        CREATE TABLE IF NOT EXISTS track_issue_templates (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          status_id TEXT REFERENCES track_statuses(id) ON DELETE SET NULL,
          priority TEXT CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
          assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          estimate INTEGER CHECK (estimate >= 0),
          labels TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_track_issue_templates_project ON track_issue_templates(project_id, name);
        CREATE TABLE IF NOT EXISTS track_recurring_issues (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
          creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status_id TEXT REFERENCES track_statuses(id) ON DELETE SET NULL,
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
          assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          labels TEXT NOT NULL DEFAULT '[]',
          frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
          every INTEGER NOT NULL DEFAULT 1 CHECK (every >= 1),
          start_on TEXT NOT NULL,
          next_run_on TEXT NOT NULL,
          due_days INTEGER CHECK (due_days >= 0),
          timezone TEXT NOT NULL DEFAULT 'UTC',
          active INTEGER NOT NULL DEFAULT 1,
          last_issue_id TEXT,
          last_run_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_track_recurring_due ON track_recurring_issues(active, next_run_on);
        CREATE INDEX IF NOT EXISTS idx_track_recurring_project ON track_recurring_issues(project_id, created_at);
        CREATE TABLE IF NOT EXISTS track_issue_reminders (
          issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          remind_at TEXT NOT NULL,
          sent_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (issue_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_track_issue_reminders_due ON track_issue_reminders(sent_at, remind_at);
      `);
      await addColumn(client, 'ALTER TABLE notifications ADD COLUMN snoozed_until TEXT');
      await addColumn(client, 'ALTER TABLE track_projects ADD COLUMN cycle_auto INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE track_projects ADD COLUMN cycle_weeks INTEGER NOT NULL DEFAULT 2');
      await addColumn(client, "ALTER TABLE track_projects ADD COLUMN cycle_name TEXT NOT NULL DEFAULT ''");
      await addColumn(client, 'ALTER TABLE track_projects ADD COLUMN cycle_auto_day TEXT');
      await addColumn(client, 'ALTER TABLE track_cycles ADD COLUMN completed_at TEXT');
      await addColumn(
        client,
        'ALTER TABLE track_issues ADD COLUMN milestone_id TEXT REFERENCES track_milestones(id) ON DELETE SET NULL',
      );
      await client.execute(
        'CREATE INDEX IF NOT EXISTS idx_track_issues_milestone ON track_issues(milestone_id) WHERE milestone_id IS NOT NULL',
      );
      await client.execute(
        "CREATE INDEX IF NOT EXISTS idx_notifications_track ON notifications(source_type, created_at) WHERE source_type = 'track_issue'",
      );
    },
  },
  {
    // Robots: secreto TOTP de las credenciales (cifrado con lib/secret-box,
    // aparte del resto de los datos), corridas en lote de la API v1
    // (batch_id) y cambios de la salida contra la corrida exitosa anterior
    // (changed: 1 cambió, 0 igual, NULL sin comparar).
    id: '061_robots_totp_batches_changes',
    async up(client) {
      await addColumn(client, 'ALTER TABLE flow_credentials ADD COLUMN totp_secret TEXT');
      await addColumn(client, 'ALTER TABLE robot_runs ADD COLUMN batch_id TEXT');
      await addColumn(client, 'ALTER TABLE robot_runs ADD COLUMN changed INTEGER');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_robot_runs_batch ON robot_runs(batch_id) WHERE batch_id IS NOT NULL');
    },
  },
  {
    // Cal: ubicaciones estructuradas, eventos colectivos, lugares por horario
    // y routing forms que terminan en una URL o un mensaje (con registro de
    // envíos). Link: filtros de analytics, páginas públicas de analytics y
    // carpetas con permisos.
    id: '063_cal_locations_collective_seats_link_folders',
    async up(client) {
      // --- Cal ---
      // Ubicaciones que ofrece el evento (JSON [{kind, value}]), modo de los
      // hosts (round_robin | collective) y lugares por horario (0 = sin lugares).
      await addColumn(client, "ALTER TABLE calendar_event_types ADD COLUMN locations TEXT NOT NULL DEFAULT '[]'");
      await addColumn(client, "ALTER TABLE calendar_event_types ADD COLUMN scheduling TEXT NOT NULL DEFAULT 'round_robin'");
      await addColumn(client, 'ALTER TABLE calendar_event_types ADD COLUMN seats INTEGER NOT NULL DEFAULT 0');
      // Links fijos de cada anfitrión (Zoom, Teams, teléfono), JSON.
      await addColumn(client, "ALTER TABLE calendar_users ADD COLUMN conferencing TEXT NOT NULL DEFAULT '{}'");
      // La ubicación elegida ya resuelta, los co-anfitriones de un evento
      // colectivo (JSON de user ids) y si la reserva ocupa un lugar de un horario compartido.
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN location TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN location_kind TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE calendar_bookings ADD COLUMN co_host_ids TEXT NOT NULL DEFAULT '[]'");
      await addColumn(client, 'ALTER TABLE calendar_bookings ADD COLUMN seated INTEGER NOT NULL DEFAULT 0');
      // El índice único (host, inicio) deja afuera los lugares: varias
      // reservas comparten el mismo horario del mismo host.
      const hostSlotSql = String(
        (await client.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_calendar_bookings_host_slot'"))
          .rows[0]?.sql ?? '',
      );
      if (!/seated/.test(hostSlotSql)) {
        try {
          await client.batch(
            [
              'DROP INDEX IF EXISTS idx_calendar_bookings_host_slot',
              `CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_bookings_host_slot
               ON calendar_bookings(host_user_id, starts_at) WHERE status IN ('confirmed', 'pending') AND seated = 0`,
            ],
            'write',
          );
        } catch {
          // Otra instancia ya lo reconstruyó.
        }
      }
      // Routing forms: la regla (y el form, si ninguna matchea) puede terminar
      // en un evento, una URL o un mensaje. event_type_id pasa a ser opcional:
      // se reconstruye la tabla.
      await addColumn(client, "ALTER TABLE calendar_routing_forms ADD COLUMN fallback_action TEXT NOT NULL DEFAULT 'event'");
      await addColumn(client, "ALTER TABLE calendar_routing_forms ADD COLUMN fallback_url TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE calendar_routing_forms ADD COLUMN fallback_message TEXT NOT NULL DEFAULT ''");
      await addColumn(client, 'ALTER TABLE calendar_routing_forms ADD COLUMN pass_answers INTEGER NOT NULL DEFAULT 1');
      const rulesSql = String(
        (await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_routing_rules'"))
          .rows[0]?.sql ?? '',
      );
      if (rulesSql && !/target_url/.test(rulesSql)) {
        try {
          await client.migrate([
            'DROP TABLE IF EXISTS calendar_routing_rules_new',
            `CREATE TABLE calendar_routing_rules_new (
              id TEXT PRIMARY KEY,
              form_id TEXT NOT NULL REFERENCES calendar_routing_forms(id) ON DELETE CASCADE,
              field_id TEXT NOT NULL REFERENCES calendar_routing_fields(id) ON DELETE CASCADE,
              operator TEXT NOT NULL CHECK (operator IN ('is', 'is_not', 'contains', 'truthy')),
              value TEXT NOT NULL DEFAULT '',
              event_type_id TEXT REFERENCES calendar_event_types(id) ON DELETE CASCADE,
              position INTEGER NOT NULL DEFAULT 0,
              action TEXT NOT NULL DEFAULT 'event' CHECK (action IN ('event', 'url', 'message')),
              target_url TEXT NOT NULL DEFAULT '',
              message TEXT NOT NULL DEFAULT ''
            )`,
            `INSERT INTO calendar_routing_rules_new (id, form_id, field_id, operator, value, event_type_id, position)
             SELECT id, form_id, field_id, operator, value, event_type_id, position FROM calendar_routing_rules`,
            'DROP TABLE calendar_routing_rules',
            'ALTER TABLE calendar_routing_rules_new RENAME TO calendar_routing_rules',
            'CREATE INDEX IF NOT EXISTS idx_calendar_routing_rules_form ON calendar_routing_rules(form_id, position)',
          ]);
        } catch (err) {
          const after = String(
            (await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_routing_rules'"))
              .rows[0]?.sql ?? '',
          );
          if (!/target_url/.test(after)) throw err;
        }
      }
      // Registro de cada envío del form: respuestas y a dónde terminó.
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS calendar_routing_submissions (
          id TEXT PRIMARY KEY,
          form_id TEXT NOT NULL REFERENCES calendar_routing_forms(id) ON DELETE CASCADE,
          answers TEXT NOT NULL DEFAULT '{}',
          outcome TEXT NOT NULL DEFAULT 'none',
          target TEXT NOT NULL DEFAULT '',
          rule_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_calendar_routing_submissions_form ON calendar_routing_submissions(form_id, created_at);
      `);
      // --- /Cal ---
      // --- Link ---
      // Carpetas de links: acceso por defecto para los miembros y excepciones
      // por persona ('none' | 'view' | 'edit'). Owner y admins editan todo.
      // Páginas públicas de analytics de un link o un tag (token revocable).
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS link_folders (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          default_access TEXT NOT NULL DEFAULT 'edit' CHECK (default_access IN ('none', 'view', 'edit')),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_link_folders_user ON link_folders(user_id, name);
        CREATE TABLE IF NOT EXISTS link_folder_members (
          folder_id TEXT NOT NULL REFERENCES link_folders(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          access TEXT NOT NULL CHECK (access IN ('none', 'view', 'edit')),
          PRIMARY KEY (folder_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS link_analytics_shares (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          link_id TEXT REFERENCES links(id) ON DELETE CASCADE,
          tag TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_link_analytics_shares_user ON link_analytics_shares(user_id, created_at);
      `);
      await addColumn(client, 'ALTER TABLE links ADD COLUMN folder_id TEXT REFERENCES link_folders(id) ON DELETE SET NULL');
      await client.execute('CREATE INDEX IF NOT EXISTS idx_links_folder ON links(folder_id) WHERE folder_id IS NOT NULL');
      // --- /Link ---
    },
  },
  {
    // Flow: tablas de datos del workspace (búsquedas, dedupe y estado entre
    // corridas; filas como JSON con columnas tipadas, ver lib/flow-tables.ts)
    // y datos de prueba fijados por nodo para probar un paso solo.
    id: '060_flow_tables_pins',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS flow_tables (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          columns TEXT NOT NULL DEFAULT '[]',
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (user_id, name)
        );
        CREATE TABLE IF NOT EXISTS flow_table_rows (
          id TEXT PRIMARY KEY,
          table_id TEXT NOT NULL REFERENCES flow_tables(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          data TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_flow_table_rows_table ON flow_table_rows(table_id, created_at);
      `);
      await addColumn(client, "ALTER TABLE flow_flows ADD COLUMN pinned_data TEXT NOT NULL DEFAULT '{}'");
    },
  },
  {
    // Board: acceso por pizarra (todo el workspace o solo invitados con rol),
    // link de invitado con edición, timer compartido y votaciones del taller,
    // y stickies convertidos en issues de Track (tarjetas en vivo).
    // Notes: compartir una nota o una libreta con compañeros (ver o editar).
    id: '062_board_access_workshop_notes_shares',
    async up(client) {
      await addColumn(client, "ALTER TABLE boards ADD COLUMN access TEXT NOT NULL DEFAULT 'workspace'");
      await addColumn(client, 'ALTER TABLE boards ADD COLUMN edit_token TEXT');
      await addColumn(client, 'ALTER TABLE boards ADD COLUMN timer_ends_at TEXT');
      await addColumn(client, 'ALTER TABLE boards ADD COLUMN timer_seconds INTEGER');
      await addColumn(client, 'ALTER TABLE boards ADD COLUMN timer_paused_left INTEGER');
      await client.executeMultiple(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_edit_token ON boards(edit_token) WHERE edit_token IS NOT NULL;
        CREATE TABLE IF NOT EXISTS board_members (
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'edit',
          added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (board_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_board_members_user ON board_members(user_id);
        CREATE TABLE IF NOT EXISTS board_vote_sessions (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          votes_per_person INTEGER NOT NULL DEFAULT 3,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TEXT NOT NULL,
          closed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_board_vote_sessions_board ON board_vote_sessions(board_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS board_votes (
          session_id TEXT NOT NULL REFERENCES board_vote_sessions(id) ON DELETE CASCADE,
          voter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          element_id TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (session_id, voter_id, element_id)
        );
        CREATE TABLE IF NOT EXISTS board_track_links (
          board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
          element_id TEXT NOT NULL,
          issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (board_id, element_id)
        );
        CREATE TABLE IF NOT EXISTS note_shares (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
          notebook_id TEXT REFERENCES note_notebooks(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'view',
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_note_shares_note ON note_shares(note_id, person_id) WHERE note_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_note_shares_notebook ON note_shares(notebook_id, person_id) WHERE notebook_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_note_shares_person ON note_shares(person_id, workspace_id);
      `);
    },
  },
  {
    // Docs: respuestas en los hilos de comentarios (parent_id = comentario
    // raíz; al borrar la raíz se va el hilo) y plantillas guardadas por el
    // workspace a partir de una página (bloques copiados en el momento).
    id: '058_docs_comment_replies_templates',
    async up(client) {
      await addColumn(
        client,
        'ALTER TABLE docs_comments ADD COLUMN parent_id TEXT REFERENCES docs_comments(id) ON DELETE CASCADE',
      );
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_docs_comments_parent ON docs_comments(parent_id) WHERE parent_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS docs_templates (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          title TEXT NOT NULL DEFAULT '',
          icon TEXT,
          description TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_docs_templates_workspace ON docs_templates(workspace_id, created_at DESC);
      `);
    },
  },
  {
    // CRM: merge de empresas (la papelera recuerda en qué empresa se fusionó),
    // propiedades obligatorias por etapa (JSON de claves), canal de las
    // llamadas ('' = teléfono, 'whatsapp'), resultados de llamada
    // configurables (JSON; NULL = los de siempre) y cache de logos por dominio
    // (favicon del sitio, compartido entre workspaces: es público).
    // Agents: cola de acciones que esperan la aprobación de alguien del equipo.
    id: '064_crm_merge_stage_rules_calls_logos_agent_approvals',
    async up(client) {
      await addColumn(client, 'ALTER TABLE crm_trash ADD COLUMN merged_into TEXT');
      await addColumn(client, "ALTER TABLE crm_stages ADD COLUMN required_fields TEXT NOT NULL DEFAULT '[]'");
      await addColumn(client, "ALTER TABLE crm_activities ADD COLUMN channel TEXT NOT NULL DEFAULT ''");
      await addColumn(client, 'ALTER TABLE crm_settings ADD COLUMN call_outcomes TEXT');
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_logo_cache (
          domain TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('ok', 'missing')),
          content_type TEXT NOT NULL DEFAULT '',
          data BLOB,
          fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS agent_pending_actions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
          tool TEXT NOT NULL,
          input TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'failed')),
          result TEXT,
          decided_by TEXT NOT NULL DEFAULT '',
          decided_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_agent_pending_conv ON agent_pending_actions(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_agent_pending_status ON agent_pending_actions(agent_id, status, created_at DESC);
      `);
    },
  },
  {
    // Agents: la lista calcula conversaciones de 7 días y feedback por
    // workspace; los índices por agent_id obligaban a recorrer las tablas
    // enteras. La lista se ordena por created_at (el índice viejo es por
    // updated_at y armaba un B-tree temporal).
    id: '066_agent_stats_indexes',
    async up(client) {
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_created ON agent_conversations(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_agent_feedback_user_agent ON agent_feedback(user_id, agent_id);
        CREATE INDEX IF NOT EXISTS idx_agents_user_created ON agents(user_id, created_at);
      `);
    },
  },
  {
    // Importadores (Track: Linear, Jira, GitHub y CSV; Cal: Calendly; Docs:
    // export de Notion). Un job por importación: primero trae y deja en
    // import_job_items lo normalizado (vista previa), después escribe por
    // tandas; el cron de cada minuto lo sigue si no entra en un request
    // (claim por locked_until). El token de terceros va cifrado en `secret`
    // y se borra apenas se terminó de leer la fuente. import_external_ids
    // recuerda qué id externo ya se importó (reimportar no duplica).
    id: '067_import_jobs',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS import_jobs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          team_id TEXT,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          app TEXT NOT NULL CHECK (app IN ('track', 'cal', 'docs')),
          source TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'fetching' CHECK (status IN ('uploading', 'fetching', 'preview', 'importing', 'done', 'failed', 'cancelled')),
          stage TEXT NOT NULL DEFAULT '',
          options TEXT NOT NULL DEFAULT '{}',
          secret TEXT,
          payload TEXT,
          cursor TEXT NOT NULL DEFAULT '{}',
          total INTEGER NOT NULL DEFAULT 0,
          processed INTEGER NOT NULL DEFAULT 0,
          preview TEXT,
          report TEXT,
          error TEXT,
          locale TEXT NOT NULL DEFAULT 'en',
          locked_until TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_import_jobs_workspace ON import_jobs(workspace_id, app, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status, updated_at);
        CREATE TABLE IF NOT EXISTS import_job_items (
          job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          kind TEXT NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (job_id, seq)
        );
        CREATE TABLE IF NOT EXISTS import_external_ids (
          workspace_id TEXT NOT NULL,
          source TEXT NOT NULL,
          kind TEXT NOT NULL,
          external_id TEXT NOT NULL,
          local_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (workspace_id, source, kind, external_id)
        );
      `);
    },
  },
  {
    // CRM: migración desde HubSpot/Pipedrive por API (lib/crm-import-jobs.ts).
    // Un job por import con su token cifrado (se borra al terminar o
    // cancelar), el plan (campos, pipelines, owners), el cursor por fase y
    // los conteos. crm_external_ids recuerda qué registro nuestro es cada id
    // del otro CRM: reimportar actualiza en vez de duplicar.
    id: '069_crm_import_jobs',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_import_jobs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_by TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'preview'
            CHECK (status IN ('preview', 'queued', 'running', 'done', 'failed', 'cancelled')),
          token TEXT NOT NULL DEFAULT '',
          options TEXT NOT NULL DEFAULT '{}',
          preview TEXT NOT NULL DEFAULT '{}',
          plan TEXT,
          cursor TEXT NOT NULL DEFAULT '{}',
          counts TEXT NOT NULL DEFAULT '{}',
          errors TEXT NOT NULL DEFAULT '[]',
          error_count INTEGER NOT NULL DEFAULT 0,
          failure TEXT NOT NULL DEFAULT '',
          attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          started_at TEXT,
          finished_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_import_jobs_user ON crm_import_jobs(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_import_jobs_status ON crm_import_jobs(status, locked_until);

        CREATE TABLE IF NOT EXISTS crm_external_ids (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          object TEXT NOT NULL,
          external_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, provider, object, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_external_ids_record ON crm_external_ids(user_id, object, record_id);
        -- Dedupe por email y dominio sin recorrer todo el workspace (import de 50k).
        CREATE INDEX IF NOT EXISTS idx_crm_contacts_email_lower ON crm_contacts(user_id, lower(email));
        CREATE INDEX IF NOT EXISTS idx_crm_companies_domain_lower ON crm_companies(user_id, lower(domain));
      `);
    },
  },
  {
    // Groups (bandeja de WhatsApp para equipos, lib/groups*.ts): números
    // conectados (credenciales cifradas con secret-box), chats 1:1 y grupos,
    // miembros, mensajes (dedupe por id del proveedor), etiquetas,
    // propiedades propias, tickets con SLA, envíos masivos con estado por
    // destinatario (claims por fila en el cron) y respuestas rápidas.
    id: '070_groups',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS groups_numbers (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL CHECK (provider IN ('cloud', 'waha', 'evolution', 'fake')),
          phone TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'qr', 'connected', 'disconnected', 'error')),
          config TEXT NOT NULL DEFAULT '',
          webhook_secret TEXT NOT NULL,
          last_error TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_numbers_user ON groups_numbers(user_id, created_at);

        CREATE TABLE IF NOT EXISTS groups_chats (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          number_id TEXT NOT NULL REFERENCES groups_numbers(id) ON DELETE CASCADE,
          provider_chat_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
          name TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          invite_link TEXT NOT NULL DEFAULT '',
          member_count INTEGER NOT NULL DEFAULT 0,
          assigned_to TEXT,
          properties TEXT NOT NULL DEFAULT '{}',
          crm_contact_id TEXT,
          crm_company_id TEXT,
          agent_id TEXT,
          agent_conversation_id TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
          unread_count INTEGER NOT NULL DEFAULT 0,
          last_message_at TEXT,
          last_message_preview TEXT NOT NULL DEFAULT '',
          awaiting_since TEXT,
          flagged_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (number_id, provider_chat_id)
        );
        CREATE INDEX IF NOT EXISTS idx_groups_chats_user ON groups_chats(user_id, last_message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_groups_chats_awaiting ON groups_chats(awaiting_since) WHERE awaiting_since IS NOT NULL AND flagged_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_groups_chats_crm_company ON groups_chats(user_id, crm_company_id);
        CREATE INDEX IF NOT EXISTS idx_groups_chats_crm_contact ON groups_chats(user_id, crm_contact_id);

        CREATE TABLE IF NOT EXISTS groups_members (
          chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
          phone TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'superadmin')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (chat_id, phone)
        );

        CREATE TABLE IF NOT EXISTS groups_messages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
          number_id TEXT NOT NULL,
          provider_message_id TEXT,
          direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'note', 'system')),
          sender_phone TEXT NOT NULL DEFAULT '',
          sender_name TEXT NOT NULL DEFAULT '',
          author_id TEXT,
          author_kind TEXT NOT NULL DEFAULT 'person',
          body TEXT NOT NULL DEFAULT '',
          media_url TEXT NOT NULL DEFAULT '',
          media_type TEXT NOT NULL DEFAULT '',
          media_name TEXT NOT NULL DEFAULT '',
          reply_to_id TEXT,
          reactions TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'received')),
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_messages_provider ON groups_messages(number_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_groups_messages_chat ON groups_messages(chat_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_groups_messages_user ON groups_messages(user_id, created_at);

        CREATE TABLE IF NOT EXISTS groups_labels (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT 'gray',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, name)
        );
        CREATE TABLE IF NOT EXISTS groups_chat_labels (
          chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
          label_id TEXT NOT NULL REFERENCES groups_labels(id) ON DELETE CASCADE,
          PRIMARY KEY (chat_id, label_id)
        );

        CREATE TABLE IF NOT EXISTS groups_property_defs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          label TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'number', 'select', 'date')),
          options TEXT NOT NULL DEFAULT '[]',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, key)
        );

        CREATE TABLE IF NOT EXISTS groups_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS groups_tickets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          number INTEGER NOT NULL,
          chat_id TEXT REFERENCES groups_chats(id) ON DELETE SET NULL,
          message_id TEXT,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
          priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
          assignee_id TEXT,
          source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reaction', 'keyword', 'api', 'flow')),
          due_at TEXT,
          first_response_due_at TEXT,
          first_response_at TEXT,
          resolved_at TEXT,
          breached_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, number)
        );
        CREATE INDEX IF NOT EXISTS idx_groups_tickets_user ON groups_tickets(user_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_groups_tickets_chat ON groups_tickets(chat_id);
        CREATE INDEX IF NOT EXISTS idx_groups_tickets_due ON groups_tickets(due_at) WHERE breached_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_tickets_message ON groups_tickets(message_id) WHERE message_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS groups_broadcasts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          number_id TEXT NOT NULL REFERENCES groups_numbers(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          media_url TEXT NOT NULL DEFAULT '',
          media_type TEXT NOT NULL DEFAULT '',
          media_name TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT 'broadcast' CHECK (kind IN ('broadcast', 'scheduled')),
          status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'done', 'cancelled')),
          scheduled_at TEXT NOT NULL,
          per_minute INTEGER NOT NULL DEFAULT 20,
          total INTEGER NOT NULL DEFAULT 0,
          sent INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          locked_until TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_groups_broadcasts_user ON groups_broadcasts(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_groups_broadcasts_due ON groups_broadcasts(status, scheduled_at);

        CREATE TABLE IF NOT EXISTS groups_broadcast_recipients (
          id TEXT PRIMARY KEY,
          broadcast_id TEXT NOT NULL REFERENCES groups_broadcasts(id) ON DELETE CASCADE,
          chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
          error TEXT NOT NULL DEFAULT '',
          message_id TEXT,
          sent_at TEXT,
          UNIQUE (broadcast_id, chat_id)
        );
        CREATE INDEX IF NOT EXISTS idx_groups_recipients_status ON groups_broadcast_recipients(broadcast_id, status);

        CREATE TABLE IF NOT EXISTS groups_quick_replies (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          shortcut TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, shortcut)
        );
      `);
    },
  },
  {
    // IA del CRM (lib/crm-ai*.ts): resultados cacheados por registro (resumen
    // de contacto/empresa/deal, score y plan del deal, resumen de llamada o
    // reunión) con el hash del contexto para saber si quedaron viejos, y los
    // agentes de datos/prospección: corridas con nombre e ítems por registro
    // (claim por fila en claimed_at, los procesa el request y el cron).
    id: '071_crm_ai',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_ai_insights (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity TEXT NOT NULL CHECK (entity IN ('contact', 'company', 'deal', 'activity')),
          entity_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('summary', 'deal_score', 'call_summary')),
          content TEXT NOT NULL DEFAULT '{}',
          score INTEGER,
          source_hash TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, entity, entity_id, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_ai_insights_kind ON crm_ai_insights(user_id, kind, entity);

        CREATE TABLE IF NOT EXISTS crm_ai_runs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT '',
          agent TEXT NOT NULL CHECK (agent IN ('enrich_companies', 'enrich_contacts', 'outreach')),
          target TEXT NOT NULL DEFAULT '{}',
          instructions TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
          total INTEGER NOT NULL DEFAULT 0,
          processed INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_crm_ai_runs_user ON crm_ai_runs(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_ai_runs_status ON crm_ai_runs(status);

        CREATE TABLE IF NOT EXISTS crm_ai_run_items (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES crm_ai_runs(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity TEXT NOT NULL CHECK (entity IN ('contact', 'company')),
          entity_id TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'ready', 'failed', 'applied', 'skipped', 'sent')),
          output TEXT NOT NULL DEFAULT '{}',
          error TEXT,
          claimed_at TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_ai_run_items_run ON crm_ai_run_items(run_id, position);
        CREATE INDEX IF NOT EXISTS idx_crm_ai_run_items_pending ON crm_ai_run_items(status, claimed_at);
      `);
    },
  },
  {
    // CRM: objetos propios (definición, registros con campos propios de
    // entidad `obj:<id>` y asociaciones con contactos/empresas/deals), objeto
    // Lead con su pipeline de etapas y conversión a deal, permisos por campo
    // (solo lectura u oculto por rol o equipo de ventas), actividades de leads
    // y registros propios en el timeline, y datos de empresa desde el sitio
    // (descripción, redes, año de fundación).
    id: '072_crm_objects_leads',
    async up(client) {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_objects (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          slug TEXT NOT NULL,
          singular TEXT NOT NULL,
          plural TEXT NOT NULL,
          primary_label TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, slug)
        );

        CREATE TABLE IF NOT EXISTS crm_object_records (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          object_id TEXT NOT NULL REFERENCES crm_objects(id) ON DELETE CASCADE,
          owner_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          custom TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_object_records_obj ON crm_object_records(user_id, object_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_object_links (
          record_id TEXT NOT NULL REFERENCES crm_object_records(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entity TEXT NOT NULL CHECK (entity IN ('contact', 'company', 'deal')),
          entity_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (record_id, entity, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_object_links_entity ON crm_object_links(user_id, entity, entity_id);

        CREATE TABLE IF NOT EXISTS crm_lead_stages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          kind TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'qualified', 'disqualified'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_lead_stages_user ON crm_lead_stages(user_id, position);

        CREATE TABLE IF NOT EXISTS crm_leads (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          owner_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          stage_id TEXT NOT NULL,
          position REAL NOT NULL DEFAULT 0,
          contact_id TEXT,
          company_id TEXT,
          source TEXT NOT NULL DEFAULT '',
          disqualify_reason TEXT NOT NULL DEFAULT '',
          deal_id TEXT,
          converted_at TEXT,
          custom TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_leads_user ON crm_leads(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage_id, position);
        CREATE INDEX IF NOT EXISTS idx_crm_leads_contact ON crm_leads(contact_id) WHERE contact_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS crm_field_permissions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          field_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          access TEXT NOT NULL CHECK (access IN ('read', 'hidden')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (field_id, subject)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_field_permissions_user ON crm_field_permissions(user_id);
      `);
      await addColumn(client, 'ALTER TABLE crm_activities ADD COLUMN lead_id TEXT');
      await addColumn(client, 'ALTER TABLE crm_activities ADD COLUMN object_record_id TEXT');
      await addColumn(client, "ALTER TABLE crm_companies ADD COLUMN description TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE crm_companies ADD COLUMN linkedin_url TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE crm_companies ADD COLUMN twitter_url TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE crm_companies ADD COLUMN facebook_url TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE crm_companies ADD COLUMN instagram_url TEXT NOT NULL DEFAULT ''");
      await addColumn(client, 'ALTER TABLE crm_companies ADD COLUMN founded_year INTEGER');
      await addColumn(client, 'ALTER TABLE crm_companies ADD COLUMN enriched_at TEXT');
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON crm_activities(lead_id) WHERE lead_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_crm_activities_object_record ON crm_activities(object_record_id) WHERE object_record_id IS NOT NULL;
      `);
    },
  },
  {
    // CRM ejecución de ventas: playbooks y sus usos, varios lead scores con
    // umbrales y decaimiento, aprobaciones de etapa, splits de deals y el
    // origen (secuencia) de las tareas que la cola de trabajo recorre.
    id: '073_crm_sales_exec',
    async up(client) {
      await addColumn(client, 'ALTER TABLE crm_score_rules ADD COLUMN score_id TEXT');
      await addColumn(client, 'ALTER TABLE crm_activities ADD COLUMN sequence_id TEXT');
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_playbooks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          questions TEXT NOT NULL DEFAULT '[]',
          entities TEXT NOT NULL DEFAULT '["contact","company","deal"]',
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_playbooks_user ON crm_playbooks(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS crm_playbook_runs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          playbook_id TEXT REFERENCES crm_playbooks(id) ON DELETE SET NULL,
          playbook_name TEXT NOT NULL DEFAULT '',
          entity TEXT NOT NULL CHECK (entity IN ('contact', 'company', 'deal')),
          entity_id TEXT NOT NULL,
          activity_id TEXT,
          answers TEXT NOT NULL DEFAULT '{}',
          actor_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_playbook_runs_entity ON crm_playbook_runs(user_id, entity, entity_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_playbook_runs_playbook ON crm_playbook_runs(playbook_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_scores (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          is_primary INTEGER NOT NULL DEFAULT 0,
          thresholds TEXT NOT NULL DEFAULT '[]',
          decay_days INTEGER,
          decay_pct INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_scores_user ON crm_scores(user_id, position);

        CREATE TABLE IF NOT EXISTS crm_contact_scores (
          contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
          score_id TEXT NOT NULL REFERENCES crm_scores(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 0,
          breakdown TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT,
          PRIMARY KEY (contact_id, score_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_contact_scores_score ON crm_contact_scores(score_id, score);

        CREATE TABLE IF NOT EXISTS crm_approval_rules (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
          stage_id TEXT NOT NULL REFERENCES crm_stages(id) ON DELETE CASCADE,
          min_amount REAL,
          min_discount REAL,
          approver_ids TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_approval_rules_stage ON crm_approval_rules(user_id, stage_id);

        CREATE TABLE IF NOT EXISTS crm_deal_approvals (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          rule_id TEXT REFERENCES crm_approval_rules(id) ON DELETE SET NULL,
          stage_id TEXT NOT NULL,
          from_stage_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
          requested_by TEXT,
          note TEXT NOT NULL DEFAULT '',
          approver_ids TEXT NOT NULL DEFAULT '[]',
          decided_by TEXT,
          decision_note TEXT NOT NULL DEFAULT '',
          decided_at TEXT,
          consumed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_deal_approvals_status ON crm_deal_approvals(user_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_deal_approvals_deal ON crm_deal_approvals(deal_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_deal_splits (
          deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          percent REAL NOT NULL,
          PRIMARY KEY (deal_id, owner_id)
        );
        CREATE INDEX IF NOT EXISTS idx_crm_deal_splits_owner ON crm_deal_splits(user_id, owner_id);
      `);
    },
  },
  {
    // CRM reportes: constructor de reportes propios (config JSON validada en
    // lib/crm-report-builder.ts), historial completo de etapas de cada deal
    // (una fila por entrada a una etapa, para el recorrido de deals), categoría
    // de forecast por deal ('' = la de su etapa) y números de forecast que
    // envía cada persona por período (el último vale; el resto es historial).
    // El historial se reconstruye para los deals existentes desde los cambios
    // de etapa del audit trail (crm_property_events guarda nombres).
    id: '074_crm_reports',
    async up(client) {
      await addColumn(client, "ALTER TABLE crm_deals ADD COLUMN forecast_category TEXT NOT NULL DEFAULT ''");
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_custom_reports (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_custom_reports_user ON crm_custom_reports(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS crm_deal_stage_history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
          pipeline_id TEXT NOT NULL,
          stage_id TEXT NOT NULL,
          entered_at TEXT NOT NULL,
          exited_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_crm_stage_history_deal ON crm_deal_stage_history(deal_id, entered_at);
        CREATE INDEX IF NOT EXISTS idx_crm_stage_history_pipeline ON crm_deal_stage_history(user_id, pipeline_id, entered_at);

        CREATE TABLE IF NOT EXISTS crm_forecast_submissions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          period TEXT NOT NULL CHECK (period IN ('month', 'quarter')),
          period_label TEXT NOT NULL,
          amount REAL NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          submitted_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_forecast_sub ON crm_forecast_submissions(user_id, period, period_label, person_id, created_at DESC);
      `);

      // Backfill del historial (ids deterministas: correr dos veces no duplica).
      const deals = (await client.execute(
        `SELECT d.id, d.user_id, d.pipeline_id, d.stage_id, d.created_at, d.closed_at, d.updated_at FROM crm_deals d
         WHERE NOT EXISTS (SELECT 1 FROM crm_deal_stage_history h WHERE h.deal_id = d.id)`,
      )).rows;
      if (!deals.length) return;
      const stages = (await client.execute('SELECT id, pipeline_id, name FROM crm_stages')).rows;
      const byName = new Map<string, string>();
      for (const s of stages) byName.set(`${s.pipeline_id}|${String(s.name).toLowerCase()}`, String(s.id));
      const events = (await client.execute(
        "SELECT entity_id, old_value, new_value, created_at FROM crm_property_events WHERE entity = 'deal' AND field = 'stage' ORDER BY created_at ASC",
      )).rows;
      const evByDeal = new Map<string, Array<{ old: string; next: string; at: string }>>();
      for (const e of events) {
        const k = String(e.entity_id);
        const list = evByDeal.get(k) ?? [];
        list.push({ old: String(e.old_value), next: String(e.new_value), at: String(e.created_at) });
        evByDeal.set(k, list);
      }
      const stmts: Array<{ sql: string; args: Array<string | null> }> = [];
      for (const d of deals) {
        const dealId = String(d.id);
        const pipelineId = String(d.pipeline_id);
        const find = (name: string) => byName.get(`${pipelineId}|${name.toLowerCase()}`) ?? null;
        const entries: Array<{ stage: string; at: string }> = [];
        const evs = evByDeal.get(dealId) ?? [];
        const first = evs.length ? find(evs[0].old) : null;
        if (first) entries.push({ stage: first, at: String(d.created_at) });
        for (const e of evs) {
          const st = find(e.next);
          if (st) entries.push({ stage: st, at: e.at });
        }
        const current = String(d.stage_id);
        if (!entries.length) entries.push({ stage: current, at: String(d.created_at) });
        else if (entries[entries.length - 1].stage !== current) {
          const last = entries[entries.length - 1].at;
          const at = String(d.closed_at ?? d.updated_at ?? last);
          entries.push({ stage: current, at: at > last ? at : last });
        }
        entries.forEach((e, i) => {
          const exited = i + 1 < entries.length ? entries[i + 1].at : null;
          stmts.push({
            sql: `INSERT OR IGNORE INTO crm_deal_stage_history (id, user_id, deal_id, pipeline_id, stage_id, entered_at, exited_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [`bf-${dealId}-${i}`, String(d.user_id), dealId, pipelineId, e.stage, e.at, exited],
          });
        });
      }
      for (let i = 0; i < stmts.length; i += 200) await client.batch(stmts.slice(i, i + 200), 'write');
    },
  },
  {
    // CRM integraciones (tanda C5): filtro de propiedades y log de entregas de
    // webhooks, apps conectadas (Slack, Zoom, Stripe, Zapier/Make), firma y
    // cobro de cotizaciones, biblioteca de documentos con links de
    // seguimiento y videos 1:1 con sus vistas.
    id: '075_crm_integrations',
    async up(client) {
      await addColumn(client, 'ALTER TABLE webhooks ADD COLUMN crm_filter TEXT');
      await addColumn(client, 'ALTER TABLE webhook_deliveries ADD COLUMN response_body TEXT');
      await addColumn(client, 'ALTER TABLE webhook_deliveries ADD COLUMN duration_ms INTEGER');
      await addColumn(client, 'ALTER TABLE webhook_deliveries ADD COLUMN claimed_until TEXT');
      await addColumn(client, 'ALTER TABLE crm_quotes ADD COLUMN collect_payment INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, "ALTER TABLE crm_quotes ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'none'");
      await addColumn(client, 'ALTER TABLE crm_quotes ADD COLUMN paid_at TEXT');
      await addColumn(client, 'ALTER TABLE crm_quotes ADD COLUMN amount_paid REAL');
      await addColumn(client, 'ALTER TABLE crm_quotes ADD COLUMN stripe_session_id TEXT');
      await addColumn(client, 'ALTER TABLE crm_quotes ADD COLUMN first_viewed_at TEXT');
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_claim ON webhook_deliveries(status, claimed_until);

        CREATE TABLE IF NOT EXISTS crm_apps (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          app TEXT NOT NULL,
          secrets TEXT NOT NULL DEFAULT '',
          settings TEXT NOT NULL DEFAULT '{}',
          webhook_token TEXT,
          last_error TEXT,
          last_used_at TEXT,
          connected_by TEXT,
          connected_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, app)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_apps_token ON crm_apps(webhook_token);

        CREATE TABLE IF NOT EXISTS crm_app_log (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          app TEXT NOT NULL,
          event TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ok',
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_app_log ON crm_app_log(user_id, app, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_stripe_events (
          event_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_quote_signatures (
          id TEXT PRIMARY KEY,
          quote_id TEXT NOT NULL UNIQUE REFERENCES crm_quotes(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          signer_name TEXT NOT NULL,
          signer_email TEXT NOT NULL DEFAULT '',
          signature_image TEXT NOT NULL DEFAULT '',
          ip TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          content_hash TEXT NOT NULL,
          viewed_at TEXT,
          signed_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS crm_documents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          filename TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_documents_user ON crm_documents(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS crm_document_links (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          document_id TEXT NOT NULL REFERENCES crm_documents(id) ON DELETE CASCADE,
          contact_id TEXT REFERENCES crm_contacts(id) ON DELETE SET NULL,
          token TEXT NOT NULL UNIQUE,
          created_by TEXT,
          views INTEGER NOT NULL DEFAULT 0,
          last_viewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_document_links_doc ON crm_document_links(document_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS crm_document_views (
          id TEXT PRIMARY KEY,
          link_id TEXT NOT NULL REFERENCES crm_document_links(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_ping_at TEXT NOT NULL DEFAULT (datetime('now')),
          seconds INTEGER NOT NULL DEFAULT 0,
          pages TEXT NOT NULL DEFAULT '{}',
          page_count INTEGER NOT NULL DEFAULT 0,
          activity_id TEXT,
          ip_hash TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_crm_document_views_link ON crm_document_views(link_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS crm_videos (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'video/webm',
          size INTEGER NOT NULL DEFAULT 0,
          duration_sec REAL NOT NULL DEFAULT 0,
          contact_id TEXT REFERENCES crm_contacts(id) ON DELETE SET NULL,
          token TEXT NOT NULL UNIQUE,
          message TEXT NOT NULL DEFAULT '',
          created_by TEXT,
          views INTEGER NOT NULL DEFAULT 0,
          last_viewed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_videos_user ON crm_videos(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS crm_video_views (
          id TEXT PRIMARY KEY,
          video_id TEXT NOT NULL REFERENCES crm_videos(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_ping_at TEXT NOT NULL DEFAULT (datetime('now')),
          watched_sec REAL NOT NULL DEFAULT 0,
          max_position REAL NOT NULL DEFAULT 0,
          duration_sec REAL NOT NULL DEFAULT 0,
          activity_id TEXT,
          ip_hash TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_crm_video_views_video ON crm_video_views(video_id, started_at DESC);
      `);
    },
  },
  {
    // CRM canales: sync de Outlook / Microsoft 365 (estado delta por buzón y
    // reuniones del calendario ya volcadas al timeline) y llamadas desde el
    // navegador con Twilio (llamadas, grabación, transcripción, ajustes).
    id: '076_crm_channels',
    up: async (client) => {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS crm_outlook_sync (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          inbox_delta TEXT,
          sent_delta TEXT,
          calendar_delta TEXT,
          calendar_window_at TEXT,
          status TEXT NOT NULL DEFAULT 'idle',
          error TEXT,
          last_sync_at TEXT,
          last_full_sync_at TEXT,
          locked_until TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, person_id)
        );

        CREATE TABLE IF NOT EXISTS crm_outlook_events (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          event_key TEXT NOT NULL,
          person_id TEXT NOT NULL,
          activity_id TEXT REFERENCES crm_activities(id) ON DELETE SET NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, event_key)
        );

        CREATE TABLE IF NOT EXISTS crm_calls (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT,
          contact_id TEXT REFERENCES crm_contacts(id) ON DELETE SET NULL,
          company_id TEXT REFERENCES crm_companies(id) ON DELETE SET NULL,
          deal_id TEXT REFERENCES crm_deals(id) ON DELETE SET NULL,
          call_sid TEXT UNIQUE,
          direction TEXT NOT NULL DEFAULT 'outbound',
          to_number TEXT NOT NULL DEFAULT '',
          from_number TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'initiated',
          recorded INTEGER NOT NULL DEFAULT 0,
          answered_at TEXT,
          ended_at TEXT,
          duration_sec INTEGER,
          recording_sid TEXT,
          recording_duration INTEGER,
          transcript TEXT NOT NULL DEFAULT '',
          transcript_status TEXT NOT NULL DEFAULT 'none',
          summary TEXT NOT NULL DEFAULT '',
          summary_status TEXT NOT NULL DEFAULT 'none',
          activity_id TEXT REFERENCES crm_activities(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_calls_user ON crm_calls(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_crm_calls_activity ON crm_calls(activity_id);
        CREATE INDEX IF NOT EXISTS idx_crm_calls_contact ON crm_calls(user_id, contact_id);

        CREATE TABLE IF NOT EXISTS crm_voice_settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          caller_id TEXT NOT NULL DEFAULT '',
          record_calls INTEGER NOT NULL DEFAULT 0,
          consent_enabled INTEGER NOT NULL DEFAULT 1,
          consent_text TEXT NOT NULL DEFAULT '',
          transcribe INTEGER NOT NULL DEFAULT 1,
          language TEXT NOT NULL DEFAULT 'en-US',
          inbound_enabled INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_voice_caller ON crm_voice_settings(caller_id) WHERE caller_id <> '';
      `);
    },
  },
  {
    // CRM: tipo de una tarea (HubSpot: To-do, Call, Email). Una tarea de
    // llamada o email sigue siendo tarea pendiente (Tasks, cola, vencimientos)
    // y recién al completarla cuenta como contacto: los triggers de fechas de
    // actividad se recrean para mirar task_kind.
    id: '077_crm_task_kind',
    up: async (client) => {
      await addColumn(client, "ALTER TABLE crm_activities ADD COLUMN task_kind TEXT NOT NULL DEFAULT ''");
      for (const name of ACTIVITY_DATE_TRIGGERS) await client.execute(`DROP TRIGGER IF EXISTS ${name}`);
      await client.executeMultiple(activityDateTriggersSql());
      for (const { table } of ACTIVITY_DATE_TABLES) await client.execute(activityDatesUpdateSql(table));
    },
  },
  {
    // Groups, bandeja (lib/groups-inbox.ts): mensajes editados, borrados para
    // todos, fijados, reenviados, traducciones cacheadas por idioma y `meta`
    // (llamadas, eventos de asignación, menciones). En los chats: fijado y
    // equipo asignado. Equipos de la bandeja, disponibilidad por persona y
    // reglas de asignación round-robin (claim con compare-and-set sobre
    // last_person_id y sobre assigned_to IS NULL).
    id: '080_groups_inbox',
    async up(client) {
      for (const sql of [
        'ALTER TABLE groups_messages ADD COLUMN edited_at TEXT',
        'ALTER TABLE groups_messages ADD COLUMN deleted_at TEXT',
        'ALTER TABLE groups_messages ADD COLUMN pinned_at TEXT',
        'ALTER TABLE groups_messages ADD COLUMN pinned_by TEXT',
        'ALTER TABLE groups_messages ADD COLUMN forwarded INTEGER NOT NULL DEFAULT 0',
        "ALTER TABLE groups_messages ADD COLUMN translations TEXT NOT NULL DEFAULT '{}'",
        "ALTER TABLE groups_messages ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'",
        'ALTER TABLE groups_chats ADD COLUMN pinned_at TEXT',
        'ALTER TABLE groups_chats ADD COLUMN assigned_team_id TEXT',
      ]) {
        await addColumn(client, sql);
      }
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_groups_messages_pinned ON groups_messages(chat_id) WHERE pinned_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_groups_chats_unassigned ON groups_chats(user_id, status) WHERE assigned_to IS NULL;

        CREATE TABLE IF NOT EXISTS groups_teams (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, name)
        );
        CREATE TABLE IF NOT EXISTS groups_team_members (
          team_id TEXT NOT NULL REFERENCES groups_teams(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          PRIMARY KEY (team_id, person_id)
        );
        CREATE TABLE IF NOT EXISTS groups_availability (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          available INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, person_id)
        );
        CREATE TABLE IF NOT EXISTS groups_assign_rules (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          position INTEGER NOT NULL DEFAULT 0,
          number_id TEXT,
          label_id TEXT,
          kind TEXT CHECK (kind IS NULL OR kind IN ('dm', 'group')),
          team_id TEXT,
          person_ids TEXT NOT NULL DEFAULT '[]',
          last_person_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_assign_rules_user ON groups_assign_rules(user_id, position);
      `);
    },
  },
  {
    // Groups, organización y tickets (lib/groups-org.ts, lib/groups-tasks.ts):
    // propiedades propias con más tipos (multiselección, archivo, casilla,
    // URL y desplegable dependiente) y también para tickets (scope, required
    // al cerrar), ajustes del grupo (foto, solo admins escriben o editan,
    // mensajes temporales, salida), marca de pregunta por mensaje (needs_reply),
    // campos propios del ticket, plantillas de grupo, listas guardadas y
    // tareas desde el chat (la tarea vive en crm_activities; reminded_for es
    // el claim del cron por vencimiento).
    id: '081_groups_org_tickets',
    async up(client) {
      // La tabla de propiedades tenía un CHECK con 4 tipos: se rehace con los
      // nuevos, en una transacción (client.migrate) y solo si todavía no tiene
      // scope, así dos instancias migrando a la vez no se pisan.
      const defsTable = `(
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scope TEXT NOT NULL DEFAULT 'chat' CHECK (scope IN ('chat', 'ticket')),
          key TEXT NOT NULL,
          label TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'text'
            CHECK (type IN ('text', 'number', 'select', 'multiselect', 'date', 'checkbox', 'url', 'file', 'cascade')),
          options TEXT NOT NULL DEFAULT '[]',
          required INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, scope, key)
        )`;
      const current = await client.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'groups_property_defs'");
      const currentSql = String(current.rows[0]?.sql ?? '');
      if (!currentSql) {
        await client.execute(`CREATE TABLE IF NOT EXISTS groups_property_defs ${defsTable}`);
      } else if (!/\bscope\b/.test(currentSql)) {
        const cols = 'id, user_id, key, label, type, options, position, created_at';
        await client.migrate([
          'DROP TABLE IF EXISTS groups_property_defs_v2',
          `CREATE TABLE groups_property_defs_v2 ${defsTable}`,
          `INSERT INTO groups_property_defs_v2 (${cols}) SELECT ${cols} FROM groups_property_defs`,
          'DROP TABLE groups_property_defs',
          'ALTER TABLE groups_property_defs_v2 RENAME TO groups_property_defs',
        ]);
      }
      await addColumn(client, "ALTER TABLE groups_chats ADD COLUMN picture_url TEXT NOT NULL DEFAULT ''");
      await addColumn(client, 'ALTER TABLE groups_chats ADD COLUMN announce INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE groups_chats ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE groups_chats ADD COLUMN ephemeral INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE groups_chats ADD COLUMN left_at TEXT');
      await addColumn(client, 'ALTER TABLE groups_messages ADD COLUMN needs_reply INTEGER');
      await addColumn(client, "ALTER TABLE groups_tickets ADD COLUMN fields TEXT NOT NULL DEFAULT '{}'");
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS groups_templates (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          group_name TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          members TEXT NOT NULL DEFAULT '[]',
          admins TEXT NOT NULL DEFAULT '[]',
          label_ids TEXT NOT NULL DEFAULT '[]',
          welcome TEXT NOT NULL DEFAULT '',
          settings TEXT NOT NULL DEFAULT '{}',
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_templates_user ON groups_templates(user_id, name);

        CREATE TABLE IF NOT EXISTS groups_saved_lists (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          owner_id TEXT NOT NULL,
          shared INTEGER NOT NULL DEFAULT 0,
          name TEXT NOT NULL,
          filters TEXT NOT NULL DEFAULT '{}',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_saved_lists_user ON groups_saved_lists(user_id, position);

        CREATE TABLE IF NOT EXISTS groups_tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
          message_id TEXT,
          activity_id TEXT NOT NULL UNIQUE,
          created_by TEXT,
          locale TEXT NOT NULL DEFAULT 'en',
          timezone TEXT NOT NULL DEFAULT 'UTC',
          reminded_for TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_tasks_chat ON groups_tasks(chat_id);
        CREATE INDEX IF NOT EXISTS idx_groups_tasks_user ON groups_tasks(user_id, created_at DESC);
      `);
    },
  },
  {
    // Groups, plataforma: mensajes recurrentes (regla + próxima corrida, cada
    // corrida es un envío con recurring_id), encuestas (poll en el mensaje y
    // votos por persona), log de auditoría por chat, acceso por etiqueta y
    // ocultar teléfonos (groups_platform), integraciones (Slack, Freshdesk,
    // Zoho Desk) con el ticket remoto vinculado, push web (suscripciones y
    // avisos pendientes). Los reintentos de webhooks usan el claim de 075
    // (webhook_deliveries.claimed_until).
    id: '082_groups_platform',
    up: async (client) => {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS groups_recurring (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          number_id TEXT NOT NULL REFERENCES groups_numbers(id) ON DELETE CASCADE,
          name TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          media_url TEXT NOT NULL DEFAULT '',
          media_type TEXT NOT NULL DEFAULT '',
          media_name TEXT NOT NULL DEFAULT '',
          poll TEXT NOT NULL DEFAULT '',
          chat_ids TEXT NOT NULL DEFAULT '[]',
          rule TEXT NOT NULL DEFAULT '{}',
          timezone TEXT NOT NULL DEFAULT 'UTC',
          per_minute INTEGER NOT NULL DEFAULT 20,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
          next_run_at TEXT,
          last_run_at TEXT,
          runs INTEGER NOT NULL DEFAULT 0,
          ends_at TEXT,
          locked_until TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_recurring_user ON groups_recurring(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_groups_recurring_due ON groups_recurring(status, next_run_at);

        CREATE TABLE IF NOT EXISTS groups_poll_votes (
          message_id TEXT NOT NULL REFERENCES groups_messages(id) ON DELETE CASCADE,
          voter TEXT NOT NULL,
          voter_name TEXT NOT NULL DEFAULT '',
          options TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (message_id, voter)
        );

        CREATE TABLE IF NOT EXISTS groups_audit (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          chat_id TEXT,
          chat_name TEXT NOT NULL DEFAULT '',
          actor_id TEXT,
          actor_kind TEXT NOT NULL DEFAULT 'person',
          action TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_audit_chat ON groups_audit(chat_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_groups_audit_user ON groups_audit(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS groups_platform (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS groups_label_access (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          label_id TEXT NOT NULL REFERENCES groups_labels(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          PRIMARY KEY (label_id, person_id)
        );
        CREATE INDEX IF NOT EXISTS idx_groups_label_access_person ON groups_label_access(user_id, person_id);

        CREATE TABLE IF NOT EXISTS groups_integrations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('slack', 'freshdesk', 'zoho')),
          config TEXT NOT NULL DEFAULT '',
          events TEXT NOT NULL DEFAULT '[]',
          active INTEGER NOT NULL DEFAULT 1,
          last_error TEXT NOT NULL DEFAULT '',
          last_used_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (user_id, kind)
        );

        CREATE TABLE IF NOT EXISTS groups_ticket_links (
          ticket_id TEXT NOT NULL REFERENCES groups_tickets(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          remote_id TEXT NOT NULL,
          remote_url TEXT NOT NULL DEFAULT '',
          remote_status TEXT NOT NULL DEFAULT '',
          synced_at TEXT,
          locked_until TEXT,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (ticket_id, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_groups_ticket_links_sync ON groups_ticket_links(synced_at);

        CREATE TABLE IF NOT EXISTS groups_push_subscriptions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL DEFAULT '',
          auth TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_push_person ON groups_push_subscriptions(user_id, person_id);

        CREATE TABLE IF NOT EXISTS groups_notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL,
          chat_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          url TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          delivered_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_groups_notifications_person ON groups_notifications(user_id, person_id, delivered_at);
      `);
      await addColumn(client, 'ALTER TABLE groups_broadcasts ADD COLUMN recurring_id TEXT');
      await addColumn(client, "ALTER TABLE groups_messages ADD COLUMN poll TEXT NOT NULL DEFAULT ''");
      await addColumn(client, "ALTER TABLE groups_broadcasts ADD COLUMN poll TEXT NOT NULL DEFAULT ''");
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_groups_broadcasts_recurring ON groups_broadcasts(recurring_id) WHERE recurring_id IS NOT NULL;
      `);
    },
  },
  {
    // Docs, editor (tanda D1): favoritos por persona (orden manual),
    // recordatorios de las menciones de fecha (claim por fila en sent_at),
    // contenido compartido de los bloques sincronizados y la posición
    // vertical de la portada.
    id: '090_docs_editor',
    async up(client) {
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN cover_position REAL');
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS docs_favorites (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          position REAL NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, page_id)
        );
        CREATE INDEX IF NOT EXISTS idx_docs_favorites_user ON docs_favorites(user_id, workspace_id, position);
        CREATE TABLE IF NOT EXISTS docs_reminders (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          rid TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          remind_at TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          timezone TEXT NOT NULL DEFAULT 'UTC',
          locale TEXT NOT NULL DEFAULT 'en',
          sent_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (page_id, rid)
        );
        CREATE INDEX IF NOT EXISTS idx_docs_reminders_due ON docs_reminders(sent_at, remind_at);
        CREATE TABLE IF NOT EXISTS docs_synced_blocks (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          source_page_id TEXT REFERENCES docs_pages(id) ON DELETE SET NULL,
          content TEXT NOT NULL DEFAULT '[]',
          updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_docs_synced_workspace ON docs_synced_blocks(workspace_id);
      `);
    },
  },
  {
    // Bases de Docs (tanda D2): registro de corridas de automatizaciones y
    // botones (qué se disparó, en qué fila y si salió bien), para mostrarlo
    // en el panel de automatizaciones. Las bases siguen viviendo en el
    // content de la página.
    id: '091_docs_databases',
    up: async (client) => {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS docs_db_automation_runs (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          block_id TEXT NOT NULL,
          automation_id TEXT NOT NULL,
          row_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_docs_db_runs_block ON docs_db_automation_runs(page_id, block_id, created_at DESC);
      `);
    },
  },
  {
    // Últimas versiones guardadas de cada página (contenido y campos): un
    // guardado hecho sobre una versión vieja (otra pestaña, una automatización
    // o una operación del servidor en una base) se fusiona contra la versión
    // que vio el editor en vez de volver 409.
    id: '093_docs_page_revisions',
    up: async (client) => {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS docs_page_revisions (
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          icon TEXT,
          cover_url TEXT,
          content TEXT NOT NULL,
          PRIMARY KEY (page_id, updated_at)
        );
      `);
    },
  },
  {
    // Docs, colaboración y permisos (tanda D3): presencia en vivo, bloqueo de
    // página, rol de los miembros por página, teamspaces, invitados por email
    // sin cuenta, auditoría, ajustes de seguridad del workspace, páginas
    // verificadas con vencimiento (claim por fila en verify_notified_at) y el
    // ancla de los comentarios sobre texto.
    id: '092_docs_collab',
    async up(client) {
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN locked_by TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN member_role TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN teamspace_id TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN page_owner_id TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN verified_by TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN verified_at TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN verified_until TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN verify_notified_at TEXT');
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN verify_locale TEXT');
      await addColumn(client, 'ALTER TABLE docs_comments ADD COLUMN anchor_id TEXT');
      await addColumn(client, "ALTER TABLE docs_comments ADD COLUMN quote TEXT NOT NULL DEFAULT ''");
      await client.executeMultiple(`
        CREATE INDEX IF NOT EXISTS idx_docs_pages_teamspace ON docs_pages(user_id, teamspace_id);
        CREATE INDEX IF NOT EXISTS idx_docs_pages_verify ON docs_pages(verified_until, verify_notified_at);
        CREATE TABLE IF NOT EXISTS docs_presence (
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          block_id TEXT,
          sel_start INTEGER,
          sel_end INTEGER,
          mode TEXT NOT NULL DEFAULT 'view',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (page_id, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_docs_presence_page ON docs_presence(page_id, updated_at);
        CREATE TABLE IF NOT EXISTS docs_teamspaces (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          icon TEXT,
          description TEXT NOT NULL DEFAULT '',
          access TEXT NOT NULL DEFAULT 'open',
          member_role TEXT NOT NULL DEFAULT 'edit',
          ai_knowledge INTEGER NOT NULL DEFAULT 0,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_docs_teamspaces_ws ON docs_teamspaces(workspace_id, name);
        CREATE TABLE IF NOT EXISTS docs_teamspace_members (
          teamspace_id TEXT NOT NULL REFERENCES docs_teamspaces(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'member',
          created_at TEXT NOT NULL,
          PRIMARY KEY (teamspace_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_docs_teamspace_members_user ON docs_teamspace_members(user_id);
        CREATE TABLE IF NOT EXISTS docs_guest_invites (
          id TEXT PRIMARY KEY,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'view',
          token_hash TEXT NOT NULL UNIQUE,
          invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          accepted_at TEXT,
          accepted_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE (page_id, email)
        );
        CREATE INDEX IF NOT EXISTS idx_docs_guest_invites_ws ON docs_guest_invites(workspace_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS docs_audit (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          actor_id TEXT,
          actor_label TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL,
          page_id TEXT,
          page_title TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          ip TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_docs_audit_ws ON docs_audit(workspace_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS docs_settings (
          workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          member_role TEXT NOT NULL DEFAULT 'full',
          allow_export INTEGER NOT NULL DEFAULT 1,
          allow_publish INTEGER NOT NULL DEFAULT 1,
          allow_guests INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    // Docs: los bloques sincronizados quedan en el content solo como
    // referencia. Antes cada página guardaba una copia de los hijos y lo que
    // lee el content crudo (búsqueda, versiones, centro de ayuda, bots) la veía
    // aunque quien mira no pudiera abrir la página de origen. La copia pasa a
    // docs_pages.synced_base (solo la usa el guardado) y se borra de las
    // versiones, revisiones y plantillas. Si un sincronizado no tenía fila en
    // docs_synced_blocks, se crea con esa copia (no se pierde contenido).
    id: '094_docs_synced_refs',
    up: async (client) => {
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN synced_base TEXT');
      // Quién guardó el contenido por última vez: autor de la versión que queda
      // cuando una fusión choca y a quién avisarle que perdió ese cambio.
      await addColumn(client, 'ALTER TABLE docs_pages ADD COLUMN content_by TEXT');

      const parse = (raw: unknown): DocsBlock[] | null => {
        try {
          const v = JSON.parse(String(raw ?? '[]')) as unknown;
          return Array.isArray(v) ? (v as DocsBlock[]) : null;
        } catch {
          return null;
        }
      };
      const pages = await client.execute(`SELECT id, user_id, content FROM docs_pages WHERE content LIKE '%"synced"%'`);
      for (const r of pages.rows) {
        const blocks = parse(r.content);
        if (!blocks || !blocks.some((b) => b.type === 'synced')) continue;
        const children = syncedChildren(blocks);
        const base: Record<string, string> = {};
        for (const [sid, kids] of children) {
          const json = JSON.stringify(kids);
          base[sid] = json;
          // Sin fila (raro): se crea con la copia de la página. Es su origen solo
          // si es la única página que lo usa; si lo usan varias, queda sin origen
          // (solo el dueño lo ve): una fila existente nunca cambia de origen acá.
          const users = await client.execute({
            sql: `SELECT COUNT(*) AS n FROM docs_pages WHERE user_id = ? AND content LIKE ?`,
            args: [String(r.user_id), `%"synced_id":"${sid}"%`],
          });
          const only = Number(users.rows[0]?.n ?? 0) <= 1;
          await client.execute({
            sql: `INSERT INTO docs_synced_blocks (id, workspace_id, source_page_id, content, created_at, updated_at)
                  VALUES (?, ?, ?, ?, datetime('now'), datetime('now')) ON CONFLICT(id) DO NOTHING`,
            args: [sid, String(r.user_id), only ? String(r.id) : null, json],
          });
        }
        await client.execute({
          sql: 'UPDATE docs_pages SET content = ?, synced_base = ? WHERE id = ?',
          args: [JSON.stringify(stripSyncedChildren(blocks)), JSON.stringify(base), String(r.id)],
        });
      }
      const strip = async (table: string) => {
        const rows = await client.execute(`SELECT rowid AS rid, content FROM ${table} WHERE content LIKE '%"synced"%'`);
        for (const r of rows.rows) {
          const blocks = parse(r.content);
          if (!blocks || !blocks.some((b) => b.type === 'synced')) continue;
          await client.execute({ sql: `UPDATE ${table} SET content = ? WHERE rowid = ?`, args: [JSON.stringify(stripSyncedChildren(blocks)), r.rid] });
        }
      };
      await strip('docs_versions');
      await strip('docs_page_revisions');
      await strip('docs_templates');
    },
  },
  {
    // Docs (re-QA de D3): teamspaces cerrados o privados borrados (sus páginas
    // quedan en la papelera, solo para sus miembros y admins) y las últimas
    // versiones de cada bloque sincronizado: un guardado hecho sobre una
    // versión vieja se fusiona contra la que vio el editor en vez de pisar.
    id: '095_docs_synced_history',
    up: async (client) => {
      await addColumn(client, 'ALTER TABLE docs_teamspaces ADD COLUMN deleted_at TEXT');
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS docs_synced_history (
          synced_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          content TEXT NOT NULL,
          PRIMARY KEY (synced_id, updated_at)
        );
      `);
    },
  },
  {
    // Docs como plataforma (tanda D4): eventos de página hacia Flow y
    // webhooks (con un tope por página para las ediciones), bases
    // sincronizadas con GitHub, Jira, Salesforce o el CRM (se refrescan por
    // cron con claim) y notas de reunión con IA.
    id: '096_docs_platform',
    up: async (client) => {
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS docs_event_marks (
          page_id TEXT PRIMARY KEY REFERENCES docs_pages(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          actor_id TEXT,
          due_at TEXT NOT NULL,
          claimed_until TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_docs_event_marks_due ON docs_event_marks(due_at);
        CREATE TABLE IF NOT EXISTS docs_synced_sources (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          block_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          secret TEXT,
          created_by TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          last_error TEXT,
          item_count INTEGER NOT NULL DEFAULT 0,
          interval_min INTEGER NOT NULL DEFAULT 15,
          last_synced_at TEXT,
          next_sync_at TEXT,
          claimed_until TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (page_id, block_id)
        );
        CREATE INDEX IF NOT EXISTS idx_docs_synced_due ON docs_synced_sources(next_sync_at);
        CREATE TABLE IF NOT EXISTS docs_meetings (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'idle',
          transcript TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          decisions TEXT NOT NULL DEFAULT '[]',
          actions TEXT NOT NULL DEFAULT '[]',
          duration_sec INTEGER NOT NULL DEFAULT 0,
          tasks_claimed_until TEXT,
          last_error TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_docs_meetings_page ON docs_meetings(page_id);
      `);
    },
  },
];

export async function runMigrations(client: Client, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );
  const done = new Set(
    (await client.execute('SELECT id FROM schema_migrations')).rows.map((r) => String(r.id)),
  );
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    await m.up(client);
    await client.execute({
      sql: 'INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)',
      args: [m.id],
    });
    applied.push(m.id);
  }
  return applied;
}

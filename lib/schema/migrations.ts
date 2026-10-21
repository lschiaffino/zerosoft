import type { Client } from '@libsql/client';
import { baseline } from './baseline';
import { pickHandle } from './handles';
import { ACTIVITY_DATE_TABLES, activityDateTriggersSql, activityDatesUpdateSql } from '../crm-activity-dates';

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
      await client.executeMultiple(activityDateTriggersSql());
      for (const { table } of ACTIVITY_DATE_TABLES) await client.execute(activityDatesUpdateSql(table));
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

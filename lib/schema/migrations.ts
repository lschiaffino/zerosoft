import type { Client } from '@libsql/client';
import { baseline } from './baseline';
import { pickHandle } from './handles';

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

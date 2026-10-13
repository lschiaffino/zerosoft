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

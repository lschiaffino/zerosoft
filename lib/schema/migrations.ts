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

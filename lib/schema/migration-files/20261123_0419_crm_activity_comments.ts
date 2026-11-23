import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

/**
 * CRM, bloque C1: notas con formato y comentarios en las actividades (como
 * "Add comment" de HubSpot).
 *
 * - crm_activities.body_format: 'text' (texto plano, todo lo de antes) o 'md'
 *   (markdown del editor con formato; lib/crm-note-format.ts lo sanea al
 *   guardar y el render escapa el HTML).
 * - crm_activity_comments: un hilo por actividad. `user_id` es el workspace y
 *   `author_id` la persona que escribió. Cae con la actividad (FK en cascada),
 *   así la papelera lo guarda en el snapshot y lo restaura con ella.
 *
 * Idempotente: columna con addColumn, tabla e índice con IF NOT EXISTS.
 */
export default {
  id: '20261123_0419_crm_activity_comments',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE crm_activities ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text'");
    await c.execute(`
      CREATE TABLE IF NOT EXISTS crm_activity_comments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        activity_id TEXT NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        edited INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_crm_activity_comments_activity ON crm_activity_comments(activity_id, created_at)');
  },
} satisfies Migration;

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
 * CRM, bloque B2: vistas guardadas como las de HubSpot.
 *
 * - crm_saved_views.person_id: quien creó la vista (NULL = las de antes, que
 *   cuentan como del dueño del workspace).
 * - crm_saved_views.visibility: 'private' | 'team' | 'everyone'. Las que ya
 *   existían las veía todo el workspace, así que quedan en 'everyone'.
 * - crm_saved_views.team_id: el equipo de ventas de una vista 'team'.
 * - crm_view_tabs: las pestañas de cada persona por objeto (orden, fijadas y
 *   cerradas), un JSON [{ key, pinned }] (lib/crm-views-shared.ts).
 *
 * Idempotente: columnas con addColumn, tabla e índice IF NOT EXISTS.
 */
export default {
  id: '20261122_0206_crm_saved_views_sharing',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE crm_saved_views ADD COLUMN person_id TEXT');
    await addColumn(c, "ALTER TABLE crm_saved_views ADD COLUMN visibility TEXT NOT NULL DEFAULT 'everyone'");
    await addColumn(c, 'ALTER TABLE crm_saved_views ADD COLUMN team_id TEXT');
    await addColumn(c, 'ALTER TABLE crm_saved_views ADD COLUMN updated_at TEXT');
    await c.executeMultiple(`
      CREATE INDEX IF NOT EXISTS idx_crm_saved_views_entity ON crm_saved_views(user_id, entity);
      CREATE TABLE IF NOT EXISTS crm_view_tabs (
        user_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        tabs TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, person_id, entity)
      );
    `);
  },
} satisfies Migration;

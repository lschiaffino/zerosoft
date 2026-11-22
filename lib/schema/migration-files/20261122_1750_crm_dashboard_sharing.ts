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
 * CRM Dashboards como los de HubSpot: dueño, acceso, filtros guardados y un
 * dashboard por defecto para cada persona.
 *
 * - crm_dashboards.owner_id: la persona que lo creó (NULL = el dueño del
 *   workspace, como quedan los de antes).
 * - crm_dashboards.visibility: 'private' (solo su dueño), 'team' (un equipo
 *   de ventas, team_id) o 'everyone' (todo el workspace). Los de antes eran
 *   de todo el workspace: quedan en 'everyone'.
 * - crm_dashboards.access: qué puede hacer el resto con quien se comparte,
 *   'view' o 'edit'. Los de antes se editaban entre todos: 'edit'.
 * - crm_dashboards.filters: filtros del dashboard (rango, owner, equipo,
 *   pipeline) en JSON.
 * - crm_dashboard_prefs: el dashboard que cada persona abre primero.
 *
 * Idempotente: columnas con addColumn y tabla con IF NOT EXISTS.
 */
export default {
  id: '20261122_1750_crm_dashboard_sharing',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE crm_dashboards ADD COLUMN owner_id TEXT');
    await addColumn(c, "ALTER TABLE crm_dashboards ADD COLUMN visibility TEXT NOT NULL DEFAULT 'everyone'");
    await addColumn(c, 'ALTER TABLE crm_dashboards ADD COLUMN team_id TEXT');
    await addColumn(c, "ALTER TABLE crm_dashboards ADD COLUMN access TEXT NOT NULL DEFAULT 'edit'");
    await addColumn(c, "ALTER TABLE crm_dashboards ADD COLUMN filters TEXT NOT NULL DEFAULT '{}'");
    await c.execute(
      `CREATE TABLE IF NOT EXISTS crm_dashboard_prefs (
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         person_id TEXT NOT NULL,
         default_dashboard_id TEXT,
         updated_at TEXT NOT NULL DEFAULT (datetime('now')),
         PRIMARY KEY (user_id, person_id)
       )`,
    );
  },
} satisfies Migration;

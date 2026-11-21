import type { Migration } from '../migrations';

/**
 * CRM ↔ HubSpot, bloque S2: HubSpot → zerosoft. Solo crea tablas; el sync
 * sigue apagado hasta que un admin lo arranca (crm_hubspot_sync_settings).
 * Aditiva e idempotente.
 *
 * - crm_hubspot_inbound: el estado de la entrada por workspace (una fila):
 *   qué objetos trae, el cursor por fecha de modificación de cada uno, el
 *   plan (dueños, etapas y campos propios emparejados), conteos, códigos de
 *   error recientes (nunca datos), el turno del cron (claim con
 *   locked_until) y la espera ante límites de HubSpot (next_run_at).
 * - crm_hubspot_sync_conflicts: un registro por cada registro nuestro con
 *   valores que cambiaron de los dos lados desde el último sync. Guarda el
 *   objeto, los ids y los nombres de los campos, nunca los valores.
 */
export default {
  id: '20261121_1600_crm_hubspot_inbound',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS crm_hubspot_inbound (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        portal_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'initial',
        objects TEXT NOT NULL DEFAULT '{}',
        cursors TEXT NOT NULL DEFAULT '{}',
        plan TEXT NOT NULL DEFAULT '{}',
        plan_at TEXT,
        counts TEXT NOT NULL DEFAULT '{}',
        errors TEXT NOT NULL DEFAULT '[]',
        failure TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        next_run_at TEXT,
        sweep_at TEXT,
        started_by TEXT NOT NULL DEFAULT '',
        started_at TEXT,
        initial_done_at TEXT,
        last_run_at TEXT,
        last_success_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_inbound_due ON crm_hubspot_inbound(next_run_at);

      CREATE TABLE IF NOT EXISTS crm_hubspot_sync_conflicts (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        object TEXT NOT NULL,
        record_id TEXT NOT NULL,
        hubspot_id TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'fields',
        fields TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, object, record_id)
      );
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_sync_conflicts_recent ON crm_hubspot_sync_conflicts(user_id, updated_at);
    `);
  },
} satisfies Migration;

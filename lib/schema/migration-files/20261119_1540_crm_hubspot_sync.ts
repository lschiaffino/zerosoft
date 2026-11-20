import type { Migration } from '../migrations';

/**
 * CRM ↔ HubSpot, sync de dos vías (bloque S1: conexión y vista previa). Solo
 * crea tablas; nada corre con horario todavía. Aditiva e idempotente.
 *
 * - crm_hubspot_sync: la conexión del workspace (una por workspace). La clave
 *   va cifrada (lib/secret-box) y la fila se borra entera al desconectar.
 *   `key_source` dice si la clave se pegó acá o se tomó de la conexión de
 *   Lines (se copia: desconectar Lines no corta el sync del CRM).
 * - crm_hubspot_sync_settings: prendido (apagado por defecto), dirección y
 *   freno de emergencia. Fila aparte para que sobreviva a una desconexión.
 *   Sin CHECK en `direction`: los valores ('hubspot_to_zerosoft',
 *   'zerosoft_to_hubspot', 'both') los valida el código.
 * - crm_hubspot_links: qué registro nuestro es cada registro de HubSpot, uno a
 *   uno en los dos sentidos, con la última fecha de modificación vista en
 *   HubSpot, el `shadow` (JSON de los valores del último sync, para el merge
 *   de tres vías) y el estado. No extiende crm_external_ids: esa tabla es del
 *   importador (varios proveedores, también campos y etapas), deja que dos
 *   ids ajenos apunten al mismo registro y su `imported_at` decide qué pisa
 *   un re-import. El sync la lee para sembrar estos vínculos.
 * - crm_hubspot_previews: la vista previa (una por workspace): estado, cursor
 *   y el informe. crm_hubspot_preview_rows es su tabla de trabajo mientras
 *   corre (una fila por registro leído, con su clave de coincidencia); se
 *   borra al terminar, fallar o cancelar.
 */
export default {
  id: '20261119_1540_crm_hubspot_sync',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS crm_hubspot_sync (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL DEFAULT '',
        token_kind TEXT NOT NULL DEFAULT '',
        key_source TEXT NOT NULL DEFAULT 'pasted',
        portal_id TEXT NOT NULL DEFAULT '',
        ui_domain TEXT NOT NULL DEFAULT '',
        scopes TEXT NOT NULL DEFAULT '[]',
        checked_at TEXT,
        last_error TEXT NOT NULL DEFAULT '',
        connected_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS crm_hubspot_sync_settings (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0,
        direction TEXT NOT NULL DEFAULT 'hubspot_to_zerosoft',
        paused INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS crm_hubspot_links (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        object TEXT NOT NULL,
        record_id TEXT NOT NULL,
        portal_id TEXT NOT NULL,
        hubspot_id TEXT NOT NULL,
        hubspot_modified_at TEXT,
        shadow TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'linked',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, object, record_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_hubspot_links_remote ON crm_hubspot_links(user_id, portal_id, object, hubspot_id);
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_links_state ON crm_hubspot_links(user_id, state);

      CREATE TABLE IF NOT EXISTS crm_hubspot_previews (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL DEFAULT '',
        portal_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        cursor TEXT NOT NULL DEFAULT '{}',
        plan TEXT NOT NULL DEFAULT '{}',
        progress TEXT NOT NULL DEFAULT '{}',
        report TEXT NOT NULL DEFAULT '{}',
        failure TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        resume_after TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_hubspot_previews_user ON crm_hubspot_previews(user_id);
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_previews_status ON crm_hubspot_previews(status, locked_until);

      CREATE TABLE IF NOT EXISTS crm_hubspot_preview_rows (
        preview_id TEXT NOT NULL,
        side TEXT NOT NULL,
        object TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        match_key TEXT NOT NULL DEFAULT '',
        local_id TEXT NOT NULL DEFAULT '',
        via TEXT NOT NULL DEFAULT '',
        bucket TEXT NOT NULL DEFAULT '',
        diff TEXT NOT NULL DEFAULT '',
        newer TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        modified_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (preview_id, side, object, ref_id)
      );
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_preview_rows_key ON crm_hubspot_preview_rows(preview_id, object, match_key);
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_preview_rows_local ON crm_hubspot_preview_rows(preview_id, object, local_id);
      CREATE INDEX IF NOT EXISTS idx_crm_hubspot_preview_rows_bucket ON crm_hubspot_preview_rows(preview_id, object, bucket);
    `);
  },
} satisfies Migration;

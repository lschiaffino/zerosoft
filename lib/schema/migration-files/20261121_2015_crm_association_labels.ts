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
 * CRM, bloque D3: labels de asociación definidos por el workspace, como los de
 * HubSpot ("Contacto de facturación", "Decisor").
 * - crm_association_labels: los labels propios de cada par (contact_company o
 *   deal_contact). En las asociaciones se guardan como `custom:<id>`.
 * - crm_deal_contacts.label: el label de la asociación deal ↔ contacto
 *   ('' = sin label). contact ↔ company ya tenía su columna.
 * Idempotente (IF NOT EXISTS, addColumn).
 */
export default {
  id: '20261121_2015_crm_association_labels',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS crm_association_labels (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        pair TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await c.execute(
      'CREATE INDEX IF NOT EXISTS idx_crm_association_labels_user ON crm_association_labels(user_id, pair, position)',
    );
    await addColumn(c, "ALTER TABLE crm_deal_contacts ADD COLUMN label TEXT NOT NULL DEFAULT ''");
  },
} satisfies Migration;

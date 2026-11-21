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
 * CRM, bloque D2 del modelo de datos:
 * - crm_custom_fields.group_name: grupo de la propiedad ('' = sin grupo), como
 *   los grupos de propiedades de HubSpot (ordenan ajustes y ficha).
 * - crm_custom_fields.description: ayuda que se muestra junto al campo.
 * - crm_custom_fields.is_unique: 1 = dos registros del objeto no pueden tener
 *   el mismo valor (lib/crm-unique.ts).
 * - crm_deals.deal_type ('' | 'newbusiness' | 'existingbusiness'), next_step y
 *   won_reason: propiedades de fábrica del deal en HubSpot.
 * Idempotente con addColumn.
 */
export default {
  id: '20261121_1825_crm_property_groups_unique_deal_props',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE crm_custom_fields ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
    await addColumn(c, "ALTER TABLE crm_custom_fields ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    await addColumn(c, 'ALTER TABLE crm_custom_fields ADD COLUMN is_unique INTEGER NOT NULL DEFAULT 0');
    await addColumn(c, "ALTER TABLE crm_deals ADD COLUMN deal_type TEXT NOT NULL DEFAULT ''");
    await addColumn(c, "ALTER TABLE crm_deals ADD COLUMN next_step TEXT NOT NULL DEFAULT ''");
    await addColumn(c, "ALTER TABLE crm_deals ADD COLUMN won_reason TEXT NOT NULL DEFAULT ''");
  },
} satisfies Migration;

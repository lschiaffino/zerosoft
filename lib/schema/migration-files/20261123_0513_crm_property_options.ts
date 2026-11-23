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
 * CRM, bloque C2: opciones editables de Lifecycle stage y Lead status (como
 * HubSpot) y lifecycle que avanza solo.
 *
 * crm_property_options: una fila por opción del workspace. `value` es la
 * clave que guardan los registros (nunca cambia: renombrar cambia `label`, y
 * así el nombre nuevo aparece en todos los registros sin reescribirlos).
 * `label` vacío = el nombre traducido de siempre (solo en las de fábrica).
 * Sin filas para una propiedad, el workspace usa las de fábrica.
 *
 * crm_settings.lifecycle_auto: 1 (por defecto) = al crear un deal el
 * contacto y la empresa pasan a Opportunity y al ganarlo a Customer.
 * Idempotente (IF NOT EXISTS, addColumn).
 */
export default {
  id: '20261123_0513_crm_property_options',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS crm_property_options (
        user_id TEXT NOT NULL,
        property TEXT NOT NULL,
        value TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, property, value)
      )
    `);
    await addColumn(c, 'ALTER TABLE crm_settings ADD COLUMN lifecycle_auto INTEGER NOT NULL DEFAULT 1');
  },
} satisfies Migration;

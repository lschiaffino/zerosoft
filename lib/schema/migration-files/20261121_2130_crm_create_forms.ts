import type { Migration } from '../migrations';

/**
 * CRM, bloque D3b: formulario de alta configurable por objeto (HubSpot
 * "Manage create form"). Una fila por workspace y objeto (contacts,
 * companies, deals); `fields` es el JSON [{ key, required }] en orden
 * (lib/crm-create-form-shared.ts). Sin fila, el alta usa el formulario por
 * defecto. Idempotente (IF NOT EXISTS).
 */
export default {
  id: '20261121_2130_crm_create_forms',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS crm_create_forms (
        user_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        fields TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, entity)
      )
    `);
  },
} satisfies Migration;

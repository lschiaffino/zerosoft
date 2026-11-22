import type { Migration } from '../migrations';

/**
 * CRM, bloque P4: vista previa y tarjetas del board configurables (HubSpot
 * "Customize the preview sidebar" y "Edit cards"). Una fila por workspace,
 * tipo (`preview` o `card`), objeto y alcance (`scope`: el pipeline en las
 * tarjetas de deals, '' en la vista previa). `config` es el JSON de
 * lib/crm-layouts-shared.ts. Sin fila, se usa lo de por defecto.
 * Idempotente (IF NOT EXISTS).
 */
export default {
  id: '20261122_1957_crm_record_layouts',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS crm_record_layouts (
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        entity TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, kind, entity, scope)
      )
    `);
  },
} satisfies Migration;

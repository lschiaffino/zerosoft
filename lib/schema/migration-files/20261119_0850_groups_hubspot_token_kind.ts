import type { Migration } from '../migrations';

/**
 * Lines › HubSpot: con qué tipo de clave se conectó el workspace
 * ('service_key', 'private_app' o '' si no se sabe). Idempotente: la columna
 * se agrega ignorando "duplicate column".
 */
export default {
  id: '20261119_0850_groups_hubspot_token_kind',
  up: async (c) => {
    try {
      await c.execute("ALTER TABLE groups_hubspot ADD COLUMN token_kind TEXT NOT NULL DEFAULT ''");
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;

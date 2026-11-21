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
 * CRM ↔ HubSpot: permisos de escritura sin confirmar. La prueba de un permiso
 * de escritura (un batch/update sin registros) solo dice "falta" con un 403;
 * si HubSpot responde otra cosa que no es un éxito ni un error de validación,
 * el permiso queda en `scopes_unknown` (JSON) y la pantalla dice que todavía
 * no se pudo confirmar. Solo una columna nueva: corre dos veces sin romper.
 */
export default {
  id: '20261120_0812_crm_hubspot_sync_unknown_scopes',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE crm_hubspot_sync ADD COLUMN scopes_unknown TEXT NOT NULL DEFAULT '[]'");
  },
} satisfies Migration;

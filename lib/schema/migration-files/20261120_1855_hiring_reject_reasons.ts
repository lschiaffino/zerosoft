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
 * Hiring: motivos de rechazo propios del workspace (lib/hiring/core.ts).
 * hiring_settings.reject_reasons: lista en JSON que edita un admin en Ajustes
 * (NULL: los motivos de fábrica en el idioma del equipo).
 * require_reject_reason: 1 = no se rechaza sin motivo. Idempotente con addColumn.
 */
export default {
  id: '20261120_1855_hiring_reject_reasons',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE hiring_settings ADD COLUMN reject_reasons TEXT');
    await addColumn(c, 'ALTER TABLE hiring_settings ADD COLUMN require_reject_reason INTEGER NOT NULL DEFAULT 0');
  },
} satisfies Migration;

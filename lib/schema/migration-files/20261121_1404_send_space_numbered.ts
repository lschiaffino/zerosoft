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
 * Send: índice numerado de un espacio (lib/send/space-index.ts). send_spaces.numbered:
 * 1 muestra los números de carpetas y documentos al dueño y a quien abre el link.
 * Idempotente con addColumn.
 */
export default {
  id: '20261121_1404_send_space_numbered',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE send_spaces ADD COLUMN numbered INTEGER NOT NULL DEFAULT 0');
  },
} satisfies Migration;

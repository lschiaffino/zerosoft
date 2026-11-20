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
 * Lines: "Bloquear a X" en la info de un chat 1:1 (lib/groups-block.ts).
 * groups_chats.blocked_at: cuándo se bloqueó el contacto en WhatsApp desde
 * Lines (NULL: no está bloqueado). Idempotente con addColumn.
 */
export default {
  id: '20261120_0607_groups_chats_blocked',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE groups_chats ADD COLUMN blocked_at TEXT');
  },
} satisfies Migration;

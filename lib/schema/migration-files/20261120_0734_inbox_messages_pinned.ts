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
 * Inbox: fijar mensajes en un chat de WhatsApp, como en WhatsApp y en Lines
 * (lib/inbox/wa-actions.ts, pinMessage). inbox_messages.pinned_at: cuándo se
 * fijó (NULL: no está fijado). Idempotente con addColumn.
 */
export default {
  id: '20261120_0734_inbox_messages_pinned',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE inbox_messages ADD COLUMN pinned_at TEXT');
  },
} satisfies Migration;

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
 * Menciones en los mensajes programados de WhatsApp (Lines e Inbox): el
 * programado guarda "@Nombre" en el texto y acá, en JSON, a quién es cada
 * mención (`[{ phone, label }]`, lib/wa-compose-mentions.ts). Al salir pasa a
 * "@<teléfono>" con la lista de mencionados, igual que uno mandado en el
 * momento; antes salía sin la lista y WhatsApp no la mostraba como mención.
 *
 * - groups_broadcasts.mentions: programados de Lines (y cada vuelta de un
 *   recurrente).
 * - groups_recurring.mentions: los recurrentes de Lines.
 * - inbox_scheduled.mentions: programados de Inbox.
 *
 * Idempotente: columnas con addColumn, vacías por defecto.
 */
export default {
  id: '20261120_0603_scheduled_wa_mentions',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE groups_broadcasts ADD COLUMN mentions TEXT NOT NULL DEFAULT ''");
    await addColumn(c, "ALTER TABLE groups_recurring ADD COLUMN mentions TEXT NOT NULL DEFAULT ''");
    await addColumn(c, "ALTER TABLE inbox_scheduled ADD COLUMN mentions TEXT NOT NULL DEFAULT ''");
  },
} satisfies Migration;

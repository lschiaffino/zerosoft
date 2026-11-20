import type { Migration } from '../migrations';

/**
 * Info del mensaje de WhatsApp (Lines e Inbox): las confirmaciones de cada
 * persona para un mensaje propio, como el panel de WhatsApp ("Leído por",
 * "Entregado a"). Lo escribe y lo lee lib/wa-receipts-store.ts.
 *
 * - `app`: 'lines' (message_id = groups_messages.id) o 'inbox'
 *   (message_id = inbox_messages.id).
 * - `participant`: dígitos del teléfono de la persona, o de su lid si no se
 *   sabe el teléfono. En un 1:1 va '' (el otro lado del chat).
 * - `owner_id`: el workspace (Lines) o la persona (Inbox): el borrado de la
 *   cuenta lo encuentra por ahí.
 * - Cada hora queda con la primera vez que se supo (entregado, leído,
 *   escuchado), así una confirmación repetida o fuera de orden no la cambia.
 *
 * Idempotente y tolera correr en paralelo (IF NOT EXISTS).
 */
export default {
  id: '20261120_0528_wa_message_receipts',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS wa_message_receipts (
      app TEXT NOT NULL,
      message_id TEXT NOT NULL,
      participant TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      played_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (app, message_id, participant)
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_wa_message_receipts_owner ON wa_message_receipts(owner_id)');
  },
} satisfies Migration;

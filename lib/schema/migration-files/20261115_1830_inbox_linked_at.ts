import type { Migration } from '../migrations';

/**
 * Inbox: cuándo se empezó a vincular la cuenta de WhatsApp por última vez (el QR). Lo que el teléfono dice de un chat
 * (archivado, no leídos) se copia solo a los chats que entraron después de ese momento: en los que ya estaban manda lo
 * que la persona hizo en Inbox (lib/inbox/whatsapp.ts, isFreshThread). NULL en las cuentas vinculadas antes.
 */
export default {
  id: '20261115_1830_inbox_linked_at',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE inbox_accounts ADD COLUMN linked_at TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;

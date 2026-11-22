import type { Migration } from '../migrations';

/**
 * Inbox: salir de un grupo de WhatsApp (o que te saquen) deja el chat como
 * historial de solo lectura, como en WhatsApp. left_at dice desde cuándo la
 * cuenta ya no está en el grupo; volver a entrar (que te agreguen o el link)
 * lo vacía. Lines ya lo tiene en groups_chats.left_at.
 */
export default {
  id: '20261122_0641_inbox_group_left',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE inbox_threads ADD COLUMN left_at TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  },
} satisfies Migration;

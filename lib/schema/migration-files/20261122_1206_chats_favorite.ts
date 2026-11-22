import type { Migration } from '../migrations';

/**
 * Favoritos, como la lista de WhatsApp, en Inbox y en Lines: desde cuándo un
 * chat está en Favoritos (NULL: no está). Inbox lo guarda por chat de la
 * persona (inbox_threads) y Lines por chat de la línea (groups_chats, lo ve
 * todo el equipo, como fijar).
 */
export default {
  id: '20261122_1206_chats_favorite',
  up: async (c) => {
    for (const table of ['inbox_threads', 'groups_chats']) {
      try {
        await c.execute(`ALTER TABLE ${table} ADD COLUMN favorite_at TEXT`);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;

import type { Migration } from '../migrations';

/**
 * VIP, la división de la bandeja con las personas importantes, en Inbox y en
 * Lines. VIP es la persona, no el chat: Inbox la guarda por dueña y teléfono o
 * correo (inbox_vips, en minúsculas), Lines por workspace y teléfono
 * (groups_vips, la comparte el equipo).
 */
export default {
  id: '20261122_1229_vips',
  up: async (c) => {
    await c.execute(
      'CREATE TABLE IF NOT EXISTS inbox_vips (owner_id TEXT NOT NULL, handle TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, handle))',
    );
    await c.execute(
      'CREATE TABLE IF NOT EXISTS groups_vips (user_id TEXT NOT NULL, phone TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, PRIMARY KEY (user_id, phone))',
    );
  },
} satisfies Migration;

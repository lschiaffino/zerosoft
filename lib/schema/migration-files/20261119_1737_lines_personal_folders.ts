import type { Migration } from '../migrations';

/**
 * Lines: las carpetas pasan a ser de cada persona.
 *
 * - groups_folders.owner_id: la persona dueña de la carpeta. Las que ya
 *   existían quedan para quien las creó (created_by); si no quedó anotado, o
 *   esa cuenta ya no existe, para el dueño del workspace (user_id).
 * - groups_chat_folders: en qué carpeta tiene cada persona cada chat (una por
 *   persona y chat). Lo que estaba en groups_chats.folder_id pasa a la persona
 *   dueña de esa carpeta.
 *
 * No borra nada: groups_chats.folder_id y groups_folders.created_by quedan
 * como estaban (ya no se leen), para poder volver atrás.
 *
 * Idempotente: los chats se copian solo de las carpetas que todavía no tienen
 * dueño, y recién después se les pone. Correrla dos veces, o dos a la vez, no
 * duplica (INSERT OR IGNORE sobre la clave persona + chat) ni pisa lo que la
 * persona movió después.
 */
const OWNER = `CASE WHEN f.created_by <> '' AND EXISTS (SELECT 1 FROM users u WHERE u.id = f.created_by) THEN f.created_by ELSE f.user_id END`;

export default {
  id: '20261119_1737_lines_personal_folders',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE groups_folders ADD COLUMN owner_id TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
    await c.execute(`
      CREATE TABLE IF NOT EXISTS groups_chat_folders (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
        folder_id TEXT NOT NULL REFERENCES groups_folders(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (person_id, chat_id)
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_chat_folders_folder ON groups_chat_folders(user_id, person_id, folder_id)');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_chat_folders_chat ON groups_chat_folders(chat_id)');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_folders_owner ON groups_folders(user_id, owner_id, parent_id, position)');
    await c.execute(`
      INSERT OR IGNORE INTO groups_chat_folders (user_id, person_id, chat_id, folder_id)
      SELECT c.user_id, ${OWNER}, c.id, c.folder_id
      FROM groups_chats c JOIN groups_folders f ON f.id = c.folder_id AND f.user_id = c.user_id
      WHERE c.folder_id IS NOT NULL AND f.owner_id IS NULL
    `);
    await c.execute(`UPDATE groups_folders AS f SET owner_id = ${OWNER} WHERE f.owner_id IS NULL`);
  },
} satisfies Migration;

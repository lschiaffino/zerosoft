import type { Migration } from '../migrations';
import { folderOwnerBackfill } from '../lines-folder-owner';

/**
 * Lines: las carpetas pasan a ser de cada persona.
 *
 * - groups_folders.owner_id: la persona dueña de la carpeta. Las que ya
 *   existían quedan para quien las creó (created_by) si sigue en el workspace;
 *   si no quedó anotado, o esa persona ya no está, para el dueño del
 *   workspace (user_id). La regla está en ../lines-folder-owner.ts.
 * - groups_chat_folders: en qué carpeta tiene cada persona cada chat (una por
 *   persona y chat). Lo que estaba en groups_chats.folder_id pasa a la persona
 *   dueña de esa carpeta.
 * - wa_live_events.person_id: un aviso en vivo que es solo para una persona
 *   (movió un chat a una carpeta suya): sus otras pantallas se enteran y las
 *   de los demás no. Vacío = para todos los que ven el chat, como siempre.
 *
 * No borra nada: groups_chats.folder_id y groups_folders.created_by quedan
 * como estaban (ya no se leen ni se escriben), para poder volver atrás.
 *
 * Idempotente: los chats se copian solo de las carpetas que todavía no tienen
 * dueño, y recién después se les pone. Correrla dos veces, o dos a la vez, no
 * duplica (INSERT OR IGNORE sobre la clave persona + chat) ni pisa lo que la
 * persona movió después.
 */
export default {
  id: '20261119_1737_lines_personal_folders',
  up: async (c) => {
    for (const sql of ['ALTER TABLE groups_folders ADD COLUMN owner_id TEXT', "ALTER TABLE wa_live_events ADD COLUMN person_id TEXT NOT NULL DEFAULT ''"]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
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
    for (const sql of folderOwnerBackfill(false)) await c.execute(sql);
  },
} satisfies Migration;

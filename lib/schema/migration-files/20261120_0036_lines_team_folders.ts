import type { Migration } from '../migrations';

/**
 * Lines: carpetas del equipo, junto a las de cada persona.
 *
 * - groups_folders.scope: 'personal' (como hasta ahora, de owner_id) o 'team'
 *   (del workspace: las ve todo el que entra a Lines; las crean, renombran,
 *   mueven y borran los admins). Una carpeta del equipo lleva owner_id = ''
 *   (no NULL): así ni la reparación de carpetas sin dueño
 *   (lines-folder-owner.ts) ni una instancia de la versión anterior, que lee
 *   `owner_id = <persona>`, la toman por la carpeta personal de alguien.
 * - groups_chat_team_folders: en qué carpeta del equipo está cada chat (una
 *   por chat, para todos). Va aparte de groups_chat_folders: el mismo chat
 *   puede estar en una carpeta del equipo y en una personal a la vez.
 *
 * Solo agrega: no cambia ni borra filas. Las carpetas que ya existen quedan
 * 'personal' (el valor por defecto). Idempotente y segura en paralelo
 * (`duplicate column` se ignora, IF NOT EXISTS).
 */
export default {
  id: '20261120_0036_lines_team_folders',
  up: async (c) => {
    try {
      await c.execute("ALTER TABLE groups_folders ADD COLUMN scope TEXT NOT NULL DEFAULT 'personal'");
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
    await c.execute(`
      CREATE TABLE IF NOT EXISTS groups_chat_team_folders (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chat_id TEXT PRIMARY KEY REFERENCES groups_chats(id) ON DELETE CASCADE,
        folder_id TEXT NOT NULL REFERENCES groups_folders(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_chat_team_folders_folder ON groups_chat_team_folders(user_id, folder_id)');
    await c.execute("CREATE INDEX IF NOT EXISTS idx_groups_folders_team ON groups_folders(user_id, parent_id, position) WHERE scope = 'team'");
  },
} satisfies Migration;

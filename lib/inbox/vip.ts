/**
 * Inbox: VIP, la división de la bandeja con las personas importantes (como el
 * split VIP de Superhuman). VIP es la persona, no el chat: su teléfono (chats
 * 1:1 de WhatsApp, en cualquier cuenta) o su dirección de correo. La vista
 * `vip` (lib/inbox/core.ts) lista todos sus chats de la bandeja. Los grupos y
 * los chats sin teléfono a la vista (por lid) no se marcan. Server-only.
 */
import { getDb } from '../db';

/**
 * Marca o desmarca como VIP a la persona de cada chat (ya filtrados por dueña).
 * Devuelve los chats que tocó: los que tienen a quién marcar.
 */
export async function setThreadsVip(owner: string, threadIds: string[], on: boolean, now = new Date()): Promise<string[]> {
  if (!threadIds.length) return [];
  const db = getDb();
  const rows = (await db
    .prepare(`SELECT id, handle FROM inbox_threads WHERE owner_id = ? AND kind <> 'group' AND handle <> '' AND id IN (${threadIds.map(() => '?').join(',')})`)
    .all(owner, ...threadIds)) as Array<{ id: string; handle: string }>;
  for (const handle of new Set(rows.map((r) => r.handle.toLowerCase()))) {
    if (on) await db.prepare('INSERT INTO inbox_vips (owner_id, handle, created_at) VALUES (?, ?, ?) ON CONFLICT (owner_id, handle) DO NOTHING').run(owner, handle, now.toISOString());
    else await db.prepare('DELETE FROM inbox_vips WHERE owner_id = ? AND handle = ?').run(owner, handle);
  }
  return rows.map((r) => r.id);
}

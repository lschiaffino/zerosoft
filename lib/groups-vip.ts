/**
 * Lines: VIP, la división de la bandeja con las personas importantes (como el
 * split VIP de Superhuman). VIP es la persona, por su teléfono, en todo el
 * workspace: sus chats 1:1 de cualquier línea entran en la pestaña VIP y en el
 * filtro `vip` (lib/groups-filters.ts). Los grupos no son una persona: no se
 * marcan. Server-only.
 */
import { getDb } from './db';
import { GroupsError, getChatRow } from './groups';

/** ¿Ese teléfono es VIP en el workspace? */
export async function isVipPhone(ws: string, phone: string): Promise<boolean> {
  if (!phone) return false;
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM groups_vips WHERE user_id = ? AND phone = ?').get(ws, phone));
}

/** Marca o desmarca como VIP a la persona de un chat 1:1 (su teléfono). Un grupo o un chat sin teléfono: unsupported. */
export async function setChatVip(ws: string, actor: string, chatId: string, on: boolean, now = new Date()): Promise<void> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  if (chat.kind !== 'dm' || !chat.phone) throw new GroupsError('unsupported');
  const db = getDb();
  if (on) {
    await db.prepare('INSERT INTO groups_vips (user_id, phone, created_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, phone) DO NOTHING').run(ws, chat.phone, actor, now.toISOString());
  } else {
    await db.prepare('DELETE FROM groups_vips WHERE user_id = ? AND phone = ?').run(ws, chat.phone);
  }
}

/**
 * Lines: bloquear o desbloquear a un contacto en WhatsApp, como "Bloquear a X"
 * en la info del contacto. Va por el adaptador de la línea
 * (`blockContact`: Evolution /chat/updateBlockStatus; el falso lo anota) y
 * queda guardado en el chat 1:1 (`blocked_at`) para mostrar "Desbloquear".
 * Solo chats 1:1 de una línea conectada. Server-only.
 */
import { getDb } from './db';
import { GroupsError, getChat, getChatRow, providerErrorCode, providerFor, type ChatDto, type NumberRow } from './groups';
import type { GroupsProvider } from './groups-provider';

/** El adaptador de la línea si puede bloquear (si no, null: la Cloud API y WAHA no lo exponen acá). */
export function blockProvider(number: NumberRow): GroupsProvider | null {
  if (number.status !== 'connected') return null;
  try {
    const p = providerFor(number);
    return p.blockContact ? p : null;
  } catch {
    return null;
  }
}

export async function setChatBlocked(ws: string, chatId: string, block: boolean): Promise<ChatDto> {
  const db = getDb();
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  if (chat.kind !== 'dm') throw new GroupsError('unsupported');
  const number = (await db.prepare('SELECT * FROM groups_numbers WHERE id = ? AND user_id = ?').get(chat.number_id, ws)) as NumberRow | undefined;
  if (!number) throw new GroupsError('not_found', 404);
  if (number.status !== 'connected') throw new GroupsError('not_connected', 409);
  const p = blockProvider(number);
  if (!p?.blockContact) throw new GroupsError('unsupported');
  try {
    await p.blockContact(chat.provider_chat_id, block);
  } catch (err) {
    throw new GroupsError(providerErrorCode(err), 502);
  }
  await db.prepare('UPDATE groups_chats SET blocked_at = ? WHERE id = ? AND user_id = ?').run(block ? chat.blocked_at || new Date().toISOString() : null, chat.id, ws);
  const dto = await getChat(ws, chat.id);
  if (!dto) throw new GroupsError('not_found', 404);
  return dto;
}

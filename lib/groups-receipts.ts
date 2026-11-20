/**
 * Lines: Info del mensaje (components/groups/wa/MessageInfo.tsx). Un mensaje
 * propio de un chat que quien mira puede ver; en un grupo, cada persona con
 * su nombre (teléfono enmascarado si no ve teléfonos), foto y horas; en un
 * 1:1, las horas del otro lado. Server-only. Ver lib/wa-receipts.ts.
 */
import { getDb } from './db';
import { GroupsError, getNumberRow, providerFor, type ChatRow, type MessageRow } from './groups';
import { canSeeChat, type GroupsViewer } from './groups-access';
import { linesPeople } from './groups-person';
import { fetchLiveReceipts, receiptRows, storeReceipts } from './wa-receipts-store';
import { ackTimes, gatewayInputs, participantKey, receiptTime, shownTimes, type WaMessageInfo } from './wa-receipts';


export async function linesMessageInfo(viewer: GroupsViewer, chatId: string, messageId: string): Promise<WaMessageInfo> {
  if (!(await canSeeChat(viewer, chatId))) throw new GroupsError('not_found', 404);
  const db = getDb();
  const chat = (await db.prepare('SELECT * FROM groups_chats WHERE id = ? AND user_id = ?').get(chatId, viewer.ws)) as ChatRow | undefined;
  if (!chat) throw new GroupsError('not_found', 404);
  const msg = (await db.prepare('SELECT * FROM groups_messages WHERE id = ? AND chat_id = ? AND user_id = ?').get(messageId, chat.id, viewer.ws)) as MessageRow | undefined;
  // Solo los propios tienen Info (como WhatsApp).
  if (!msg || msg.direction !== 'out') throw new GroupsError('not_found', 404);
  const group = chat.kind === 'group';
  const voice = /^audio\//.test(msg.media_type || '');
  const base = { group, voice, status: msg.status, sentAt: receiptTime(msg.created_at) ?? msg.created_at };

  if (!group) {
    // Las horas de un 1:1 llegan por el webhook (status) y quedan en meta.ack del mensaje, sin otra escritura.
    return { ...base, ...shownTimes(ackTimes(msg.meta)), people: [], live: false, unavailable: false };
  }

  // Grupo: lo que tenga el gateway en este momento (parche 0013), guardado; si no lo da, lo guardado.
  let live = false;
  const number = msg.provider_message_id ? await getNumberRow(viewer.ws, chat.number_id) : null;
  if (number && number.status === 'connected' && msg.provider_message_id) {
    let res: Awaited<ReturnType<typeof fetchLiveReceipts>> = { kind: 'unsupported' };
    try {
      res = await fetchLiveReceipts(providerFor(number), `lines:${number.id}`, chat.provider_chat_id, msg.provider_message_id);
    } catch {
      res = { kind: 'failed' };
    }
    if (res.kind === 'ok') {
      live = true;
      await storeReceipts('lines', viewer.ws, msg.id, gatewayInputs(res.list, number.phone)).catch(() => 0);
    } else if (res.kind === 'recent') live = true;
  }
  const rows = (await receiptRows('lines', msg.id)).filter((r) => r.participant);
  const lids = new Set(rows.map((r) => participantKey(r.participant)).filter((p) => p.lid).map((p) => p.key));
  const people = await linesPeople(viewer, chat, rows.map((r) => participantKey(r.participant).key), lids);
  return {
    ...base,
    deliveredAt: null,
    readAt: null,
    playedAt: null,
    // La clave es la posición: el teléfono no viaja sin máscara.
    people: rows.map((r, i) => ({ key: `p${i}`, ...(people.get(participantKey(r.participant).key) ?? { name: '', pushName: false, phone: '', picture: '' }), ...shownTimes(r) })),
    live,
    unavailable: !live && rows.length === 0,
  };
}

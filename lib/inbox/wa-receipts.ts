/**
 * Inbox: Info del mensaje (components/groups/wa/MessageInfo.tsx). Un mensaje
 * propio de un chat de WhatsApp de la persona; en un grupo, cada persona con
 * su nombre, foto, teléfono y horas; en un 1:1, las horas del otro lado.
 * Server-only. Ver lib/wa-receipts.ts.
 */
import { getDb } from '../db';
import type { AccountRow, ThreadRow } from './core';
import { InboxError } from './types';
import { waProviderFor } from './whatsapp';
import { inboxPeople } from './wa-meta';
import { fetchLiveReceipts, receiptRows, storeReceipts } from '../wa-receipts-store';
import { gatewayInputs, participantKey, receiptTime, shownTimes, type WaMessageInfo } from '../wa-receipts';

export async function inboxMessageInfo(owner: string, threadId: string, messageId: string): Promise<WaMessageInfo> {
  const db = getDb();
  const asked = (await db.prepare('SELECT id, channel FROM inbox_threads WHERE id = ? AND owner_id = ?').get(threadId, owner)) as Pick<ThreadRow, 'id' | 'channel'> | undefined;
  if (!asked || asked.channel !== 'whatsapp') throw new InboxError('not_found', 404);
  // El mensaje puede ser de otra línea del mismo chat (la conversación junta las de todas): manda su propio chat.
  const msg = (await db
    .prepare('SELECT id, thread_id, from_me, status, sent_at, media_type, external_id FROM inbox_messages WHERE id = ? AND owner_id = ?')
    .get(messageId, owner)) as { id: string; thread_id: string; from_me: number; status: string; sent_at: string; media_type: string; external_id: string } | undefined;
  if (!msg || !msg.from_me) throw new InboxError('not_found', 404);
  const thread = (await db.prepare('SELECT * FROM inbox_threads WHERE id = ? AND owner_id = ?').get(msg.thread_id, owner)) as ThreadRow | undefined;
  if (!thread || thread.channel !== 'whatsapp') throw new InboxError('not_found', 404);
  const group = thread.kind === 'group';
  const voice = msg.media_type === 'voice' || msg.media_type === 'audio';
  const base = { group, voice, status: msg.status, sentAt: receiptTime(msg.sent_at) ?? msg.sent_at };

  if (!group) {
    const row = (await receiptRows('inbox', msg.id)).find((r) => r.participant === '');
    const t = shownTimes({ deliveredAt: row?.deliveredAt ?? null, readAt: row?.readAt ?? null, playedAt: row?.playedAt ?? null });
    return { ...base, ...t, people: [], live: false, unavailable: false };
  }

  let live = false;
  const account = (await db.prepare('SELECT * FROM inbox_accounts WHERE id = ? AND owner_id = ?').get(thread.account_id, owner)) as AccountRow | undefined;
  if (account && account.status === 'connected' && msg.external_id) {
    let res: Awaited<ReturnType<typeof fetchLiveReceipts>> = { kind: 'unsupported' };
    try {
      res = await fetchLiveReceipts(waProviderFor(account), `inbox:${account.id}`, thread.external_id, msg.external_id);
    } catch {
      res = { kind: 'failed' };
    }
    if (res.kind === 'ok') {
      live = true;
      await storeReceipts('inbox', owner, msg.id, gatewayInputs(res.list, account.address)).catch(() => 0);
    } else if (res.kind === 'recent') live = true;
  }
  const rows = (await receiptRows('inbox', msg.id)).filter((r) => r.participant);
  const lids = new Set(rows.map((r) => participantKey(r.participant)).filter((p) => p.lid).map((p) => p.key));
  const people = await inboxPeople(owner, thread.account_id, rows.map((r) => participantKey(r.participant).key), undefined, lids);
  return {
    ...base,
    deliveredAt: null,
    readAt: null,
    playedAt: null,
    people: rows.map((r, i) => ({ key: `p${i}`, ...(people.get(participantKey(r.participant).key) ?? { name: '', pushName: false, phone: '', picture: '' }), ...shownTimes(r) })),
    live,
    unavailable: !live && rows.length === 0,
  };
}

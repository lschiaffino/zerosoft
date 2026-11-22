/**
 * Guarda los avisos de sistema de los grupos de WhatsApp (lib/wa-group-events.ts)
 * en Inbox y en Lines. Server-only.
 *
 * - Crear el grupo y que me agreguen (o entrar con el link) suben el chat al
 *   tope de la lista con su hora: así un grupo nuevo aparece aunque todavía
 *   no tenga mensajes. Si el chat no existía, se crea en ese momento.
 * - El resto (salió, sacó, agregó a otro, admins, asunto) solo se guarda si
 *   el chat ya está, y queda como vista previa si es lo último, sin mover el
 *   chat ni sumar no leídos.
 * - Nada de esto cuenta como no leído ni saca el chat de Archivados.
 */
import { dbBatch, getDb } from './db';
import { phoneDigits, type InboundEvent } from './groups-provider';
import { displayName, lookupContacts } from './wa-contacts';
import { pokeLive } from './wa-live';
import { bumpsChat, encodeSysPreview, groupEventId, participantsEvent, personOf, selfMembershipChange, type WaGroupEvent, type WaGroupPerson } from './wa-group-events';
import { findThread, newId, nowIso, upsertThread, type AccountRow, type ThreadRow } from './inbox/core';
import type { ChatRow, NumberRow } from './groups';

export type GroupInbound = Extract<InboundEvent, { type: 'participants' } | { type: 'group' }>;

/** El aviso y su hora a partir de lo que mandó el servidor. null si no hay nada que mostrar. */
export function eventFromInbound(ev: GroupInbound, myPhone: string, now = new Date()): { e: WaGroupEvent; at: string } | null {
  if (ev.type === 'participants') {
    const e = participantsEvent(ev.action, ev.phones, ev.author ?? '', myPhone);
    return e ? { e, at: nowIso(now) } : null;
  }
  if (ev.event === 'create') {
    const who = ev.owner || ev.author || '';
    const at = ev.creation && ev.creation > 0 ? new Date(ev.creation > 1e12 ? ev.creation : ev.creation * 1000) : now;
    return { e: { t: 'create', ...(who ? { by: personOf(who, myPhone) } : {}), ...(ev.subject ? { subject: ev.subject } : {}) }, at: nowIso(Number.isFinite(at.getTime()) ? at : now) };
  }
  if (!ev.author) return null;
  return { e: { t: ev.event, by: personOf(ev.author, myPhone), ...(ev.subject ? { subject: ev.subject } : {}) }, at: nowIso(now) };
}

/** Los nombres de la libreta de la cuenta para quien hizo y a quién (la pantalla no vuelve a buscarlos). */
export async function withNames(scope: { app: 'inbox' | 'lines'; accountId: string }, e: WaGroupEvent): Promise<WaGroupEvent> {
  const people = [e.by, ...(e.who ?? [])].filter((p): p is WaGroupPerson => !!p && p.p !== 'me' && !p.n);
  if (!people.length) return e;
  const rows = await lookupContacts(scope, people.map((p) => p.p.replace(/@lid$/, ''))).catch(() => new Map());
  const name = (p: WaGroupPerson): WaGroupPerson => {
    if (p.p === 'me' || p.n) return p;
    const r = rows.get(p.p.replace(/@lid$/, ''));
    const n = displayName(r);
    // Un lid que la libreta conoce con teléfono: se guarda el teléfono (se muestra si no hay nombre).
    const phone = /@lid$/.test(p.p) && r?.phone ? r.phone : p.p;
    return { p: phone, ...(n ? { n } : {}) };
  };
  return { ...e, ...(e.by ? { by: name(e.by) } : {}), ...(e.who ? { who: e.who.map(name) } : {}) };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

/**
 * Guarda el aviso en el chat de Inbox (una fila de sistema: media_type
 * 'system', el aviso en meta.sys) y lo que le cambia a la fila de la lista.
 * Repetido (mismo id) no hace nada. Devuelve si entró.
 */
export async function addInboxGroupEvent(thread: Pick<ThreadRow, 'id' | 'owner_id' | 'external_id'>, e: WaGroupEvent, at: string): Promise<boolean> {
  const id = newId('ibm');
  const preview = encodeSysPreview(e);
  const bump = bumpsChat(e) ? 1 : 0;
  const newer = '(last_message_at IS NULL OR last_message_at <= ?)';
  const now = nowIso();
  const res = await dbBatch([
    {
      sql: `INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, from_me, sender_name, sender_handle, subject, body, email_to, email_cc,
         email_message_id, media_type, media_name, media_ref, reply_to, status, sent_at, created_at, meta, forwarded)
       VALUES (?, ?, ?, ?, ?, '', '', '', '', '', '', '', 'system', '', '', '', '', ?, ?, ?, 0)
       ON CONFLICT DO NOTHING`,
      args: [id, thread.owner_id, thread.id, groupEventId(e, at, thread.external_id), e.by?.p === 'me' ? 1 : 0, at, now, JSON.stringify({ sys: e })],
    },
    {
      sql: `UPDATE inbox_threads SET
         preview = CASE WHEN ${newer} THEN ? ELSE preview END,
         last_kind = CASE WHEN ${newer} THEN 'system' ELSE last_kind END,
         last_sender = CASE WHEN ${newer} THEN '' ELSE last_sender END,
         last_status = CASE WHEN ${newer} THEN '' ELSE last_status END,
         last_message_at = CASE WHEN ? = 1 AND (last_message_at IS NULL OR last_message_at < ?) THEN ? ELSE last_message_at END,
         updated_at = ?
       WHERE id = ? AND EXISTS (SELECT 1 FROM inbox_messages WHERE id = ?)`,
      args: [at, preview, at, at, at, bump, at, at, now, thread.id, id],
    },
  ]);
  return res[0].changes > 0;
}

/**
 * Un aviso de grupo que llega por el webhook de Inbox. Un grupo que no está
 * todavía se crea solo si el aviso es que lo creé o me agregaron.
 */
export async function inboxGroupEvent(account: AccountRow, ev: GroupInbound, now = new Date()): Promise<boolean> {
  const built = eventFromInbound(ev, phoneDigits(account.address), now);
  if (!built) return false;
  let thread: ThreadRow | null = await findThread(account.id, ev.chatId);
  const subject = ev.type === 'group' ? ev.subject : undefined;
  if (!thread) {
    if (!bumpsChat(built.e)) return false;
    thread = await upsertThread(account, { externalId: ev.chatId, kind: 'group', title: subject });
  } else if (subject && (ev.type === 'group' && ev.event === 'subject')) {
    await getDb().prepare('UPDATE inbox_threads SET title = ? WHERE id = ?').run(subject.slice(0, 200), thread.id);
  }
  const e = await withNames({ app: 'inbox', accountId: account.id }, built.e);
  const added = await addInboxGroupEvent(thread, e, built.at);
  await applyInboxMembership(thread.id, e, built.at);
  // Cambiaron los participantes (o es nuevo): los datos del grupo se vuelven a pedir en la próxima pasada.
  await getDb().prepare('UPDATE inbox_threads SET info_at = NULL WHERE id = ?').run(thread.id);
  if (added) pokeLive('inbox', account.owner_id);
  return added;
}

/**
 * Salió o la sacaron: el chat de Inbox queda de solo lectura (left_at); volver
 * a entrar lo abre de nuevo. Lo mismo para lo que hace la cuenta desde zerosoft.
 */
export async function applyInboxMembership(threadId: string, e: WaGroupEvent, at: string): Promise<void> {
  const change = selfMembershipChange(e);
  if (change === 'left') await getDb().prepare('UPDATE inbox_threads SET left_at = COALESCE(left_at, ?) WHERE id = ?').run(at, threadId);
  else if (change === 'joined') await getDb().prepare('UPDATE inbox_threads SET left_at = NULL WHERE id = ? AND left_at IS NOT NULL').run(threadId);
}

/**
 * Un grupo sin mensajes del que los datos de WhatsApp dicen cuándo se creó y
 * quién: el aviso de creación con esa hora. Así un grupo vacío ocupa en la
 * lista el lugar de su creación (los viejos quedan abajo), en vez del de
 * cuando zerosoft lo importó. No hace nada si el chat ya tiene algo.
 */
export async function inboxCreatedFromInfo(account: Pick<AccountRow, 'id' | 'address'>, thread: Pick<ThreadRow, 'id' | 'owner_id' | 'external_id' | 'kind' | 'last_message_at'>, info: { name: string; createdAt?: number; owner?: string }): Promise<boolean> {
  if (thread.kind !== 'group' || thread.last_message_at || !info.createdAt) return false;
  const me = phoneDigits(account.address);
  const e = await withNames({ app: 'inbox', accountId: account.id }, { t: 'create', ...(info.owner ? { by: personOf(info.owner, me) } : {}), ...(info.name ? { subject: info.name } : {}) });
  return addInboxGroupEvent(thread, e, nowIso(new Date(info.createdAt * 1000)));
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** Guarda el aviso en el chat de Lines (direction 'system', author_kind 'wa', el aviso en meta.sys). Devuelve si entró. */
export async function addLinesGroupEvent(chat: Pick<ChatRow, 'id' | 'user_id' | 'number_id' | 'provider_chat_id'>, e: WaGroupEvent, at: string): Promise<boolean> {
  const { insertMessage } = await import('./groups');
  const row = await insertMessage({
    ws: chat.user_id,
    chatId: chat.id,
    numberId: chat.number_id,
    providerMessageId: groupEventId(e, at, chat.provider_chat_id),
    direction: 'system',
    authorKind: 'wa',
    body: '',
    status: 'received',
    createdAt: at,
    meta: { event: 'wa_group', sys: e },
  });
  if (!row) return false;
  const bump = bumpsChat(e) ? 1 : 0;
  await getDb()
    .prepare(
      `UPDATE groups_chats SET
         last_message_preview = CASE WHEN last_message_at IS NULL OR last_message_at <= ? THEN ? ELSE last_message_preview END,
         last_message_at = CASE WHEN ? = 1 AND (last_message_at IS NULL OR last_message_at < ?) THEN ? ELSE last_message_at END,
         hidden_at = CASE WHEN ? = 1 THEN NULL ELSE hidden_at END,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(at, encodeSysPreview(e), bump, at, at, bump, nowIso(), chat.id);
  return true;
}

/**
 * Un aviso de grupo que llega por el webhook de una línea. Como en Inbox: un
 * grupo que no está se crea solo si lo creé o me agregaron (con el asunto
 * que dé WhatsApp, si no vino en el aviso).
 */
export async function linesGroupEvent(number: NumberRow, ev: GroupInbound, now = new Date()): Promise<boolean> {
  const built = eventFromInbound(ev, phoneDigits(number.phone), now);
  if (!built) return false;
  const db = getDb();
  let chat = (await db.prepare('SELECT * FROM groups_chats WHERE number_id = ? AND provider_chat_id = ?').get(number.id, ev.chatId)) as ChatRow | undefined;
  const subject = ev.type === 'group' ? ev.subject : undefined;
  if (!chat) {
    if (!bumpsChat(built.e)) return false;
    const groups = await import('./groups');
    let name = subject ?? '';
    if (!name) {
      // El asunto, si WhatsApp lo da ya (sin él la lista mostraría el id del grupo).
      const info = await Promise.resolve()
        .then(() => groups.providerFor(number).chatInfo?.(ev.chatId))
        .catch(() => null);
      name = info?.name ?? '';
    }
    chat = await groups.upsertChat(number, { providerChatId: ev.chatId, kind: 'group', name: name || undefined });
  } else if (subject && ev.type === 'group' && ev.event === 'subject') {
    await db.prepare('UPDATE groups_chats SET name = ? WHERE id = ?').run(subject.slice(0, 200), chat.id);
  }
  const e = await withNames({ app: 'lines', accountId: number.id }, built.e);
  const added = await addLinesGroupEvent(chat, e, built.at);
  // Como en Inbox: si la línea salió o la sacaron desde el teléfono, el chat queda de solo lectura; volver a entrar lo abre.
  const change = selfMembershipChange(e);
  if (change === 'left') await db.prepare('UPDATE groups_chats SET left_at = COALESCE(left_at, ?) WHERE id = ?').run(built.at, chat.id);
  else if (change === 'joined') await db.prepare('UPDATE groups_chats SET left_at = NULL WHERE id = ? AND left_at IS NOT NULL').run(chat.id);
  if (added) pokeLive('lines', number.user_id);
  return added;
}

/** Lines: un aviso de algo hecho desde zerosoft por la línea (crear, asunto, descripción). */
export async function linesOwnGroupEvent(chat: Pick<ChatRow, 'id' | 'user_id' | 'number_id' | 'provider_chat_id'>, e: WaGroupEvent, at = nowIso()): Promise<boolean> {
  const added = await addLinesGroupEvent(chat, e, at);
  if (added) pokeLive('lines', chat.user_id);
  return added;
}

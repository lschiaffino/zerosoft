/**
 * Inbox: nombres de WhatsApp. Une la libreta de contactos (lib/wa-contacts.ts)
 * con los chats de la cuenta: aprende de lo que llega (mensajes, contactos,
 * datos de los grupos), renombra los chats 1:1 que tenían el nombre anterior
 * o solo el número, y resuelve las menciones de una página de mensajes.
 * Server-only.
 */
import { getDb } from '../db';
import { isGroupJid, lidDigits, phoneDigits, type ChatInfo, type HistoryContact, type InboundEvent } from '../groups-provider';
import { contactsFromMessage, mentionTargets, phoneForLid, rememberContacts, type ContactInput, type ContactScope, type Renamed } from '../wa-contacts';
import type { MentionMap } from '../wa-mentions';
import type { AccountRow } from './core';

export function inboxScope(account: Pick<AccountRow, 'id' | 'owner_id'>): ContactScope {
  return { app: 'inbox', accountId: account.id, userId: account.owner_id };
}

/** Un contacto del servidor (evento o findContacts) → lo que se guarda. Los grupos no son contactos. */
export function contactInput(c: { chatId: string; name?: string; saved?: string; lid?: string; phone?: string; pictureUrl?: string }): ContactInput | null {
  if (isGroupJid(c.chatId)) return null;
  const phone = c.phone || phoneDigits(c.chatId);
  const lid = c.lid || lidDigits(c.chatId);
  if (!phone && !lid) return null;
  return {
    ...(phone ? { phone } : {}),
    ...(lid ? { lid } : {}),
    ...(c.name ? { push: c.name } : {}),
    ...(c.saved ? { saved: c.saved } : {}),
    ...(c.pictureUrl ? { pictureUrl: c.pictureUrl } : {}),
  };
}

/**
 * Renombra los chats 1:1 de quien cambió de nombre: solo los que tenían el
 * nombre anterior, ninguno o el número (un nombre puesto a mano queda).
 */
export async function applyInboxRenames(accountId: string, renamed: Renamed[]): Promise<number> {
  const db = getDb();
  let n = 0;
  for (const r of renamed) {
    if (!r.phone || !r.after) continue;
    const res = await db
      .prepare(
        `UPDATE inbox_threads SET title = ? WHERE account_id = ? AND kind = 'dm' AND handle = ?
           AND (title = '' OR title = handle OR title = ?) AND title <> ?`,
      )
      .run(r.after.slice(0, 200), accountId, r.phone, r.before, r.after.slice(0, 200));
    n += res.changes;
  }
  return n;
}

/** Chats 1:1 que todavía muestran el número: toman el nombre de la libreta (una sola consulta). */
export async function fillInboxTitles(accountId: string): Promise<number> {
  const name = "CASE WHEN c.saved_name <> '' THEN c.saved_name ELSE c.push_name END";
  const match = `c.app = 'inbox' AND c.account_id = inbox_threads.account_id AND c.phone = inbox_threads.handle AND (c.saved_name <> '' OR c.push_name <> '')`;
  const r = await getDb()
    .prepare(
      `UPDATE inbox_threads SET title = (SELECT ${name} FROM wa_contacts c WHERE ${match} LIMIT 1)
       WHERE account_id = ? AND kind = 'dm' AND handle <> '' AND (title = '' OR title = handle) AND EXISTS (SELECT 1 FROM wa_contacts c WHERE ${match})`,
    )
    .run(accountId);
  return r.changes;
}

/** Guarda en la libreta lo que enseña una tanda de eventos y renombra lo que cambió. */
export async function learnFromEvents(account: Pick<AccountRow, 'id' | 'owner_id'>, events: InboundEvent[]): Promise<void> {
  const items: ContactInput[] = [];
  for (const e of events) {
    if (e.type === 'message') items.push(...contactsFromMessage(e));
    else if (e.type === 'contact') {
      const c = contactInput(e);
      if (c) items.push(c);
    }
  }
  if (!items.length) return;
  const renamed = await rememberContacts(inboxScope(account), items);
  if (renamed.length) await applyInboxRenames(account.id, renamed);
}

/** Contactos de findContacts (importación y repaso diario). */
export async function learnFromHistoryContacts(account: Pick<AccountRow, 'id' | 'owner_id'>, rows: HistoryContact[]): Promise<number> {
  const items = rows.map(contactInput).filter((c): c is ContactInput => !!c);
  if (!items.length) return 0;
  const renamed = await rememberContacts(inboxScope(account), items);
  if (renamed.length) await applyInboxRenames(account.id, renamed);
  return items.length;
}

/**
 * Lo que enseñan los datos de un chat: en un grupo, los participantes (lid ↔
 * teléfono y nombre); en un 1:1, el nombre y la "info" del contacto.
 */
export async function learnFromChatInfo(account: Pick<AccountRow, 'id' | 'owner_id'>, chatId: string, info: ChatInfo): Promise<void> {
  const items: ContactInput[] = [];
  if (isGroupJid(chatId)) {
    for (const p of info.participants ?? []) {
      if (p.lid || p.name) items.push({ phone: p.phone, ...(p.lid ? { lid: p.lid } : {}), ...(p.name ? { push: p.name } : {}) });
    }
    for (const p of info.lidParticipants ?? []) if (p.name) items.push({ lid: p.lid, push: p.name });
  } else {
    const phone = phoneDigits(chatId);
    if (phone) items.push({ phone, ...(info.name ? { push: info.name } : {}), about: info.about ?? '' });
  }
  if (!items.length) return;
  const renamed = await rememberContacts(inboxScope(account), items);
  if (renamed.length) await applyInboxRenames(account.id, renamed);
}

/** Teléfono de quien manda cuando el mensaje solo trajo su lid ('' si no se sabe). */
export async function senderPhoneFor(account: Pick<AccountRow, 'id' | 'owner_id'>, e: { senderPhone: string; senderLid?: string }): Promise<string> {
  if (e.senderPhone || !e.senderLid) return e.senderPhone;
  return phoneForLid(inboxScope(account), e.senderLid);
}

/** A quién son las menciones de una página de mensajes de un chat de WhatsApp. */
export async function inboxMentions(accountId: string, messages: Array<{ body: string; meta?: { mentions?: unknown } | null }>): Promise<MentionMap> {
  const items = messages.filter((m) => m.body && m.body.includes('@')).map((m) => ({ body: m.body, mentions: m.meta?.mentions }));
  if (!items.length) return {};
  return mentionTargets({ app: 'inbox', accountId }, items);
}

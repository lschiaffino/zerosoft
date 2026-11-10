/**
 * Lines: nombres de WhatsApp de un número. Une la libreta de contactos
 * (lib/wa-contacts.ts) con los chats y los miembros de los grupos: aprende
 * de lo que llega (mensajes, contactos, datos de los grupos), renombra los
 * chats 1:1 y los miembros que tenían el nombre anterior, ninguno, el
 * número o el nombre genérico de un lid, y resuelve las menciones de una
 * página de mensajes. Server-only.
 */
import { getDb } from './db';
import { isGroupJid, lidDigits, phoneDigits, type ChatInfo, type HistoryContact, type InboundEvent } from './groups-provider';
import { contactsFromMessage, mentionTargets, rememberContacts, resolveLidSenders, type ContactInput, type ContactScope, type Renamed } from './wa-contacts';
import { mentionCandidates, type MentionMap } from './wa-mentions';

/** Nombres genéricos de un chat que solo tiene lid (lib/groups.ts → lidChatName). */
const LID_NAMES = ['Contacto de WhatsApp', 'WhatsApp contact', 'Contato do WhatsApp'];

export function linesScope(number: { id: string; user_id: string }): ContactScope {
  return { app: 'lines', accountId: number.id, userId: number.user_id };
}

/** Un contacto del servidor (evento o findContacts) → lo que se guarda. Los grupos no son contactos. */
export function linesContactInput(c: { chatId: string; name?: string; saved?: string; lid?: string; phone?: string }): ContactInput | null {
  if (isGroupJid(c.chatId)) return null;
  const phone = c.phone || phoneDigits(c.chatId);
  const lid = c.lid || lidDigits(c.chatId);
  if (!phone && !lid) return null;
  return { ...(phone ? { phone } : {}), ...(lid ? { lid } : {}), ...(c.name ? { push: c.name } : {}), ...(c.saved ? { saved: c.saved } : {}) };
}

/**
 * Renombra chats 1:1 y miembros de quien cambió de nombre: solo donde tenían
 * el nombre anterior, ninguno, el número o el genérico del lid.
 */
export async function applyLinesRenames(numberId: string, renamed: Renamed[]): Promise<number> {
  const db = getDb();
  let n = 0;
  const lidMarks = LID_NAMES.map(() => '?').join(',');
  for (const r of renamed) {
    if (!r.after) continue;
    const name = r.after.slice(0, 200);
    if (r.phone) {
      n += (
        await db
          .prepare(
            `UPDATE groups_chats SET name = ? WHERE number_id = ? AND kind = 'dm' AND phone = ?
               AND (name = '' OR name = phone OR name = ? OR name IN (${lidMarks})) AND name <> ?`,
          )
          .run(name, numberId, r.phone, r.before, ...LID_NAMES, name)
      ).changes;
      n += (
        await db
          .prepare(
            `UPDATE groups_members SET name = ? WHERE phone = ? AND (name = '' OR name = ?) AND name <> ?
               AND chat_id IN (SELECT id FROM groups_chats WHERE number_id = ? AND kind = 'group')`,
          )
          .run(name.slice(0, 120), r.phone, r.before, name.slice(0, 120), numberId)
      ).changes;
    }
    if (r.lid) {
      // El chat 1:1 que todavía es "@lid" (sin teléfono a la vista).
      n += (
        await db
          .prepare(
            `UPDATE groups_chats SET name = ? WHERE number_id = ? AND kind = 'dm' AND provider_chat_id = ?
               AND (name = '' OR name = ? OR name IN (${lidMarks})) AND name <> ?`,
          )
          .run(name, numberId, `${r.lid}@lid`, r.before, ...LID_NAMES, name)
      ).changes;
    }
  }
  return n;
}

/** Chats 1:1 y miembros que todavía muestran el número: toman el nombre de la libreta. */
export async function fillLinesNames(numberId: string): Promise<number> {
  const db = getDb();
  const name = "CASE WHEN c.saved_name <> '' THEN c.saved_name ELSE c.push_name END";
  const known = "(c.saved_name <> '' OR c.push_name <> '')";
  const chatMatch = `c.app = 'lines' AND c.account_id = groups_chats.number_id AND c.phone = groups_chats.phone AND ${known}`;
  const lidMarks = LID_NAMES.map(() => '?').join(',');
  const chats = await db
    .prepare(
      `UPDATE groups_chats SET name = (SELECT ${name} FROM wa_contacts c WHERE ${chatMatch} LIMIT 1)
       WHERE number_id = ? AND kind = 'dm' AND phone <> '' AND (name = '' OR name = phone OR name IN (${lidMarks}))
         AND EXISTS (SELECT 1 FROM wa_contacts c WHERE ${chatMatch})`,
    )
    .run(numberId, ...LID_NAMES);
  const memberMatch = `c.app = 'lines' AND c.account_id = ? AND c.phone = groups_members.phone AND ${known}`;
  const members = await db
    .prepare(
      `UPDATE groups_members SET name = (SELECT ${name} FROM wa_contacts c WHERE ${memberMatch} LIMIT 1)
       WHERE name = '' AND chat_id IN (SELECT id FROM groups_chats WHERE number_id = ? AND kind = 'group')
         AND EXISTS (SELECT 1 FROM wa_contacts c WHERE ${memberMatch})`,
    )
    .run(numberId, numberId, numberId);
  return chats.changes + members.changes;
}

async function remember(number: { id: string; user_id: string }, items: ContactInput[]): Promise<void> {
  if (!items.length) return;
  const renamed = await rememberContacts(linesScope(number), items);
  if (renamed.length) await applyLinesRenames(number.id, renamed);
}

/**
 * Guarda en la libreta lo que enseña una tanda de eventos (nombres de perfil,
 * lid ↔ teléfono) y devuelve los eventos con el teléfono de quien vino solo
 * con su lid, si ya se conoce.
 */
export async function learnLinesEvents<E extends InboundEvent>(number: { id: string; user_id: string }, events: E[]): Promise<E[]> {
  const items: ContactInput[] = [];
  for (const e of events) {
    if (e.type === 'message') items.push(...contactsFromMessage(e));
    else if (e.type === 'contact') {
      const c = linesContactInput(e);
      if (c) items.push(c);
    }
  }
  await remember(number, items).catch(() => null);
  return resolveLidSenders(linesScope(number), events).catch(() => events);
}

/** Contactos de findContacts (importación y repaso diario). */
export async function learnLinesContacts(number: { id: string; user_id: string }, rows: HistoryContact[]): Promise<number> {
  const items = rows.map(linesContactInput).filter((c): c is ContactInput => !!c);
  await remember(number, items);
  return items.length;
}

/** Lo que enseñan los datos de un chat: participantes del grupo (lid, nombre) o nombre e info del contacto. */
export async function learnLinesChatInfo(number: { id: string; user_id: string }, chatId: string, info: ChatInfo): Promise<void> {
  const items: ContactInput[] = [];
  if (isGroupJid(chatId)) {
    for (const p of info.participants ?? []) if (p.lid || p.name) items.push({ phone: p.phone, ...(p.lid ? { lid: p.lid } : {}), ...(p.name ? { push: p.name } : {}) });
    for (const p of info.lidParticipants ?? []) if (p.name) items.push({ lid: p.lid, push: p.name });
  } else {
    const phone = phoneDigits(chatId);
    const lid = lidDigits(chatId);
    if (phone || lid) items.push({ ...(phone ? { phone } : {}), ...(lid ? { lid } : {}), ...(info.name ? { push: info.name } : {}), about: info.about ?? '' });
  }
  await remember(number, items);
}

/** "@<dígitos>" → nombre y teléfono para una página de mensajes de un número; cada mensaje lleva los suyos. */
export async function withLinesMentions<M extends { body: string; meta: Record<string, unknown>; mentionNames?: MentionMap }>(numberId: string, messages: M[]): Promise<void> {
  const items = messages.filter((m) => m.body && m.body.includes('@')).map((m) => ({ body: m.body, mentions: m.meta?.mentions }));
  if (!items.length) return;
  const map = await mentionTargets({ app: 'lines', accountId: numberId }, items);
  if (!Object.keys(map).length) return;
  for (const m of messages) {
    if (!m.body || !m.body.includes('@')) continue;
    const own: MentionMap = {};
    for (const d of mentionCandidates([{ body: m.body, mentions: m.meta?.mentions }])) if (map[d]) own[d] = map[d];
    if (Object.keys(own).length) m.mentionNames = own;
  }
}

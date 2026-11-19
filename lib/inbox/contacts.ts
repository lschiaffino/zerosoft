/**
 * Inbox › Contactos: las personas de los WhatsApp de una persona, cada una
 * una sola vez aunque esté en varias cuentas, en chats 1:1 y en grupos, por
 * teléfono o solo por su lid (lib/wa-people.ts). Por persona: en qué cuentas
 * y en qué grupos está y la fecha de su último mensaje.
 *
 * Los chats son de la persona de la sesión (owner_id, su id real): nunca se
 * mezclan con el workspace ni con otra persona. HubSpot es el del workspace
 * de la sesión (el mismo de Lines, lib/groups-contacts.ts): se lee el vínculo
 * de cada teléfono, y vincular o crear un contacto lo hace quien no es
 * invitado, siempre a mano. Server-only.
 */
import { getDb } from '../db';
import {
  CONTACTS_MAX,
  ROW_GROUPS,
  createPersonHubspot,
  filterPeople,
  linkPersonHubspot,
  peopleHubspot,
  personHubspotMatches,
  unlinkPersonHubspot,
  type ContactHubspot,
  type ContactRowDto,
  type ContactsDto,
  type ContactsQuery,
} from '../groups-contacts';
import type { HubspotSuggestion } from '../groups-hubspot';
import type { GroupsViewer } from '../groups-access';
import { isPersonId, mergePeople, personId, type BookEntry, type Person, type PersonSighting } from '../wa-people';
import { InboxError } from './types';
import { parseThreadInfo } from './wa-meta';

/** El HubSpot de la sesión: workspace, quién y si ve teléfonos y emails. null: sin HubSpot (invitado o sin workspace). */
export interface InboxHubspotScope {
  ws: string;
  me: string;
  mask: boolean;
  /** Quién es en Lines (su acceso por línea y por etiqueta): lo que se escribe en chats de Lines lo respeta. */
  lines: GroupsViewer;
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

interface ThreadLite {
  id: string;
  account_id: string;
  kind: string;
  external_id: string;
  handle: string;
  title: string;
  last_message_at: string | null;
  info: string;
  avatar_url: string;
}

async function collect(owner: string): Promise<{ people: Person[]; threads: Map<string, ThreadLite> }> {
  const db = getDb();
  const accounts = (await db.prepare("SELECT id, address FROM inbox_accounts WHERE owner_id = ? AND kind = 'whatsapp'").all(owner)) as Array<{ id: string; address: string }>;
  if (!accounts.length) return { people: [], threads: new Map() };
  const threads = (await db
    .prepare(
      `SELECT id, account_id, kind, external_id, handle, title, last_message_at, info, avatar_url FROM inbox_threads
       WHERE owner_id = ? AND channel = 'whatsapp' AND account_id IN (${marks(accounts.length)})`,
    )
    .all(owner, ...accounts.map((a) => a.id))) as unknown as ThreadLite[];
  const byId = new Map(threads.map((t) => [t.id, t]));
  // Lo último que mandó cada persona en cada grupo (índice idx_inbox_messages_sender).
  const sent = (await db
    .prepare(
      `SELECT sender_handle, thread_id, MAX(sent_at) AS at FROM inbox_messages
       WHERE owner_id = ? AND from_me = 0 AND sender_handle <> '' GROUP BY sender_handle, thread_id`,
    )
    .all(owner)) as Array<{ sender_handle: string; thread_id: string; at: string }>;
  const lastSent = new Map<string, string>();
  const senders = new Map<string, Set<string>>();
  for (const r of sent) {
    const digits = r.sender_handle.replace(/\D/g, '');
    lastSent.set(`${r.thread_id}\n${digits}`, r.at);
    senders.set(r.thread_id, (senders.get(r.thread_id) ?? new Set()).add(digits));
  }
  const book = (await db
    .prepare(
      `SELECT phone, lid, saved_name AS saved, push_name AS push, picture FROM wa_contacts
       WHERE app = 'inbox' AND user_id = ? AND account_id IN (${marks(accounts.length)}) AND (saved_name <> '' OR push_name <> '' OR (phone <> '' AND lid <> '') OR picture <> '')`,
    )
    .all(owner, ...accounts.map((a) => a.id))) as unknown as BookEntry[];
  const sightings: PersonSighting[] = [];
  for (const t of threads) {
    if (t.kind === 'dm') {
      const lid = t.external_id.endsWith('@lid') ? t.external_id.slice(0, -4) : '';
      sightings.push({ phone: t.handle, lid, accountId: t.account_id, kind: 'dm', chatId: t.id, groupKey: t.id, chatName: t.title, name: t.title, at: t.last_message_at });
    } else if (t.kind === 'group') {
      // Los participantes que dio WhatsApp y, si todavía no los dio, quienes escribieron en el grupo.
      const phones = new Set(parseThreadInfo(t.info).participants.map((p) => p.phone.replace(/\D/g, '')));
      for (const phone of senders.get(t.id) ?? []) phones.add(phone);
      for (const phone of phones) {
        sightings.push({
          phone,
          lid: '',
          accountId: t.account_id,
          kind: 'member',
          chatId: t.id,
          // Un mismo grupo en dos cuentas: el JID lo junta.
          groupKey: t.external_id || t.id,
          chatName: t.title,
          name: '',
          at: lastSent.get(`${t.id}\n${phone}`) ?? null,
        });
      }
    }
  }
  return { people: mergePeople(sightings, book, accounts.map((a) => a.address)), threads: byId };
}

function toRow(owner: string, p: Person, threads: Map<string, ThreadLite>, hubspot: ContactHubspot | null, allGroups = false): ContactRowDto {
  const dm = p.dms.map((d) => threads.get(d.chatId)).find((t) => t?.avatar_url);
  return {
    id: personId(`inbox:${owner}`, p.identity),
    name: p.name,
    phone: p.phone,
    picture: p.picture || (dm ? `/api/inbox/avatar/${dm.id}` : ''),
    lines: p.accountIds,
    groups: (allGroups ? p.groups : p.groups.slice(0, ROW_GROUPS)).map((g) => ({ chatId: g.chatId, name: g.name })),
    groupCount: p.groups.length,
    dms: p.dms.map((d) => ({ chatId: d.chatId, numberId: d.accountId })),
    lastMessageAt: p.lastAt,
    hubspot,
  };
}

const NO_HS = { connected: false, byIdentity: new Map<string, ContactHubspot>() };

async function hubspotFor(scope: InboxHubspotScope | null, people: Person[]) {
  return scope ? peopleHubspot(scope.ws, people, false) : NO_HS;
}

export async function listInboxContacts(owner: string, scope: InboxHubspotScope | null, query: ContactsQuery = {}): Promise<ContactsDto> {
  const { people, threads } = await collect(owner);
  const hs = await hubspotFor(scope, people);
  const matched = filterPeople(people, query, hs, true);
  const hsRow = (p: Person) => (hs.connected ? (hs.byIdentity.get(p.identity) ?? { contact: null, company: null }) : null);
  return { rows: matched.slice(0, CONTACTS_MAX).map((p) => toRow(owner, p, threads, hsRow(p))), truncated: matched.length > CONTACTS_MAX, hubspot: hs.connected };
}

async function findPerson(owner: string, id: string): Promise<{ person: Person; threads: Map<string, ThreadLite> }> {
  if (!isPersonId(id)) throw new InboxError('not_found', 404);
  const { people, threads } = await collect(owner);
  const person = people.find((p) => personId(`inbox:${owner}`, p.identity) === id);
  if (!person) throw new InboxError('not_found', 404);
  return { person, threads };
}

/** La ficha de una persona: la fila con todos sus grupos. */
export async function inboxContact(owner: string, scope: InboxHubspotScope | null, id: string): Promise<{ row: ContactRowDto }> {
  const { person, threads } = await findPerson(owner, id);
  const hs = await hubspotFor(scope, [person]);
  return { row: toRow(owner, person, threads, hs.connected ? (hs.byIdentity.get(person.identity) ?? { contact: null, company: null }) : null, true) };
}

/** La persona de un chat 1:1 de Inbox (para el panel de HubSpot del chat). 404 si no es un chat 1:1 suyo. */
export async function inboxThreadContact(owner: string, scope: InboxHubspotScope | null, threadId: string): Promise<{ row: ContactRowDto }> {
  const { people, threads } = await collect(owner);
  const thread = threads.get(threadId);
  if (!thread || thread.kind !== 'dm') throw new InboxError('not_found', 404);
  const person = people.find((p) => p.dms.some((d) => d.chatId === threadId));
  if (!person) throw new InboxError('not_found', 404);
  const hs = await hubspotFor(scope, [person]);
  return { row: toRow(owner, person, threads, hs.connected ? (hs.byIdentity.get(person.identity) ?? { contact: null, company: null }) : null, true) };
}

export async function inboxContactHubspotMatches(owner: string, scope: InboxHubspotScope, id: string): Promise<HubspotSuggestion[]> {
  const { person } = await findPerson(owner, id);
  return personHubspotMatches(scope.ws, scope.mask, person);
}

/** Vincular, quitar o crear en HubSpot. Devuelve la ficha (y, al crear con un teléfono que ya está, los contactos que hay). */
export async function inboxContactHubspot(
  owner: string,
  scope: InboxHubspotScope,
  id: string,
  action: { kind: 'link'; contactId: string } | { kind: 'unlink' } | { kind: 'create' },
): Promise<{ row: ContactRowDto | null; existing: HubspotSuggestion[] }> {
  const { person } = await findPerson(owner, id);
  // Las copias en los chats de Lines: solo en los de las líneas que esta persona ve.
  if (action.kind === 'link') await linkPersonHubspot(scope.lines, scope.me, person, action.contactId);
  else if (action.kind === 'unlink') await unlinkPersonHubspot(scope.lines, person);
  else {
    const res = await createPersonHubspot(scope.lines, scope.me, person);
    if (!res.created) return { row: null, existing: res.existing };
  }
  return { row: (await inboxContact(owner, scope, id)).row, existing: [] };
}

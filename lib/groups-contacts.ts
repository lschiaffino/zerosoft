/**
 * Lines › Contactos: cada persona una sola vez aunque esté en varias líneas,
 * en chats 1:1 y en grupos, por teléfono o solo por su lid (lib/wa-people.ts).
 * Por persona: en qué líneas y en qué grupos está, la fecha de su último
 * mensaje y su contacto y empresa de HubSpot.
 *
 * Acceso: una persona entra si aparece en algún chat que quien mira puede ver
 * (chatAccessSql: líneas restringidas y acceso por etiqueta), y de ella solo
 * se muestran esas líneas, esos grupos y esos chats. La libreta de la línea
 * solo pone nombres y une lid ↔ teléfono: no suma personas. Con los teléfonos
 * ocultos, el teléfono sale enmascarado y la búsqueda no busca por dígitos.
 *
 * HubSpot: el contacto de una persona es uno para todo el workspace
 * (groups_contact_links, por teléfono o, si no se sabe, por lid) y se copia a
 * sus chats 1:1 de Lines (groups_hubspot_links), donde lo siguen leyendo el
 * panel del chat y las notas. Si una persona no tiene fila propia pero uno de
 * sus chats 1:1 ya tenía contacto, vale ese. Antes de crear un contacto se
 * busca por teléfono (nunca dos contactos con el mismo teléfono), y el nuevo
 * se asocia a la empresa de sus grupos si es una sola (nunca se crea una
 * empresa). Inbox (lib/inbox/contacts.ts) usa las mismas funciones con el
 * HubSpot del workspace de la sesión. Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { GroupsError } from './groups';
import { chatAccessSql, type GroupsViewer } from './groups-access';
import {
  HubspotError,
  createHubspotContact,
  dismissHubspotSuggestion,
  hubspotConn,
  hubspotContactsByPhone,
  hubspotRecordUrl,
  readHubspotRecord,
  redactHubspot,
  type HubspotRecord,
  type HubspotSuggestion,
} from './groups-hubspot';
import { maskPhone } from './groups-mask';
import { isPersonId, mergePeople, personId, personMatches, type BookEntry, type Person, type PersonSighting } from './wa-people';

/** Nombres genéricos de un chat que solo tiene lid (lib/groups.ts → lidChatName). */
const LID_NAMES = ['Contacto de WhatsApp', 'WhatsApp contact', 'Contato do WhatsApp'];
/** Filas que devuelve la lista (las de mensaje más reciente). */
export const CONTACTS_MAX = 2000;
/** Grupos por persona en cada fila (la ficha los trae todos). */
export const ROW_GROUPS = 12;

export interface ContactHubspot {
  contact: { id: string; name: string; url: string; broken: boolean } | null;
  company: { id: string; name: string; url: string } | null;
}

/** Una persona en la lista de Contactos (la misma forma en Lines y en Inbox). */
export interface ContactRowDto {
  id: string;
  name: string;
  /** Dígitos ('' si solo se conoce el lid); enmascarado si quien mira tiene los teléfonos ocultos. */
  phone: string;
  masked?: boolean;
  picture: string;
  /** Líneas (Lines) o cuentas (Inbox) donde aparece, solo las que quien mira ve. */
  lines: string[];
  groups: Array<{ chatId: string; name: string }>;
  groupCount: number;
  /** Chats 1:1 con la persona, uno por línea (el más reciente primero). */
  dms: Array<{ chatId: string; numberId: string }>;
  lastMessageAt: string | null;
  /** null: HubSpot no está conectado. */
  hubspot: ContactHubspot | null;
}

export interface ContactsDto {
  rows: ContactRowDto[];
  /** Hay más personas que CONTACTS_MAX: se muestran las de mensaje más reciente. */
  truncated: boolean;
  /** HubSpot conectado en el workspace. */
  hubspot: boolean;
}

export interface ContactsQuery {
  q?: string;
  /** Solo quienes están en alguna de estas líneas. */
  lines?: string[];
  /** Vinculados o no a un contacto de HubSpot. */
  hubspot?: 'linked' | 'unlinked';
  /** Con chat 1:1 o solo en grupos. */
  chat?: 'dm' | 'groups';
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Lo que identifica a una persona para su vínculo con HubSpot. */
export type PersonKey = Pick<Person, 'phone' | 'lid'>;
/** Lo que hace falta para crear su contacto (sus grupos dan la empresa). */
export type PersonLite = Pick<Person, 'phone' | 'lid' | 'name' | 'groups'>;

interface ChatLite {
  id: string;
  number_id: string;
  kind: 'dm' | 'group';
  phone: string;
  provider_chat_id: string;
  name: string;
  last_message_at: string | null;
  picture_url: string | null;
}

/** Lo que quien mira puede ver: las personas de sus chats, con la libreta de sus líneas. */
async function collect(viewer: GroupsViewer): Promise<{ people: Person[]; chats: Map<string, ChatLite> }> {
  const db = getDb();
  const ws = viewer.ws;
  const access = chatAccessSql(viewer);
  const where = `c.user_id = ? AND c.hidden_at IS NULL${access ? ` AND ${access.sql}` : ''}`;
  const args = [ws, ...(access?.args ?? [])];
  const chats = (await db
    .prepare(
      `SELECT c.id, c.number_id, c.kind, c.phone, c.provider_chat_id, c.name, c.last_message_at, c.picture_url FROM groups_chats c
       WHERE ${where} AND (c.kind = 'dm' OR c.left_at IS NULL)`,
    )
    .all(...args)) as unknown as ChatLite[];
  const byId = new Map(chats.map((c) => [c.id, c]));
  const members = (await db
    .prepare(
      `SELECT m.chat_id, m.phone, m.name FROM groups_members m JOIN groups_chats c ON c.id = m.chat_id
       WHERE ${where} AND c.kind = 'group' AND c.left_at IS NULL`,
    )
    .all(...args)) as Array<{ chat_id: string; phone: string; name: string }>;
  // Lo último que mandó cada persona en cada grupo (índice idx_groups_messages_sender).
  const sent = (await db
    .prepare(
      `SELECT sender_phone, chat_id, MAX(created_at) AS at FROM groups_messages
       WHERE user_id = ? AND direction = 'in' AND sender_phone <> '' GROUP BY sender_phone, chat_id`,
    )
    .all(ws)) as Array<{ sender_phone: string; chat_id: string; at: string }>;
  const lastSent = new Map<string, string>();
  for (const r of sent) if (byId.has(r.chat_id)) lastSent.set(`${r.chat_id}\n${r.sender_phone}`, r.at);
  const numbers = [...new Set(chats.map((c) => c.number_id))];
  const book = numbers.length
    ? ((await db
        .prepare(
          `SELECT phone, lid, saved_name AS saved, push_name AS push, picture FROM wa_contacts
           WHERE app = 'lines' AND user_id = ? AND account_id IN (${marks(numbers.length)}) AND (saved_name <> '' OR push_name <> '' OR (phone <> '' AND lid <> '') OR picture <> '')`,
        )
        .all(ws, ...numbers)) as unknown as BookEntry[])
    : [];
  const own = (await db.prepare("SELECT phone FROM groups_numbers WHERE user_id = ? AND phone <> ''").all(ws)) as Array<{ phone: string }>;
  const sightings: PersonSighting[] = [];
  for (const c of chats) {
    if (c.kind !== 'dm') continue;
    const lid = c.provider_chat_id.endsWith('@lid') ? c.provider_chat_id.slice(0, -4) : '';
    sightings.push({ phone: c.phone, lid, accountId: c.number_id, kind: 'dm', chatId: c.id, groupKey: c.id, chatName: c.name, name: c.name, at: c.last_message_at });
  }
  for (const m of members) {
    const c = byId.get(m.chat_id);
    if (!c) continue;
    sightings.push({
      phone: m.phone,
      lid: '',
      accountId: c.number_id,
      kind: 'member',
      chatId: c.id,
      groupKey: c.provider_chat_id || c.id,
      chatName: c.name,
      name: m.name,
      at: lastSent.get(`${c.id}\n${m.phone}`) ?? null,
    });
  }
  return { people: mergePeople(sightings, book, own.map((r) => r.phone), LID_NAMES), chats: byId };
}

interface LinkRow {
  id: string;
  phone: string;
  lid: string;
  contact_id: string;
  contact_name: string;
  email: string;
  company_id: string;
  company_name: string;
  missing: number;
}

/**
 * El contacto y la empresa de HubSpot de cada persona (identidad → vínculo).
 * `linesDms`: los chats 1:1 de las personas son de Lines y su vínculo viejo
 * (groups_hubspot_links) vale si la persona no tiene uno propio.
 */
export async function peopleHubspot(ws: string, people: Person[], linesDms: boolean): Promise<{ connected: boolean; byIdentity: Map<string, ContactHubspot> }> {
  const out = new Map<string, ContactHubspot>();
  const conn = await hubspotConn(ws).catch(() => null);
  if (!conn) return { connected: false, byIdentity: out };
  const db = getDb();
  const own = (await db.prepare('SELECT * FROM groups_contact_links WHERE user_id = ?').all(ws)) as unknown as LinkRow[];
  const byPhone = new Map(own.filter((r) => r.phone).map((r) => [r.phone, r]));
  const byLid = new Map(own.filter((r) => r.lid).map((r) => [r.lid, r]));
  const chatLinks = new Map<string, { contact?: { object_id: string; name: string; props: string; missing: number }; company?: { object_id: string; name: string } }>();
  const dmIds = linesDms ? people.flatMap((p) => p.dms.map((d) => d.chatId)) : [];
  for (let i = 0; i < dmIds.length; i += 400) {
    const chunk = dmIds.slice(i, i + 400);
    const rows = (await db
      .prepare(
        `SELECT chat_id, object_type, object_id, name, props, missing FROM groups_hubspot_links
         WHERE user_id = ? AND object_type IN ('contact', 'company') AND chat_id IN (${marks(chunk.length)})`,
      )
      .all(ws, ...chunk)) as Array<{ chat_id: string; object_type: string; object_id: string; name: string; props: string; missing: number }>;
    for (const r of rows) {
      const e = chatLinks.get(r.chat_id) ?? {};
      if (r.object_type === 'contact') e.contact = r;
      else e.company = r;
      chatLinks.set(r.chat_id, e);
    }
  }
  const url = (type: 'contact' | 'company', id: string) => hubspotRecordUrl(conn, type, id);
  for (const p of people) {
    const row = (p.phone && byPhone.get(p.phone)) || (p.lid && byLid.get(p.lid)) || null;
    let contact: ContactHubspot['contact'] = null;
    let company: ContactHubspot['company'] = null;
    if (row) {
      contact = { id: row.contact_id, name: row.contact_name || row.contact_id, url: url('contact', row.contact_id), broken: row.missing === 1 };
      if (row.company_id) company = { id: row.company_id, name: row.company_name || row.company_id, url: url('company', row.company_id) };
    } else {
      for (const d of p.dms) {
        const l = chatLinks.get(d.chatId);
        if (!l) continue;
        if (!contact && l.contact) contact = { id: l.contact.object_id, name: l.contact.name || l.contact.object_id, url: url('contact', l.contact.object_id), broken: l.contact.missing === 1 };
        if (!company && l.company) company = { id: l.company.object_id, name: l.company.name || l.company.object_id, url: url('company', l.company.object_id) };
        if (!company && l.contact) {
          // La empresa principal del contacto, como la guardó el vínculo.
          const props = parseProps(l.contact.props);
          if (props.companyId) company = { id: props.companyId, name: props.company || props.companyId, url: url('company', props.companyId) };
        }
      }
    }
    if (contact || company) out.set(p.identity, { contact, company });
  }
  return { connected: true, byIdentity: out };
}

function parseProps(raw: string): { companyId?: string; company?: string } {
  try {
    const v = JSON.parse(raw) as { companyId?: unknown; company?: unknown };
    return {
      ...(typeof v.companyId === 'string' && /^\d{1,20}$/.test(v.companyId) ? { companyId: v.companyId } : {}),
      ...(typeof v.company === 'string' ? { company: v.company } : {}),
    };
  } catch {
    return {};
  }
}

/** Filtros comunes de Lines e Inbox. */
export function filterPeople(people: Person[], query: ContactsQuery, hs: { connected: boolean; byIdentity: Map<string, ContactHubspot> }, canSeePhone: boolean): Person[] {
  const lines = new Set((query.lines ?? []).filter(Boolean));
  const q = (query.q ?? '').slice(0, 200);
  return people.filter((p) => {
    if (lines.size && !p.accountIds.some((a) => lines.has(a))) return false;
    if (query.chat === 'dm' && p.dms.length === 0) return false;
    if (query.chat === 'groups' && p.groups.length === 0) return false;
    if (query.hubspot && hs.connected) {
      const linked = Boolean(hs.byIdentity.get(p.identity)?.contact);
      if (query.hubspot === 'linked' ? !linked : linked) return false;
    }
    return personMatches(p, q, canSeePhone);
  });
}

function toRow(viewer: GroupsViewer, p: Person, hubspot: ContactHubspot | null, chats: Map<string, ChatLite>, allGroups = false): ContactRowDto {
  const dms = p.dms.filter((d) => chats.has(d.chatId));
  return {
    id: personId(viewer.ws, p.identity),
    name: p.name,
    phone: p.phone ? (viewer.mask ? maskPhone(p.phone) : p.phone) : '',
    ...(viewer.mask && p.phone ? { masked: true } : {}),
    picture: p.picture || dms.map((d) => chats.get(d.chatId)?.picture_url ?? '').find(Boolean) || '',
    lines: p.accountIds,
    groups: (allGroups ? p.groups : p.groups.slice(0, ROW_GROUPS)).map((g) => ({ chatId: g.chatId, name: g.name })),
    groupCount: p.groups.length,
    dms: dms.map((d) => ({ chatId: d.chatId, numberId: d.accountId })),
    lastMessageAt: p.lastAt,
    hubspot,
  };
}

const hsRow = (hs: { connected: boolean; byIdentity: Map<string, ContactHubspot> }, p: Person): ContactHubspot | null =>
  hs.connected ? (hs.byIdentity.get(p.identity) ?? { contact: null, company: null }) : null;

export async function listLinesContacts(viewer: GroupsViewer, query: ContactsQuery = {}): Promise<ContactsDto> {
  const { people, chats } = await collect(viewer);
  const hs = await peopleHubspot(viewer.ws, people, true);
  const matched = filterPeople(people, query, hs, !viewer.mask);
  return {
    rows: matched.slice(0, CONTACTS_MAX).map((p) => toRow(viewer, p, hsRow(hs, p), chats)),
    truncated: matched.length > CONTACTS_MAX,
    hubspot: hs.connected,
  };
}

/** Una persona que quien mira puede ver, por su id opaco (404 si no). */
async function findPerson(viewer: GroupsViewer, id: string): Promise<{ person: Person; chats: Map<string, ChatLite> }> {
  if (!isPersonId(id)) throw new GroupsError('not_found', 404);
  const { people, chats } = await collect(viewer);
  const person = people.find((p) => personId(viewer.ws, p.identity) === id);
  if (!person) throw new GroupsError('not_found', 404);
  return { person, chats };
}

/** La ficha: la fila completa (todos sus grupos). */
export async function linesContact(viewer: GroupsViewer, id: string): Promise<{ row: ContactRowDto }> {
  const { person, chats } = await findPerson(viewer, id);
  const hs = await peopleHubspot(viewer.ws, [person], true);
  return { row: toRow(viewer, person, hsRow(hs, person), chats, true) };
}

/** "Mensaje" desde la ficha: el chat 1:1 más reciente, o uno nuevo en la línea donde más aparece. */
export async function contactMessageTarget(viewer: GroupsViewer, id: string, numberId?: string): Promise<{ chatId: string } | { numberId: string; phone: string }> {
  const { person, chats } = await findPerson(viewer, id);
  const dms = person.dms.filter((d) => chats.has(d.chatId) && (!numberId || d.accountId === numberId));
  if (dms.length) return { chatId: dms[0].chatId };
  if (!person.phone) throw new GroupsError('invalid_phone');
  const line = numberId && person.accountIds.includes(numberId) ? numberId : person.accountIds[0];
  if (!line) throw new GroupsError('not_found', 404);
  return { numberId: line, phone: person.phone };
}

// ======================================================================
// HubSpot (lo usan Lines e Inbox)
// ======================================================================

/** Contactos de HubSpot con el teléfono de la persona (para vincular sin duplicar). */
export async function personHubspotMatches(ws: string, mask: boolean, person: Person): Promise<HubspotSuggestion[]> {
  if (!person.phone) return [];
  const list = await hubspotContactsByPhone(ws, person.phone);
  return list.map((s) => ({ contact: redactHubspot(mask, s.contact), company: s.company }));
}

/** Los chats 1:1 de Lines de la persona en todo el workspace (por teléfono o por su lid). */
async function personDmIds(ws: string, p: PersonKey): Promise<string[]> {
  const ids = [...(p.phone ? [`${p.phone}@s.whatsapp.net`, `${p.phone}@c.us`] : []), ...(p.lid ? [`${p.lid}@lid`] : [])];
  if (!ids.length) return [];
  const rows = (await getDb()
    .prepare(`SELECT id FROM groups_chats WHERE user_id = ? AND kind = 'dm' AND (phone = ? OR provider_chat_id IN (${marks(ids.length)}))`)
    .all(ws, p.phone || '\u0000', ...ids)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function saveContactLink(ws: string, actor: string | null, p: PersonKey, contact: HubspotRecord, company: HubspotRecord | null): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = (await db
    .prepare("SELECT id FROM groups_contact_links WHERE user_id = ? AND ((phone <> '' AND phone = ?) OR (lid <> '' AND lid = ?)) LIMIT 1")
    .get(ws, p.phone, p.lid)) as { id: string } | undefined;
  const values = [contact.id, contact.name.slice(0, 300), contact.email ?? '', company?.id ?? '', (company?.name ?? '').slice(0, 300), actor, now];
  if (existing) {
    await db
      .prepare(
        'UPDATE groups_contact_links SET contact_id = ?, contact_name = ?, email = ?, company_id = ?, company_name = ?, missing = 0, linked_by = ?, updated_at = ?, phone = ?, lid = ? WHERE id = ?',
      )
      .run(...values, p.phone, p.lid, existing.id);
  } else {
    // Dos pedidos a la vez para la misma persona: el índice único deja uno solo y el otro actualiza.
    await db
      .prepare(
        `INSERT INTO groups_contact_links (id, user_id, phone, lid, contact_id, contact_name, email, company_id, company_name, missing, linked_by, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(randomUUID(), ws, p.phone, p.lid, ...values, now);
  }
  // Copia en los chats 1:1 de Lines (el panel del chat y las notas los leen ahí). Un chat con otro contacto elegido a mano queda como está.
  const props = (rec: HubspotRecord) => {
    const o: Partial<HubspotRecord> = { ...rec };
    for (const k of ['type', 'id', 'name', 'url', 'missing'] as const) delete o[k];
    return JSON.stringify(o);
  };
  for (const chatId of await personDmIds(ws, p)) {
    for (const rec of [contact, company]) {
      if (!rec) continue;
      await db
        .prepare(
          `INSERT INTO groups_hubspot_links (chat_id, user_id, object_type, object_id, name, props, fetched_at, missing, linked_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(chat_id, object_type) DO UPDATE SET name = excluded.name, props = excluded.props, fetched_at = excluded.fetched_at, missing = 0
           WHERE groups_hubspot_links.object_id = excluded.object_id`,
        )
        .run(chatId, ws, rec.type, rec.id, rec.name.slice(0, 300), props(rec), now, actor, now);
    }
  }
}

/** Vincula la persona a un contacto de HubSpot (y a su empresa principal). */
export async function linkPersonHubspot(ws: string, actor: string, person: PersonKey, contactId: string): Promise<void> {
  if (!/^\d{1,20}$/.test(contactId)) throw new HubspotError('invalid_input');
  const contact = await readHubspotRecord(ws, 'contact', contactId);
  let company: HubspotRecord | null = null;
  if (contact.companyId) company = await readHubspotRecord(ws, 'company', contact.companyId).catch(() => null);
  await saveContactLink(ws, actor, person, contact, company);
}

/** Quita el vínculo de la persona (y la copia en sus chats 1:1 de Lines que tenían ese mismo contacto). */
export async function unlinkPersonHubspot(ws: string, person: PersonKey): Promise<void> {
  const db = getDb();
  const row = (await db
    .prepare("SELECT contact_id FROM groups_contact_links WHERE user_id = ? AND ((phone <> '' AND phone = ?) OR (lid <> '' AND lid = ?)) LIMIT 1")
    .get(ws, person.phone, person.lid)) as { contact_id: string } | undefined;
  const dmIds = await personDmIds(ws, person);
  const linked = row?.contact_id
    ? row.contact_id
    : dmIds.length
      ? (((await db
          .prepare(`SELECT object_id FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'contact' AND chat_id IN (${marks(dmIds.length)}) LIMIT 1`)
          .get(ws, ...dmIds)) as { object_id: string } | undefined)?.object_id ?? '')
      : '';
  await db.prepare("DELETE FROM groups_contact_links WHERE user_id = ? AND ((phone <> '' AND phone = ?) OR (lid <> '' AND lid = ?))").run(ws, person.phone, person.lid);
  if (linked && dmIds.length) {
    await db
      .prepare(`DELETE FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'contact' AND object_id = ? AND chat_id IN (${marks(dmIds.length)})`)
      .run(ws, linked, ...dmIds);
    // "Este no es": el chat no vuelve a proponerlo ni a vincularlo solo.
    for (const chatId of dmIds) await dismissHubspotSuggestion(ws, chatId);
  }
}

/** La empresa de HubSpot de los grupos de la persona, si es una sola ('' si no hay o hay varias). */
async function groupsCompany(ws: string, person: PersonLite): Promise<string> {
  const jids = person.groups.map((g) => g.key).filter((k) => k.endsWith('@g.us'));
  const db = getDb();
  if (jids.length) {
    const rows = (await db
      .prepare(`SELECT DISTINCT company_id FROM groups_identities WHERE user_id = ? AND company_id <> '' AND jid IN (${marks(jids.length)})`)
      .all(ws, ...jids)) as Array<{ company_id: string }>;
    return rows.length === 1 ? rows[0].company_id : '';
  }
  // Sin sus grupos a mano (un chat que recién entra): los grupos de Lines del workspace donde está su teléfono.
  if (!person.phone) return '';
  const rows = (await db
    .prepare(
      `SELECT DISTINCT i.company_id FROM groups_members m JOIN groups_chats c ON c.id = m.chat_id
       JOIN groups_identities i ON i.user_id = c.user_id AND i.jid = c.provider_chat_id
       WHERE c.user_id = ? AND c.kind = 'group' AND c.left_at IS NULL AND m.phone = ? AND i.company_id <> '' LIMIT 2`,
    )
    .all(ws, person.phone)) as Array<{ company_id: string }>;
  return rows.length === 1 ? rows[0].company_id : '';
}

/** ¿La persona ya tiene contacto de HubSpot en el workspace (por teléfono o lid)? */
export async function personHasHubspotLink(ws: string, person: PersonKey): Promise<boolean> {
  const row = await getDb()
    .prepare("SELECT 1 AS x FROM groups_contact_links WHERE user_id = ? AND ((phone <> '' AND phone = ?) OR (lid <> '' AND lid = ?)) LIMIT 1")
    .get(ws, person.phone, person.lid);
  return Boolean(row);
}

/**
 * "Crear en HubSpot": busca por teléfono primero; si ya hay contactos con ese
 * teléfono no crea nada y los devuelve para elegir. Si no, lo crea (asociado a
 * la empresa de sus grupos si es una sola) y lo vincula. `actor` null: lo creó
 * el alta automática (lib/hubspot-auto-contacts.ts).
 */
export async function createPersonHubspot(ws: string, actor: string | null, mask: boolean, person: PersonLite): Promise<{ created: boolean; existing: HubspotSuggestion[] }> {
  if (!person.phone) throw new GroupsError('invalid_phone');
  const companyId = await groupsCompany(ws, person);
  const res = await createHubspotContact(ws, { name: person.name, phone: person.phone, companyId });
  if (!res.created) return { created: false, existing: res.existing.map((s) => ({ contact: redactHubspot(mask, s.contact), company: s.company })) };
  const company = res.created.companyId ? await readHubspotRecord(ws, 'company', res.created.companyId).catch(() => null) : null;
  await saveContactLink(ws, actor, person, res.created, company);
  return { created: true, existing: [] };
}

// Lines: las mismas acciones sobre una persona que quien mira ve.

export async function contactHubspotMatches(viewer: GroupsViewer, id: string): Promise<HubspotSuggestion[]> {
  const { person } = await findPerson(viewer, id);
  return personHubspotMatches(viewer.ws, viewer.mask, person);
}

export async function linkContactHubspot(viewer: GroupsViewer, actor: string, id: string, contactId: string): Promise<ContactRowDto> {
  const { person } = await findPerson(viewer, id);
  await linkPersonHubspot(viewer.ws, actor, person, contactId);
  return (await linesContact(viewer, id)).row;
}

export async function unlinkContactHubspot(viewer: GroupsViewer, id: string): Promise<ContactRowDto> {
  const { person } = await findPerson(viewer, id);
  await unlinkPersonHubspot(viewer.ws, person);
  return (await linesContact(viewer, id)).row;
}

export async function createContactHubspot(viewer: GroupsViewer, actor: string, id: string): Promise<{ row: ContactRowDto | null; existing: HubspotSuggestion[] }> {
  const { person } = await findPerson(viewer, id);
  const res = await createPersonHubspot(viewer.ws, actor, viewer.mask, person);
  return { row: res.created ? (await linesContact(viewer, id)).row : null, existing: res.existing };
}

/**
 * La persona de un chat 1:1 que quien mira ve (la ficha, para el panel de
 * HubSpot del chat). 404 si el chat no es 1:1 o no lo ve.
 */
export async function chatContact(viewer: GroupsViewer, chatId: string): Promise<{ row: ContactRowDto }> {
  const { people, chats } = await collect(viewer);
  const chat = chats.get(chatId);
  if (!chat || chat.kind !== 'dm') throw new GroupsError('not_found', 404);
  const person = people.find((p) => p.dms.some((d) => d.chatId === chatId));
  if (!person) throw new GroupsError('not_found', 404);
  const hs = await peopleHubspot(viewer.ws, [person], true);
  return { row: toRow(viewer, person, hsRow(hs, person), chats, true) };
}

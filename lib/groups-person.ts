/**
 * Lines: la ficha de una persona de un grupo (al tocar la foto o el nombre de
 * quien escribió, o a un miembro de la lista), como "Info del contacto" de
 * WhatsApp, y lo compartido en un chat 1:1 (fotos, documentos, links y
 * destacados) para esa ficha. La persona se pide por teléfono o por un
 * mensaje suyo del grupo: quien mira con los teléfonos ocultos nunca recibe
 * el número. Server-only.
 */
import { getDb } from './db';
import { phoneDigits } from './groups-provider';
import { GroupsError, getMessageRow, type ChatRow, type NumberRow } from './groups';
import { canSeeChat, maskPhone, type GroupsViewer } from './groups-access';
import { displayName, lookupContacts, type ContactRow } from './wa-contacts';
import type { PersonRole, WaPersonCard } from './wa-person';

/** El teléfono de la persona: el pedido o el de quien mandó el mensaje (del mismo grupo). */
export async function personPhone(ws: string, groupId: string, input: { phone?: string | null; messageId?: string | null; card?: number | null }): Promise<string> {
  // Una tarjeta de contacto (vCard) de un mensaje del chat (de quien sea): su primer teléfono (el de WhatsApp).
  if (input.messageId && typeof input.card === 'number') {
    const m = await getMessageRow(ws, input.messageId);
    if (!m || m.chat_id !== groupId) throw new GroupsError('not_found', 404);
    let cards: Array<{ phones?: unknown }> = [];
    try {
      const meta = JSON.parse(m.meta || '{}') as { contacts?: Array<{ phones?: unknown }> };
      cards = Array.isArray(meta.contacts) ? meta.contacts : [];
    } catch {
      cards = [];
    }
    const phones = cards[input.card]?.phones;
    const phone = phoneDigits(Array.isArray(phones) ? String(phones[0] ?? '') : '');
    if (!/^\d{8,15}$/.test(phone)) throw new GroupsError('not_found', 404);
    return phone;
  }
  if (input.messageId) {
    const m = await getMessageRow(ws, input.messageId);
    if (!m || m.chat_id !== groupId || m.direction !== 'in') throw new GroupsError('not_found', 404);
    const phone = phoneDigits(m.sender_phone);
    if (!phone) throw new GroupsError('not_found', 404);
    return phone;
  }
  const phone = phoneDigits(input.phone ?? '');
  if (!/^\d{8,15}$/.test(phone)) throw new GroupsError('invalid_phone');
  return phone;
}

/** El chat 1:1 de la línea con ese teléfono (por teléfono o por su lid). */
async function dmFor(numberId: string, phone: string, contact: ContactRow | undefined): Promise<ChatRow | null> {
  const ids = [`${phone}@s.whatsapp.net`, `${phone}@c.us`, phone, ...(contact?.lid ? [`${contact.lid}@lid`] : [])];
  const row = (await getDb()
    .prepare(
      `SELECT * FROM groups_chats WHERE number_id = ? AND kind = 'dm' AND (phone = ? OR provider_chat_id IN (${ids.map(() => '?').join(',')}))
       ORDER BY (last_message_at IS NULL), last_message_at DESC LIMIT 1`,
    )
    .get(numberId, phone, ...ids)) as ChatRow | undefined;
  return row ?? null;
}

export async function personCard(viewer: GroupsViewer, groupId: string, phone: string): Promise<WaPersonCard & { masked?: boolean }> {
  const db = getDb();
  const ws = viewer.ws;
  const group = (await db.prepare("SELECT * FROM groups_chats WHERE id = ? AND user_id = ? AND kind = 'group'").get(groupId, ws)) as ChatRow | undefined;
  if (!group) throw new GroupsError('not_found', 404);
  const number = (await db.prepare('SELECT * FROM groups_numbers WHERE id = ? AND user_id = ?').get(group.number_id, ws)) as NumberRow | undefined;
  if (!number) throw new GroupsError('not_found', 404);
  const member = (await db.prepare('SELECT name, role FROM groups_members WHERE chat_id = ? AND phone = ?').get(group.id, phone)) as
    | { name: string; role: PersonRole }
    | undefined;
  const contact = (await lookupContacts({ app: 'lines', accountId: number.id }, [phone]).catch(() => new Map<string, ContactRow>())).get(phone);
  const found = await dmFor(number.id, phone, contact);
  // Un chat 1:1 que esta persona no ve no se muestra (ni su contenido).
  const dm = found && (await canSeeChat(viewer, found.id)) ? found : null;
  const sent = (await db
    .prepare("SELECT sender_name FROM groups_messages WHERE chat_id = ? AND direction = 'in' AND sender_phone = ? AND sender_name <> '' ORDER BY created_at DESC LIMIT 1")
    .get(group.id, phone)) as { sender_name: string } | undefined;
  const counts = dm
    ? ((await db
        .prepare(
          `SELECT
             SUM(CASE WHEN deleted_at IS NULL AND (media_type LIKE 'image/%' OR media_type LIKE 'video/%') AND COALESCE(json_extract(CASE WHEN json_valid(meta) THEN meta END, '$.media.kind'), '') <> 'sticker' THEN 1 ELSE 0 END) AS media,
             SUM(CASE WHEN deleted_at IS NULL AND media_type <> '' AND media_type NOT LIKE 'image/%' AND media_type NOT LIKE 'video/%' AND media_type NOT LIKE 'audio/%' THEN 1 ELSE 0 END) AS docs,
             SUM(CASE WHEN deleted_at IS NULL AND (body LIKE '%http://%' OR body LIKE '%https://%') THEN 1 ELSE 0 END) AS links,
             SUM(CASE WHEN json_valid(meta) AND json_extract(meta, '$.starred') = 1 THEN 1 ELSE 0 END) AS starred
           FROM groups_messages WHERE chat_id = ? AND user_id = ? AND direction IN ('in', 'out')`,
        )
        .get(dm.id, ws)) as { media: number | null; docs: number | null; links: number | null; starred: number | null } | undefined)
    : undefined;
  // Grupos en común: los otros grupos de la línea donde está (y que esta persona ve).
  const common = (await db
    .prepare(
      `SELECT c.id, c.name, c.picture_url FROM groups_members m JOIN groups_chats c ON c.id = m.chat_id
       WHERE c.number_id = ? AND c.user_id = ? AND c.kind = 'group' AND c.left_at IS NULL AND m.phone = ? AND c.id <> ?
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 30`,
    )
    .all(number.id, ws, phone, group.id)) as Array<{ id: string; name: string; picture_url: string | null }>;
  const visible = [];
  for (const g of common) if (await canSeeChat(viewer, g.id)) visible.push({ id: g.id, name: g.name, picture: g.picture_url ?? '' });
  const me = !!number.phone && number.phone === phone;
  const name = me ? number.name : member?.name || (dm?.name && dm.name !== phone ? dm.name : '') || displayName(contact) || sent?.sender_name || '';
  return {
    phone: viewer.mask ? maskPhone(phone) : phone,
    ...(viewer.mask ? { masked: true } : {}),
    name,
    about: contact?.about ?? '',
    picture: contact?.picture || dm?.picture_url || '',
    role: member?.role ?? null,
    me,
    dm: dm ? { id: dm.id, muted: Boolean(dm.muted_until && dm.muted_until > new Date().toISOString()), blocked: false } : null,
    shared: { media: Number(counts?.media ?? 0), docs: Number(counts?.docs ?? 0), links: Number(counts?.links ?? 0), starred: Number(counts?.starred ?? 0) },
    commonGroups: visible,
    // Lines todavía no bloquea contactos.
    canBlock: false,
  };
}

export type SharedKind = 'media' | 'docs' | 'links' | 'starred';

export interface SharedItem {
  id: string;
  kind: SharedKind;
  url: string;
  mime: string;
  name: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
  senderName: string;
  urls?: string[];
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

/** Lo compartido en un chat (fotos y videos, documentos, links o destacados), lo más nuevo primero. */
export async function sharedContent(viewer: GroupsViewer, chatId: string, kind: SharedKind): Promise<SharedItem[]> {
  if (!(await canSeeChat(viewer, chatId))) throw new GroupsError('not_found', 404);
  const where =
    kind === 'media'
      ? "deleted_at IS NULL AND (media_type LIKE 'image/%' OR media_type LIKE 'video/%') AND COALESCE(json_extract(CASE WHEN json_valid(meta) THEN meta END, '$.media.kind'), '') <> 'sticker'"
      : kind === 'docs'
        ? "deleted_at IS NULL AND media_type <> '' AND media_type NOT LIKE 'image/%' AND media_type NOT LIKE 'video/%' AND media_type NOT LIKE 'audio/%'"
        : kind === 'links'
          ? "deleted_at IS NULL AND (body LIKE '%http://%' OR body LIKE '%https://%')"
          : "json_valid(meta) AND json_extract(meta, '$.starred') = 1";
  const rows = (await getDb()
    .prepare(
      `SELECT id, direction, body, media_url, media_type, media_name, sender_name, created_at FROM groups_messages
       WHERE chat_id = ? AND user_id = ? AND direction IN ('in', 'out') AND ${where} ORDER BY created_at DESC LIMIT 120`,
    )
    .all(chatId, viewer.ws)) as Array<{ id: string; direction: string; body: string; media_url: string; media_type: string; media_name: string; sender_name: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    kind,
    url: !r.media_url ? '' : /^(meta|bridge|evo):/.test(r.media_url) ? `/api/groups/media/${r.id}` : r.media_url,
    mime: r.media_type,
    name: r.media_name,
    body: r.body.slice(0, 500),
    sentAt: r.created_at,
    fromMe: r.direction === 'out',
    senderName: r.sender_name,
    ...(kind === 'links' ? { urls: [...new Set(r.body.match(URL_RE) ?? [])].map((u) => u.replace(/[).,;:!?]+$/, '')).slice(0, 5) } : {}),
  }));
}

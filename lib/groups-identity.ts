/**
 * Lines: un grupo de WhatsApp es uno solo aunque esté en varias líneas.
 *
 * Cada línea (número) que está en un grupo tiene su propio chat en
 * groups_chats. La identidad del grupo es el workspace + el JID del grupo
 * ("1203…@g.us", groups_chats.provider_chat_id) y vive en groups_identities
 * (lib/schema/group-identity-migration.ts). Ahí va lo que es del grupo y no de
 * una línea: su empresa de HubSpot, una sola por grupo.
 *
 * Los vínculos por chat (groups_hubspot_links, object_type 'company') son una
 * copia de esa empresa en cada línea del grupo, para lo que ya los lee (la
 * bandeja, sus filtros, las notas en HubSpot). Vincular o desvincular desde
 * cualquier línea cambia la identidad y todas las copias. Una línea que entra
 * después a un grupo ya vinculado hereda la empresa.
 *
 * Pensado para lo que sigue (contactos): los miembros de un grupo son la
 * unión de groups_members de sus chats, y una base de contactos se asocia a
 * la empresa de la identidad, no a un chat.
 */
import { getDb } from './db';

// ======================================================================
// Puro: juntar los chats de un mismo grupo (sin base de datos)
// ======================================================================

export interface IdentityLabel {
  id: string;
  name: string;
  color: string;
}

/** Lo que hace falta de cada chat para armar la fila del grupo. */
export interface IdentityChat {
  id: string;
  /** JID del grupo (provider_chat_id). Vacío: el chat queda solo. */
  jid: string;
  numberId: string;
  /** Cumple los filtros (los que no, solo suman sus líneas a un grupo que sí). */
  matched: boolean;
  name: string;
  memberCount: number;
  status: 'open' | 'closed';
  leftAt: string | null;
  flagged: boolean;
  archived: boolean;
  labels: IdentityLabel[];
  properties: Record<string, unknown>;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface MergedGroup {
  /** El JID (o el id del chat si no tiene). */
  key: string;
  /** El chat que se abre: el que cumple los filtros con actividad más reciente. */
  chatId: string;
  chatIds: string[];
  /** Una por línea, la del chat principal primero. */
  lines: Array<{ numberId: string; chatId: string }>;
  name: string;
  memberCount: number;
  /** Abierto si alguno de los chats que cumplen los filtros lo está. */
  status: 'open' | 'closed';
  /** Solo si salieron todas las líneas (si queda una, el grupo se sigue usando). */
  leftAt: string | null;
  flagged: boolean;
  archived: boolean;
  labels: IdentityLabel[];
  /** Por propiedad, el valor del chat principal o, si no tiene, el del más activo que lo tenga. */
  properties: Record<string, unknown>;
  lastActivity: string;
  createdAt: string;
}

const activity = (c: Pick<IdentityChat, 'lastMessageAt' | 'createdAt'>) => c.lastMessageAt ?? c.createdAt;
const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Más reciente primero; a igual actividad, por id (estable). */
function byActivity(a: IdentityChat, b: IdentityChat): number {
  const x = activity(a);
  const y = activity(b);
  return x === y ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : x < y ? 1 : -1;
}

/**
 * Una fila por grupo: junta los chats con el mismo JID. Entra un grupo si
 * alguno de sus chats cumple los filtros. El orden de salida es el de la
 * actividad más reciente.
 */
export function mergeGroupChats(chats: IdentityChat[]): MergedGroup[] {
  const byKey = new Map<string, IdentityChat[]>();
  const seen = new Set<string>();
  for (const c of chats) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const key = c.jid || `chat:${c.id}`;
    const list = byKey.get(key);
    if (list) list.push(c);
    else byKey.set(key, [c]);
  }
  const out: MergedGroup[] = [];
  for (const [key, list] of byKey) {
    const matched = list.filter((c) => c.matched).sort(byActivity);
    if (matched.length === 0) continue;
    const primary = matched[0];
    const rest = list.filter((c) => c.id !== primary.id).sort(byActivity);
    const ordered = [primary, ...rest];
    const lines: MergedGroup['lines'] = [];
    for (const c of ordered) if (!lines.some((l) => l.numberId === c.numberId)) lines.push({ numberId: c.numberId, chatId: c.id });
    const labels = new Map<string, IdentityLabel>();
    for (const c of ordered) for (const l of c.labels) if (!labels.has(l.id)) labels.set(l.id, l);
    const properties: Record<string, unknown> = {};
    for (const c of ordered) for (const [k, v] of Object.entries(c.properties)) if (empty(properties[k]) && !empty(v)) properties[k] = v;
    out.push({
      key,
      chatId: primary.id,
      chatIds: ordered.map((c) => c.id),
      lines,
      name: ordered.find((c) => c.name)?.name ?? '',
      memberCount: Math.max(...list.map((c) => c.memberCount || 0)),
      status: matched.some((c) => c.status === 'open') ? 'open' : 'closed',
      leftAt: list.every((c) => c.leftAt) ? primary.leftAt : null,
      flagged: list.some((c) => c.flagged),
      archived: list.every((c) => c.archived),
      labels: [...labels.values()].sort((a, b) => a.name.localeCompare(b.name)),
      properties,
      lastActivity: ordered.map(activity).reduce((a, b) => (b > a ? b : a)),
      createdAt: list.map((c) => c.createdAt).reduce((a, b) => (b < a ? b : a)),
    });
  }
  return out.sort((a, b) => (a.lastActivity === b.lastActivity ? (a.key < b.key ? -1 : 1) : a.lastActivity < b.lastActivity ? 1 : -1));
}

// ======================================================================
// Base de datos
// ======================================================================

interface LinkCopy {
  object_id: string;
  name: string;
  props: string;
  fetched_at: string | null;
  missing: number;
}

async function groupChat(ws: string, chatId: string): Promise<{ id: string; jid: string } | null> {
  const row = (await getDb().prepare("SELECT id, provider_chat_id FROM groups_chats WHERE id = ? AND user_id = ? AND kind = 'group'").get(chatId, ws)) as
    | { id: string; provider_chat_id: string }
    | undefined;
  return row && row.provider_chat_id ? { id: row.id, jid: row.provider_chat_id } : null;
}

async function ensureIdentity(ws: string, jid: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb().prepare('INSERT OR IGNORE INTO groups_identities (user_id, jid, created_at, updated_at) VALUES (?, ?, ?, ?)').run(ws, jid, now, now);
}

/** La empresa de HubSpot del grupo ('' si no tiene). */
export async function groupCompanyId(ws: string, jid: string): Promise<string> {
  const row = (await getDb().prepare('SELECT company_id FROM groups_identities WHERE user_id = ? AND jid = ?').get(ws, jid)) as { company_id: string } | undefined;
  return row?.company_id ?? '';
}

/** Copia el vínculo a la empresa en todos los chats del grupo (los que ya lo tienen igual no cambian). */
async function mirrorCompany(ws: string, jid: string, link: LinkCopy, actor: string | null): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO groups_hubspot_links (chat_id, user_id, object_type, object_id, name, props, fetched_at, missing, linked_by, created_at)
       SELECT ch.id, ch.user_id, 'company', ?, ?, ?, ?, ?, ?, ? FROM groups_chats ch
       WHERE ch.user_id = ? AND ch.provider_chat_id = ? AND ch.kind = 'group'
         -- Dos personas vinculando a la vez: solo copia la que quedó como empresa del grupo.
         AND EXISTS (SELECT 1 FROM groups_identities gi WHERE gi.user_id = ch.user_id AND gi.jid = ch.provider_chat_id AND gi.company_id = ?)
       ON CONFLICT(chat_id, object_type) DO UPDATE SET object_id = excluded.object_id, name = excluded.name, props = excluded.props,
         fetched_at = excluded.fetched_at, missing = excluded.missing, linked_by = excluded.linked_by
       WHERE groups_hubspot_links.object_id != excluded.object_id`,
    )
    .run(link.object_id, link.name, link.props, link.fetched_at, link.missing, actor, new Date().toISOString(), ws, jid, link.object_id);
}

/**
 * El chat acaba de quedar vinculado a una empresa: esa pasa a ser la del
 * grupo y se copia a las demás líneas. Un chat 1 a 1 no cambia nada. El que
 * llama ya chequeó el acceso al chat.
 */
export async function propagateGroupCompany(ws: string, chatId: string, actor: string | null): Promise<void> {
  const chat = await groupChat(ws, chatId);
  if (!chat) return;
  const link = (await getDb()
    .prepare("SELECT object_id, name, props, fetched_at, missing FROM groups_hubspot_links WHERE chat_id = ? AND user_id = ? AND object_type = 'company'")
    .get(chatId, ws)) as LinkCopy | undefined;
  if (!link) return;
  await ensureIdentity(ws, chat.jid);
  const now = new Date().toISOString();
  await getDb()
    .prepare('UPDATE groups_identities SET company_id = ?, linked_by = ?, linked_at = ?, updated_at = ? WHERE user_id = ? AND jid = ?')
    .run(link.object_id, actor, now, now, ws, chat.jid);
  await mirrorCompany(ws, chat.jid, link, actor);
}

/** Se quitó la empresa del chat: el grupo queda sin empresa en todas sus líneas. */
export async function clearGroupCompany(ws: string, chatId: string): Promise<void> {
  const chat = await groupChat(ws, chatId);
  if (!chat) return;
  const db = getDb();
  await db.prepare("UPDATE groups_identities SET company_id = '', linked_by = NULL, linked_at = NULL, updated_at = ? WHERE user_id = ? AND jid = ?").run(new Date().toISOString(), ws, chat.jid);
  await db
    .prepare(
      `DELETE FROM groups_hubspot_links WHERE user_id = ? AND object_type = 'company'
       AND chat_id IN (SELECT id FROM groups_chats WHERE user_id = ? AND provider_chat_id = ? AND kind = 'group')`,
    )
    .run(ws, ws, chat.jid);
}

/**
 * Un chat de grupo nuevo (una línea que entró a un grupo): crea la identidad
 * si no estaba y, si el grupo ya tiene empresa, la copia a este chat.
 */
export async function attachGroupIdentity(ws: string, chatId: string): Promise<void> {
  const chat = await groupChat(ws, chatId);
  if (!chat) return;
  await ensureIdentity(ws, chat.jid);
  const companyId = await groupCompanyId(ws, chat.jid);
  if (!companyId) return;
  const db = getDb();
  const sibling = (await db
    .prepare(
      `SELECT l.object_id, l.name, l.props, l.fetched_at, l.missing FROM groups_hubspot_links l JOIN groups_chats ch ON ch.id = l.chat_id
       WHERE ch.user_id = ? AND ch.provider_chat_id = ? AND ch.kind = 'group' AND l.object_type = 'company' AND l.object_id = ? LIMIT 1`,
    )
    .get(ws, chat.jid, companyId)) as LinkCopy | undefined;
  const company = sibling
    ? null
    : ((await db.prepare('SELECT name, missing FROM groups_hubspot_companies WHERE user_id = ? AND company_id = ?').get(ws, companyId)) as
        | { name: string; missing: number }
        | undefined);
  const link: LinkCopy = sibling ?? { object_id: companyId, name: company?.name ?? '', props: '{}', fetched_at: null, missing: company?.missing ?? 0 };
  await db
    .prepare(
      `INSERT OR IGNORE INTO groups_hubspot_links (chat_id, user_id, object_type, object_id, name, props, fetched_at, missing, linked_by, created_at)
       VALUES (?, ?, 'company', ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(chat.id, ws, link.object_id, link.name, link.props, link.fetched_at, link.missing, new Date().toISOString());
}

/** Otra cuenta de HubSpot: ningún grupo conserva su empresa. */
export async function clearWorkspaceGroupCompanies(ws: string): Promise<void> {
  await getDb().prepare("UPDATE groups_identities SET company_id = '', linked_by = NULL, linked_at = NULL WHERE user_id = ? AND company_id != ''").run(ws);
}

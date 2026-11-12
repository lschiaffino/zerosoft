/**
 * Groups: quién ve qué. Dos ajustes del workspace (groups_platform):
 *
 * - Acceso por etiqueta: con `labelAccess`, un miembro (rol member) ve solo
 *   los chats que tienen alguna de sus etiquetas (groups_label_access) o que
 *   tiene asignados. Admins y dueño ven todo. Se aplica en la bandeja, la
 *   búsqueda, Cmd+K, la API, el MCP, los reportes y el export.
 * - Ocultar teléfonos: por rol (member, admin; el dueño nunca). Los números
 *   se muestran como "+54 ••• 00" en la interfaz, el export y la API.
 *
 * El "viewer" se arma una vez por request y se pasa a las consultas.
 * Server-only (las funciones puras de máscara están en groups-mask.ts).
 */
import { getDb } from './db';
import type { TeamRole } from './teams';
import type { ChatDto, ChatRow, MemberDto, MessageDto } from './groups';
import { maskPhone, maskPhoneText } from './groups-mask';

export { maskPhone, maskPhoneText };

export interface PlatformSettings {
  labelAccess: boolean;
  /** Roles que ven los teléfonos ocultos. */
  maskRoles: Array<'member' | 'admin'>;
}

export const DEFAULT_PLATFORM: PlatformSettings = { labelAccess: false, maskRoles: [] };

export function normalizePlatform(raw: unknown): PlatformSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const roles = Array.isArray(r.maskRoles) ? r.maskRoles.filter((x): x is 'member' | 'admin' => x === 'member' || x === 'admin') : [];
  return { labelAccess: r.labelAccess === true, maskRoles: [...new Set(roles)] };
}

export async function getPlatformSettings(ws: string): Promise<PlatformSettings> {
  const row = (await getDb().prepare('SELECT data FROM groups_platform WHERE user_id = ?').get(ws)) as { data: string } | undefined;
  if (!row) return { ...DEFAULT_PLATFORM };
  try {
    return normalizePlatform(JSON.parse(row.data));
  } catch {
    return { ...DEFAULT_PLATFORM };
  }
}

export async function updatePlatformSettings(ws: string, patch: Partial<PlatformSettings>): Promise<PlatformSettings> {
  const next = normalizePlatform({ ...(await getPlatformSettings(ws)), ...patch });
  await getDb()
    .prepare(
      `INSERT INTO groups_platform (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(ws, JSON.stringify(next), new Date().toISOString());
  return next;
}

// ---------- Etiquetas por persona ----------

/** label_id → personas con acceso. */
export async function listLabelAccess(ws: string): Promise<Record<string, string[]>> {
  const rows = (await getDb().prepare('SELECT label_id, person_id FROM groups_label_access WHERE user_id = ?').all(ws)) as Array<{
    label_id: string;
    person_id: string;
  }>;
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.label_id] ??= []).push(r.person_id);
  return out;
}

/** Reemplaza quién tiene acceso a una etiqueta (solo personas del workspace). */
export async function setLabelAccess(ws: string, labelId: string, personIds: string[]): Promise<string[]> {
  const db = getDb();
  const label = await db.prepare('SELECT id FROM groups_labels WHERE id = ? AND user_id = ?').get(labelId, ws);
  if (!label) return [];
  const { isWorkspacePerson } = await import('./crm-refs');
  const valid: string[] = [];
  for (const p of [...new Set(personIds)].slice(0, 200)) if (await isWorkspacePerson(ws, p)) valid.push(p);
  await db.prepare('DELETE FROM groups_label_access WHERE label_id = ? AND user_id = ?').run(labelId, ws);
  for (const p of valid) {
    await db.prepare('INSERT OR IGNORE INTO groups_label_access (user_id, label_id, person_id) VALUES (?, ?, ?)').run(ws, labelId, p);
  }
  return valid;
}

// ---------- Viewer ----------

export interface GroupsViewer {
  ws: string;
  me: string;
  role: TeamRole;
  /** Ve solo sus etiquetas y sus chats asignados. */
  restricted: boolean;
  /** Teléfonos ocultos. */
  mask: boolean;
  /**
   * Ve solo las líneas (números) que le dejaron ver: las de visibilidad "todo
   * el workspace", las que tiene a su nombre, las que le dieron por persona o
   * por equipo. Admins y dueño ven todas.
   */
  linesScoped: boolean;
}

export function viewerFrom(ws: string, me: string, role: TeamRole, settings: PlatformSettings): GroupsViewer {
  return {
    ws,
    me,
    role,
    restricted: (settings.labelAccess && role === 'member') || role === 'guest',
    mask: role === 'guest' || (role !== 'owner' && settings.maskRoles.includes(role)),
    linesScoped: role === 'member' || role === 'guest',
  };
}

export async function groupsViewer(ws: string, me: string, role: TeamRole): Promise<GroupsViewer> {
  return viewerFrom(ws, me, role, await getPlatformSettings(ws));
}

/** Sin restricciones (cron, webhooks, Flow): ve todo y sin máscara. */
export function systemViewer(ws: string): GroupsViewer {
  return { ws, me: ws, role: 'owner', restricted: false, mask: false, linesScoped: false };
}

/**
 * Condición SQL para las líneas que ve (alias de groups_numbers). null si ve
 * todas. Los args van en el orden del SQL.
 */
export function numberAccessSql(viewer: GroupsViewer | null | undefined, alias = 'n'): { sql: string; args: string[] } | null {
  if (!viewer?.linesScoped) return null;
  return {
    sql: `(${alias}.visibility = 'all' OR ${alias}.owner_id = ? OR EXISTS (SELECT 1 FROM groups_number_access zna WHERE zna.number_id = ${alias}.id
           AND ((zna.kind = 'person' AND zna.ref_id = ?)
             OR (zna.kind = 'team' AND zna.ref_id IN (SELECT ztm.team_id FROM groups_team_members ztm WHERE ztm.person_id = ?)))))`,
    args: [viewer.me, viewer.me, viewer.me],
  };
}

/**
 * Condición SQL para los chats que ve (alias de groups_chats). null si ve
 * todos. Los args van en el orden del SQL. Junta la visibilidad por línea y,
 * si está activo, el acceso por etiqueta.
 */
export function chatAccessSql(viewer: GroupsViewer | null | undefined, alias = 'c'): { sql: string; args: string[] } | null {
  const parts: string[] = [];
  const args: string[] = [];
  const line = numberAccessSql(viewer, 'zn');
  if (line) {
    parts.push(`EXISTS (SELECT 1 FROM groups_numbers zn WHERE zn.id = ${alias}.number_id AND ${line.sql})`);
    args.push(...line.args);
  }
  if (viewer?.restricted) {
    parts.push(`(${alias}.assigned_to = ? OR EXISTS (SELECT 1 FROM groups_chat_labels zl JOIN groups_label_access za ON za.label_id = zl.label_id
           WHERE zl.chat_id = ${alias}.id AND za.person_id = ?))`);
    args.push(viewer.me, viewer.me);
  }
  return parts.length ? { sql: parts.join(' AND '), args } : null;
}

/** ¿Ve esta línea? (visibilidad por línea; las etiquetas no cuentan). */
export async function canSeeNumber(viewer: GroupsViewer | null | undefined, numberId: string): Promise<boolean> {
  if (!viewer) return false;
  const access = numberAccessSql(viewer);
  const row = await getDb()
    .prepare(`SELECT 1 AS x FROM groups_numbers n WHERE n.id = ? AND n.user_id = ?${access ? ` AND ${access.sql}` : ''}`)
    .get(numberId, viewer.ws, ...(access?.args ?? []));
  return Boolean(row);
}

/** Ids de las líneas que ve. null = todas. */
export async function visibleNumberIds(viewer: GroupsViewer | null | undefined): Promise<Set<string> | null> {
  const access = numberAccessSql(viewer);
  if (!viewer || !access) return null;
  const rows = (await getDb().prepare(`SELECT n.id FROM groups_numbers n WHERE n.user_id = ? AND ${access.sql}`).all(viewer.ws, ...access.args)) as Array<{
    id: string;
  }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * De una lista de chats, los que la persona puede abrir (mismo criterio que canSeeChat), en una consulta.
 * null si ve todos: no hay nada que filtrar. Para el aviso en vivo (lib/wa-live.ts).
 */
export function chatFilterFor(viewer: GroupsViewer): ((chatIds: string[]) => Promise<Set<string>>) | null {
  const access = chatAccessSql(viewer);
  if (!access) return null;
  return async (chatIds) => {
    const ids = [...new Set(chatIds)].slice(0, 500);
    if (!ids.length) return new Set();
    const rows = (await getDb()
      // `+c.user_id`: que el planificador busque cada chat por su clave (id) y no recorra todos los chats del
      // workspace por el índice de user_id (tests/unit/wa-live-stream.test.ts mira el plan).
      .prepare(`SELECT c.id FROM groups_chats c WHERE c.id IN (${ids.map(() => '?').join(',')}) AND +c.user_id = ? AND ${access.sql}`)
      .all(...ids, viewer.ws, ...access.args)) as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  };
}

export async function canSeeChat(viewer: GroupsViewer | null | undefined, chatId: string): Promise<boolean> {
  const db = getDb();
  if (!viewer) return false;
  const access = chatAccessSql(viewer);
  const row = await db
    .prepare(`SELECT 1 AS x FROM groups_chats c WHERE c.id = ? AND c.user_id = ?${access ? ` AND ${access.sql}` : ''}`)
    .get(chatId, viewer.ws, ...(access?.args ?? []));
  return Boolean(row);
}

/**
 * ¿Esta persona puede ver el chat? Para avisos (push, notificaciones, emails)
 * que se arman fuera de un request: nunca se avisa de un chat que no ve.
 */
export async function personCanSeeChat(ws: string, personId: string, chatId: string): Promise<boolean> {
  const { workspaceRole } = await import('./api-auth');
  return canSeeChat(await groupsViewer(ws, personId, await workspaceRole(ws, personId)), chatId);
}

/** Ids de los chats visibles (para filtrar listas que no son de chats: tickets, reportes). null = todos. */
export async function visibleChatIds(viewer: GroupsViewer | null | undefined): Promise<Set<string> | null> {
  const access = chatAccessSql(viewer);
  if (!viewer || !access) return null;
  const rows = (await getDb()
    .prepare(`SELECT c.id FROM groups_chats c WHERE c.user_id = ? AND ${access.sql}`)
    .all(viewer.ws, ...access.args)) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

// ---------- Máscara ----------

/** Para los campos `phone` de los DTO: la interfaz les antepone "+", así que van sin él. */
const maskField = (phone: string) => maskPhone(phone).replace(/^\+/, '');

export function maskChat<T extends Pick<ChatDto, 'phone' | 'name'> & { match?: string }>(viewer: GroupsViewer | null | undefined, chat: T): T {
  if (!viewer?.mask) return chat;
  const phone = chat.phone;
  const name = phone && chat.name === `+${phone}` ? maskPhone(phone) : chat.name;
  return { ...chat, phone: phone ? maskField(phone) : '', name, ...(chat.match ? { match: maskPhoneText(chat.match) } : {}) };
}

export function maskMessage(viewer: GroupsViewer | null | undefined, m: MessageDto): MessageDto {
  if (!viewer?.mask) return m;
  return { ...m, senderPhone: m.senderPhone ? maskField(m.senderPhone) : '', reactions: m.reactions.map((r) => ({ ...r, by: /^\d{6,}$/.test(r.by) ? maskPhone(r.by) : r.by })) };
}

export function maskMember(viewer: GroupsViewer | null | undefined, m: MemberDto): MemberDto & { masked?: boolean } {
  if (!viewer?.mask) return m;
  return { ...m, phone: maskField(m.phone), masked: true };
}

/** Nombre visible de una fila de chat (para listas armadas a mano: tickets, reportes, export). */
export function maskedChatName(viewer: GroupsViewer | null | undefined, row: Pick<ChatRow, 'name' | 'phone' | 'provider_chat_id'>): string {
  if (row.name) return row.name;
  if (row.phone) return viewer?.mask ? maskPhone(row.phone) : `+${row.phone}`;
  return viewer?.mask ? maskPhoneText(row.provider_chat_id) : row.provider_chat_id;
}

/** Tickets que la persona puede ver (chats visibles) con el nombre del chat enmascarado si hace falta. */
export async function ticketsForViewer<T extends { chatId: string | null; chatName: string }>(viewer: GroupsViewer | null | undefined, tickets: T[]): Promise<T[]> {
  const visible = await visibleChatIds(viewer);
  return tickets
    .filter((t) => !visible || (t.chatId !== null && visible.has(t.chatId)))
    .map((t) => (viewer?.mask ? { ...t, chatName: maskPhoneText(t.chatName) } : t));
}

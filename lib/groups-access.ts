/**
 * Groups: quién ve qué. Ajustes del workspace (groups_platform):
 *
 * - Acceso por línea: con `lineAccess`, un miembro ve solo los chats de las
 *   líneas que se le dieron a él o a uno de sus equipos (groups_line_access).
 *   Es un corte duro: ni una asignación ni una etiqueta lo saltean.
 * - Acceso por equipo: con `teamAccess`, un miembro ve los chats asignados a
 *   sus equipos (además de los suyos y los de sus etiquetas si hay acceso
 *   por etiqueta).
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
  /** Un miembro ve solo las líneas que tiene (él o su equipo). */
  lineAccess: boolean;
  /** Un miembro ve también los chats asignados a sus equipos (y solo esos, los suyos y los de sus etiquetas). */
  teamAccess: boolean;
  /** Quien pasa a desconectado devuelve sus chats sin responder a la asignación automática. */
  reassignOnOffline: boolean;
}

export const DEFAULT_PLATFORM: PlatformSettings = { labelAccess: false, maskRoles: [], lineAccess: false, teamAccess: false, reassignOnOffline: false };

export function normalizePlatform(raw: unknown): PlatformSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const roles = Array.isArray(r.maskRoles) ? r.maskRoles.filter((x): x is 'member' | 'admin' => x === 'member' || x === 'admin') : [];
  return {
    labelAccess: r.labelAccess === true,
    maskRoles: [...new Set(roles)],
    lineAccess: r.lineAccess === true,
    teamAccess: r.teamAccess === true,
    reassignOnOffline: r.reassignOnOffline === true,
  };
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
  /** Tiene algún recorte (línea, etiqueta o equipo): no ve todo. */
  restricted: boolean;
  /** Teléfonos ocultos. */
  mask: boolean;
  /** Líneas que puede ver (null = todas). Corte duro. */
  lineIds?: string[] | null;
  /** Dentro de sus líneas, ve solo lo asignado a él más lo de `labels` y `teamIds`. */
  scoped?: boolean;
  /** Ve los chats con etiquetas que tiene (acceso por etiqueta). */
  labels?: boolean;
  /** Ve los chats asignados a estos equipos (acceso por equipo). */
  teamIds?: string[];
}

/** Líneas y equipos de una persona (lo arma groupsViewer desde la base). */
export interface ViewerScope {
  lineIds: string[];
  teamIds: string[];
}

export function viewerFrom(ws: string, me: string, role: TeamRole, settings: PlatformSettings, scope: ViewerScope = { lineIds: [], teamIds: [] }): GroupsViewer {
  const s = normalizePlatform(settings);
  const limited = role === 'member' || role === 'guest';
  const labels = (s.labelAccess && role === 'member') || role === 'guest';
  const teams = s.teamAccess && role === 'member';
  const lineIds = limited && s.lineAccess ? [...new Set(scope.lineIds)] : null;
  const scoped = labels || teams;
  return {
    ws,
    me,
    role,
    restricted: scoped || lineIds !== null,
    mask: role === 'guest' || (role !== 'owner' && s.maskRoles.includes(role)),
    lineIds,
    scoped,
    labels,
    teamIds: teams ? [...new Set(scope.teamIds)] : [],
  };
}

/** Equipos de Groups (espejo de los subequipos del workspace) de una persona. */
export async function personTeamIds(ws: string, personId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT m.team_id FROM groups_team_members m JOIN groups_teams t ON t.id = m.team_id WHERE t.user_id = ? AND m.person_id = ?')
    .all(ws, personId)) as Array<{ team_id: string }>;
  return rows.map((r) => r.team_id);
}

/** Líneas dadas a la persona o a uno de sus equipos. */
export async function personLineIds(ws: string, personId: string, teamIds?: string[]): Promise<string[]> {
  const teams = teamIds ?? (await personTeamIds(ws, personId));
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT a.number_id FROM groups_line_access a JOIN groups_numbers n ON n.id = a.number_id AND n.user_id = a.user_id
       WHERE a.user_id = ? AND ((a.subject_kind = 'person' AND a.subject_id = ?)${teams.length ? ` OR (a.subject_kind = 'team' AND a.subject_id IN (${teams.map(() => '?').join(',')}))` : ''})`,
    )
    .all(ws, personId, ...teams)) as Array<{ number_id: string }>;
  return rows.map((r) => r.number_id);
}

export async function groupsViewer(ws: string, me: string, role: TeamRole): Promise<GroupsViewer> {
  const settings = await getPlatformSettings(ws);
  const limited = role === 'member' || role === 'guest';
  if (!limited || (!settings.lineAccess && !settings.teamAccess)) return viewerFrom(ws, me, role, settings);
  const teamIds = await personTeamIds(ws, me);
  const lineIds = settings.lineAccess ? await personLineIds(ws, me, teamIds) : [];
  return viewerFrom(ws, me, role, settings, { lineIds, teamIds });
}

/** ¿La persona puede ver (y usar) esa línea? Admins y dueño, siempre. */
export async function personCanUseLine(ws: string, personId: string, role: TeamRole, numberId: string): Promise<boolean> {
  const v = await groupsViewer(ws, personId, role);
  return v.lineIds == null || v.lineIds.includes(numberId);
}

/** Sin restricciones (cron, webhooks, Flow): ve todo y sin máscara. */
export function systemViewer(ws: string): GroupsViewer {
  return { ws, me: ws, role: 'owner', restricted: false, mask: false };
}

/**
 * Condición SQL para los chats que ve (alias de groups_chats). null si ve
 * todos. Los args van en el orden del SQL.
 */
export function chatAccessSql(viewer: GroupsViewer | null | undefined, alias = 'c'): { sql: string; args: string[] } | null {
  if (!viewer?.restricted) return null;
  // Viewer viejo (armado a mano, sin los campos nuevos): etiquetas y asignados, como antes.
  const legacy = viewer.scoped === undefined && viewer.lineIds === undefined;
  const parts: string[] = [];
  const args: string[] = [];
  const lineIds = legacy ? null : (viewer.lineIds ?? null);
  if (lineIds) {
    parts.push(lineIds.length ? `${alias}.number_id IN (${lineIds.map(() => '?').join(',')})` : '0');
    args.push(...lineIds);
  }
  if (legacy || viewer.scoped) {
    const ors = [`${alias}.assigned_to = ?`];
    args.push(viewer.me);
    if (legacy || viewer.labels) {
      ors.push(`EXISTS (SELECT 1 FROM groups_chat_labels zl JOIN groups_label_access za ON za.label_id = zl.label_id
           WHERE zl.chat_id = ${alias}.id AND za.person_id = ?)`);
      args.push(viewer.me);
    }
    const teams = legacy ? [] : (viewer.teamIds ?? []);
    if (teams.length) {
      ors.push(`${alias}.assigned_team_id IN (${teams.map(() => '?').join(',')})`);
      args.push(...teams);
    }
    parts.push(`(${ors.join(' OR ')})`);
  }
  if (parts.length === 0) return null;
  return { sql: `(${parts.join(' AND ')})`, args };
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

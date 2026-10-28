/**
 * Talk: mensajería de equipo (como Slack). Capa de datos del servidor.
 *
 * Todo vive bajo el workspace (id del owner). Quién ve qué:
 *  - canal público: cualquier persona del workspace lo lee y se puede unir;
 *    escribe quien es miembro;
 *  - canal privado, DM y grupo de DM: solo sus miembros (ni el owner del
 *    workspace lee DMs ajenos).
 * Cada cambio deja un evento en talk_events (el feed del tiempo real, ver
 * lib/realtime.ts): el navegador recibe la pista y vuelve a pedir lo que
 * cambió con su propio chequeo de acceso.
 */
import { getDb, type Db } from './db';
import type { TeamRole } from './teams';
import { roleAtLeast } from './teams';
import { extractMentions, normalizeChannelName, extractUrls } from './talk-markdown';
import { isValidReaction } from './talk-emoji';
import { parseApps } from './workspace';

export class TalkError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export interface TalkActor {
  workspaceId: string;
  personId: string;
  role: TeamRole;
  teamId: string | null;
  /**
   * Invitado (lib/talk-guests.ts): no es del team, solo ve los canales donde
   * está. Lo marca resolveTalkActor; los chequeos de acceso igual lo leen de
   * la base (workspacePersonKind), así un actor armado a mano no se salta nada.
   */
  guest?: boolean;
}

export function talkActor(user: { id: string; role: TeamRole; actingUser?: { id: string } | null; team?: { id: string } | null }): TalkActor {
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role, teamId: user.team?.id ?? null };
}

export const nowIso = () => new Date().toISOString();

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const inList = (n: number) => Array.from({ length: n }, () => '?').join(', ');

// ---------- Personas ----------

export interface TalkPerson {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** Invitado de Talk: solo está en algunos canales. */
  guest?: boolean;
  /** Ya no está, y había entrado como invitado (DMs con alguien que se sacó). */
  formerGuest?: boolean;
}

/** Lista de apps de team_members.apps: ¿incluye Talk? (null / '*' = todas, como lib/workspace.ts). */
function appsIncludeTalk(lists: Array<string | null>): boolean {
  return lists.some((raw) => {
    const apps = parseApps(raw);
    return apps === '*' || apps.includes('talk');
  });
}

/**
 * Personas de Talk del workspace: el owner, los miembros del team (no los
 * guests de workspace) que tienen Talk entre sus apps, y los invitados de
 * Talk (marcados).
 */
export async function listTalkPeople(workspaceId: string, db: Db = getDb()): Promise<TalkPerson[]> {
  const rows = (await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.image,
         (SELECT group_concat(COALESCE(m.apps, '*'), '|') FROM team_members m JOIN teams t ON t.id = m.team_id
           WHERE t.owner_id = ? AND m.user_id = u.id AND m.role != 'guest') AS apps,
         EXISTS (SELECT 1 FROM talk_guests g WHERE g.workspace_id = ? AND g.user_id = u.id) AS talk_guest
       FROM users u
       WHERE u.id = ?
          OR u.id IN (SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.role != 'guest')
          OR u.id IN (SELECT g.user_id FROM talk_guests g WHERE g.workspace_id = ?)
       ORDER BY COALESCE(u.name, u.email) LIMIT 1000`,
    )
    .all(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId)) as Array<{ id: string; name: string | null; email: string; image: string | null; apps: string | null; talk_guest: number }>;
  const out: TalkPerson[] = [];
  for (const r of rows) {
    const member = r.id === workspaceId || (r.apps !== null && appsIncludeTalk(r.apps.split('|').map((a) => (a === '*' ? null : a))));
    if (!member && !Number(r.talk_guest)) continue;
    out.push({ id: r.id, name: r.name?.trim() || r.email.split('@')[0], email: r.email, image: r.image, ...(member ? {} : { guest: true }) });
  }
  return out;
}

export type TalkPersonKind = 'member' | 'guest';

/**
 * Qué es esta persona en Talk de este workspace: miembro (owner, o del team
 * con Talk entre sus apps), invitado de Talk, o nada. Un guest de workspace
 * o un miembro sin la app Talk no es nada acá (salvo que lo hayan invitado a
 * canales de Talk).
 */
export async function workspacePersonKind(workspaceId: string, personId: string, db: Db = getDb()): Promise<TalkPersonKind | null> {
  if (personId === workspaceId) return 'member';
  const rows = (await db
    .prepare("SELECT m.apps FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'guest'")
    .all(workspaceId, personId)) as Array<{ apps: string | null }>;
  if (rows.length && appsIncludeTalk(rows.map((r) => r.apps))) return 'member';
  const guest = await db.prepare('SELECT 1 AS x FROM talk_guests WHERE workspace_id = ? AND user_id = ?').get(workspaceId, personId);
  return guest ? 'guest' : null;
}

/** Sigue en Talk de este workspace (miembro con la app, o invitado). */
export async function isWorkspacePerson(workspaceId: string, personId: string, db: Db = getDb()): Promise<boolean> {
  return !!(await workspacePersonKind(workspaceId, personId, db));
}

/** SQL de "canal público que esta persona ve sin ser miembro": para un invitado, ninguno. */
export function publicClause(actor: TalkActor, alias = 'c'): string {
  return actor.guest ? '0' : `${alias}.kind = 'public'`;
}

/** Subequipos del workspace para @menciones (Ajustes › Equipos): @ventas avisa a todo el equipo. */
export async function listTalkGroups(workspaceId: string): Promise<Array<{ id: string; name: string; handle: string; members: string[] }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT g.id, g.name, g.slug, (SELECT group_concat(m.user_id) FROM workspace_group_members m WHERE m.group_id = g.id) AS members
       FROM workspace_groups g WHERE g.workspace_id = ? ORDER BY g.name`,
    )
    .all(workspaceId)
    .catch(() => [])) as Array<{ id: string; name: string; slug: string; members: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    handle: r.slug || normalizeChannelName(r.name) || r.id,
    members: r.members ? r.members.split(',') : [],
  }));
}

// ---------- Eventos (tiempo real) ----------

export type TalkEventKind =
  | 'message'
  | 'reaction'
  | 'channel'
  | 'typing'
  | 'read'
  | 'presence'
  | 'saved'
  | 'access'
  // Ronda 2: perfiles, huddles (estado y señalización WebRTC a una persona), canvas, listas, secciones y respuestas efímeras de comandos.
  | 'profile'
  | 'huddle'
  | 'signal'
  | 'canvas'
  | 'list'
  | 'section'
  | 'ephemeral';

export interface TalkEvent {
  id: number;
  kind: TalkEventKind;
  channelId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  at: string;
}

let eventWrites = 0;

export async function emitTalkEvent(
  workspaceId: string,
  kind: TalkEventKind,
  opts: { channelId?: string | null; actorId?: string | null; userId?: string | null; payload?: Record<string, unknown> } = {},
): Promise<void> {
  const db = getDb();
  try {
    await db
      .prepare('INSERT INTO talk_events (workspace_id, channel_id, user_id, actor_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(workspaceId, opts.channelId ?? null, opts.userId ?? null, opts.actorId ?? null, kind, JSON.stringify(opts.payload ?? {}), nowIso());
    // El feed solo hace falta unos minutos: cada tanto se poda lo de más de un día.
    if (++eventWrites % 200 === 0) {
      await db.prepare("DELETE FROM talk_events WHERE created_at < ?").run(new Date(Date.now() - 86_400_000).toISOString());
    }
  } catch (err) {
    // Un evento perdido no rompe la operación: el próximo refresco lo trae.
    console.error('[talk] emit event failed', err);
  }
}

export async function latestEventId(workspaceId: string): Promise<number> {
  const row = (await getDb().prepare('SELECT MAX(id) AS id FROM talk_events WHERE workspace_id = ?').get(workspaceId)) as { id: number | null } | undefined;
  return Number(row?.id ?? 0);
}

/** Eventos nuevos que esta persona puede ver (canales donde está, públicos, y los suyos). */
export async function listEventsSince(actor: TalkActor, cursor: number, limit = 200): Promise<{ events: TalkEvent[]; cursor: number }> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT e.id, e.kind, e.channel_id, e.actor_id, e.payload, e.created_at FROM talk_events e
       WHERE e.workspace_id = ? AND e.id > ? AND (e.user_id IS NULL OR e.user_id = ?)
         AND (e.channel_id IS NULL
              OR e.channel_id IN (SELECT channel_id FROM talk_members WHERE user_id = ?)
              OR e.channel_id IN (SELECT c.id FROM talk_channels c WHERE c.workspace_id = ? AND ${publicClause(actor)}))
       ORDER BY e.id ASC LIMIT ?`,
    )
    .all(actor.workspaceId, cursor, actor.personId, actor.personId, actor.workspaceId, limit)) as Array<{
    id: number;
    kind: TalkEventKind;
    channel_id: string | null;
    actor_id: string | null;
    payload: string;
    created_at: string;
  }>;
  let next = cursor;
  if (rows.length) next = Number(rows[rows.length - 1].id);
  else {
    // Sin eventos visibles: el cursor avanza igual hasta el último del workspace (no se re-escanea).
    const max = await latestEventId(actor.workspaceId);
    if (max > next && rows.length < limit) next = max;
  }
  return {
    events: rows.map((r) => ({ id: Number(r.id), kind: r.kind, channelId: r.channel_id, actorId: r.actor_id, payload: parseJson(r.payload, {}), at: r.created_at })),
    cursor: next,
  };
}

// ---------- Avisos: que nunca quede texto de lo que ya no se puede ver ----------

/** Borra los avisos (campana y emails en cola) de estos mensajes, para todas las personas o una. */
export async function purgeMessageNotifications(messageIds: string[], userId?: string): Promise<void> {
  if (!messageIds.length) return;
  await invalidateSummaries(messageIds, userId);
  const db = getDb();
  for (let i = 0; i < messageIds.length; i += 200) {
    const ids = messageIds.slice(i, i + 200);
    const marks = inList(ids.length);
    const who = userId ? ' AND user_id = ?' : '';
    const args = userId ? [...ids, userId] : ids;
    const reminderIds = ((await db
      .prepare(`SELECT id FROM talk_reminders WHERE message_id IN (${marks})${who}`)
      .all(...args)) as Array<{ id: string }>).map((r) => r.id);
    const where = `(source_type = 'talk_message' AND source_id IN (${marks}))${
      reminderIds.length ? ` OR (source_type = 'talk_reminder' AND source_id IN (${inList(reminderIds.length)}))` : ''
    }`;
    const whereArgs = [...ids, ...reminderIds];
    await db
      .prepare(`DELETE FROM talk_email_queue WHERE notification_id IN (SELECT id FROM notifications WHERE (${where})${who})`)
      .run(...whereArgs, ...(userId ? [userId] : []));
    await db.prepare(`DELETE FROM notifications WHERE (${where})${who}`).run(...whereArgs, ...(userId ? [userId] : []));
    // Push del navegador sin entregar (lib/talk-push.ts): el texto vive en groups_notifications.
    await db
      .prepare(
        `DELETE FROM groups_notifications WHERE url LIKE '/app/talk/%' AND instr(url, '&n=') > 0 AND substr(url, instr(url, '&n=') + 3) IN (${marks})${userId ? ' AND person_id = ?' : ''}`,
      )
      .run(...ids, ...(userId ? [userId] : []))
      .catch(() => undefined);
    if (reminderIds.length) await db.prepare(`DELETE FROM talk_reminders WHERE id IN (${inList(reminderIds.length)})`).run(...reminderIds);
  }
}

/**
 * Resúmenes de IA guardados (talk_ai_summaries) que cubren estos mensajes: se
 * borran cuando un mensaje se borra, se edita o vence por retención, así un
 * resumen nunca muestra texto que ya no existe. Recaps: por canal.
 */
export async function invalidateSummaries(messageIds: string[], userId?: string): Promise<void> {
  if (!messageIds.length) return;
  const db = getDb();
  for (let i = 0; i < messageIds.length; i += 200) {
    const ids = messageIds.slice(i, i + 200);
    const rows = (await db
      .prepare(`SELECT DISTINCT channel_id, COALESCE(parent_id, id) AS root FROM talk_messages WHERE id IN (${inList(ids.length)})`)
      .all(...ids)) as Array<{ channel_id: string; root: string }>;
    const chans = [...new Set(rows.map((r) => r.channel_id))];
    const roots = [...new Set(rows.map((r) => r.root))];
    if (!chans.length) continue;
    const who = userId ? ' AND user_id = ?' : '';
    const extra = userId ? [userId] : [];
    await db.prepare(`DELETE FROM talk_ai_summaries WHERE kind = 'channel' AND ref IN (${inList(chans.length)})${who}`).run(...chans, ...extra);
    await db.prepare(`DELETE FROM talk_ai_summaries WHERE kind = 'thread' AND ref IN (${inList(roots.length)})${who}`).run(...roots, ...extra);
    for (const c of chans) await db.prepare(`DELETE FROM talk_ai_summaries WHERE kind = 'recap' AND sources LIKE ?${who}`).run(`%"channelId":"${c}"%`, ...extra);
  }
}

/** Quien pierde acceso a un canal: fuera sus avisos, recordatorios, guardados, borradores y programados de ahí. */
export async function purgeChannelFor(channelId: string, userId: string): Promise<void> {
  const db = getDb();
  const ids = ((await db.prepare('SELECT id FROM talk_messages WHERE channel_id = ?').all(channelId)) as Array<{ id: string }>).map((r) => r.id);
  await purgeMessageNotifications(ids, userId);
  await db.prepare('DELETE FROM talk_saved WHERE user_id = ? AND message_id IN (SELECT id FROM talk_messages WHERE channel_id = ?)').run(userId, channelId);
  await db.prepare('DELETE FROM talk_thread_follows WHERE user_id = ? AND message_id IN (SELECT id FROM talk_messages WHERE channel_id = ?)').run(userId, channelId);
  await db.prepare('DELETE FROM talk_drafts WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  await db.prepare("UPDATE talk_scheduled SET status = 'cancelled' WHERE user_id = ? AND channel_id = ? AND status IN ('pending', 'failed')").run(userId, channelId);
  await db.prepare('DELETE FROM groups_notifications WHERE person_id = ? AND url LIKE ?').run(userId, `/app/talk/${channelId}?%`).catch(() => undefined);
  await db.prepare('DELETE FROM talk_ai_summaries WHERE user_id = ? AND ref = ?').run(userId, channelId);
  await db.prepare('DELETE FROM talk_section_items WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  // Si estaba en un huddle de ese canal, sale.
  await db.prepare('DELETE FROM talk_huddle_peers WHERE user_id = ? AND huddle_id IN (SELECT id FROM talk_huddles WHERE channel_id = ?)').run(userId, channelId);
}

/**
 * Una persona sale del workspace (lib/teams.ts removeMember): deja los canales,
 * no recibe más avisos ni emails de Talk, y sus DMs quedan desactivados para
 * el resto (se leen, no se escribe).
 */
export async function talkPersonRemoved(workspaceId: string, userId: string): Promise<void> {
  if (userId === workspaceId) return;
  const db = getDb();
  // Si además era invitada de Talk, deja de serlo: salir del workspace es salir de todo.
  await db.prepare('DELETE FROM talk_guests WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
  const channels =((await db.prepare('SELECT c.id, c.kind FROM talk_channels c JOIN talk_members m ON m.channel_id = c.id AND m.user_id = ? WHERE c.workspace_id = ?').all(userId, workspaceId)) as Array<{
    id: string;
    kind: TalkChannelKind;
  }>);
  for (const c of channels) {
    await purgeChannelFor(c.id, userId);
    if (c.kind === 'public' || c.kind === 'private') await db.prepare('DELETE FROM talk_members WHERE channel_id = ? AND user_id = ?').run(c.id, userId);
  }
  // Avisos y emails pendientes de Talk de este workspace (incluidos los de canales públicos donde no estaba).
  const wsMessages = ((await db
    .prepare("SELECT source_id FROM notifications WHERE user_id = ? AND source_type = 'talk_message'")
    .all(userId)) as Array<{ source_id: string }>).map((r) => r.source_id);
  if (wsMessages.length) {
    const mine = ((await db
      .prepare(`SELECT id FROM talk_messages WHERE workspace_id = ? AND id IN (${inList(Math.min(wsMessages.length, 500))})`)
      .all(workspaceId, ...wsMessages.slice(0, 500))) as Array<{ id: string }>).map((r) => r.id);
    await purgeMessageNotifications(mine, userId);
  }
  await db.prepare('DELETE FROM talk_reminders WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
  await db.prepare('DELETE FROM talk_presence WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
  // Si vuelve al workspace arranca de cero (ensureGeneral lo suma otra vez a #general).
  await db.prepare('DELETE FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
  // Push sin entregar, resúmenes de IA guardados y secciones propias de este workspace.
  await db.prepare("DELETE FROM groups_notifications WHERE person_id = ? AND url LIKE '/app/talk/%' AND (user_id = ? OR url LIKE ?)").run(userId, workspaceId, `%&w=${workspaceId}&%`).catch(() => undefined);
  await db.prepare('DELETE FROM talk_ai_summaries WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
  await db.prepare('DELETE FROM talk_sections WHERE workspace_id = ? AND user_id = ?').run(workspaceId, userId);
  await db.prepare('DELETE FROM talk_huddle_peers WHERE user_id = ? AND huddle_id IN (SELECT id FROM talk_huddles WHERE workspace_id = ?)').run(userId, workspaceId);
  for (const c of channels) await emitTalkEvent(workspaceId, 'channel', { channelId: c.id, payload: { change: 'members' } });
  // Sus conexiones de tiempo real abiertas se cortan al recibir esto (lib/talk-realtime.ts).
  await emitTalkEvent(workspaceId, 'access', { userId, payload: { change: 'removed' } });
}

// ---------- Canales ----------

export type TalkChannelKind = 'public' | 'private' | 'dm' | 'group';

export interface TalkChannelRow {
  id: string;
  workspace_id: string;
  kind: TalkChannelKind;
  name: string;
  topic: string;
  description: string;
  dm_key: string | null;
  created_by: string | null;
  archived_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TalkMemberRow {
  channel_id: string;
  user_id: string;
  role: 'admin' | 'member';
  last_read_at: string | null;
  notify: 'default' | 'all' | 'mentions' | 'none';
  starred: number;
  hidden: number;
  joined_at: string;
}

export interface TalkChannelDto {
  id: string;
  kind: TalkChannelKind;
  name: string;
  topic: string;
  description: string;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  memberCount: number;
  /** DMs y grupos: las personas (sin contarme). */
  memberIds: string[];
  /** DMs y grupos: personas que ya no están en el workspace. */
  inactiveIds: string[];
  /** DM con alguien que salió del workspace: se lee, no se escribe. */
  deactivated: boolean;
  isMember: boolean;
  role: 'admin' | 'member' | null;
  starred: boolean;
  notify: TalkMemberRow['notify'];
  lastReadAt: string | null;
  unread: boolean;
  mentions: number;
  canManage: boolean;
}

export async function getChannelRow(workspaceId: string, id: string): Promise<TalkChannelRow | null> {
  const row = (await getDb().prepare('SELECT * FROM talk_channels WHERE id = ? AND workspace_id = ?').get(id, workspaceId)) as TalkChannelRow | undefined;
  return row ?? null;
}

export async function getMembership(channelId: string, personId: string): Promise<TalkMemberRow | null> {
  const row = (await getDb().prepare('SELECT * FROM talk_members WHERE channel_id = ? AND user_id = ?').get(channelId, personId)) as TalkMemberRow | undefined;
  return row ?? null;
}

export interface ChannelAccess {
  channel: TalkChannelRow;
  member: TalkMemberRow | null;
}

/** El canal si la persona lo puede leer (público, o miembro). Si no, null (404: no se revela que existe). */
export async function readableChannel(actor: TalkActor, id: string): Promise<ChannelAccess | null> {
  const channel = await getChannelRow(actor.workspaceId, id);
  if (!channel) return null;
  // Solo personas actuales del workspace (un aviso o un cron no puede leer por alguien que salió).
  const kind = await workspacePersonKind(actor.workspaceId, actor.personId);
  if (!kind) return null;
  const member = await getMembership(id, actor.personId);
  // Un invitado solo lee los canales donde está (ni los públicos).
  if (!member && (channel.kind !== 'public' || kind === 'guest')) return null;
  return { channel, member };
}

/** Puede escribir: miembro y canal sin archivar. */
export async function writableChannel(actor: TalkActor, id: string): Promise<ChannelAccess> {
  const access = await readableChannel(actor, id);
  if (!access) throw new TalkError('not_found', 404);
  if (access.channel.archived_at) throw new TalkError('channel_archived', 409);
  if (!access.member) throw new TalkError('not_member', 403);
  if (access.channel.kind === 'dm') {
    const other = (await getDb().prepare('SELECT user_id FROM talk_members WHERE channel_id = ? AND user_id != ?').get(id, actor.personId)) as { user_id: string } | undefined;
    if (other && !(await isWorkspacePerson(actor.workspaceId, other.user_id))) throw new TalkError('dm_deactivated', 409);
  }
  return access;
}

/** Renombrar, archivar, borrar: quien lo creó, un admin del canal o un admin del workspace. */
export function canManageChannel(actor: TalkActor, channel: TalkChannelRow, member: TalkMemberRow | null): boolean {
  if (channel.kind === 'dm' || channel.kind === 'group') return false;
  if (actor.guest) return false;
  if (roleAtLeast(actor.role, 'admin')) return true;
  return channel.created_by === actor.personId || member?.role === 'admin';
}

const CHANNEL_DTO_SQL = `
  SELECT c.*,
    m.user_id AS m_user, m.role AS m_role, m.last_read_at AS m_read, m.notify AS m_notify, m.starred AS m_starred, m.hidden AS m_hidden,
    (SELECT COUNT(*) FROM talk_members mm WHERE mm.channel_id = c.id) AS member_count,
    (SELECT group_concat(mm.user_id) FROM talk_members mm WHERE mm.channel_id = c.id AND c.kind IN ('dm', 'group') AND mm.user_id != ?) AS others,
    (SELECT group_concat(mm.user_id) FROM talk_members mm WHERE mm.channel_id = c.id AND c.kind IN ('dm', 'group') AND mm.user_id != c.workspace_id
       AND mm.user_id NOT IN (SELECT tm.user_id FROM team_members tm JOIN teams tt ON tt.id = tm.team_id WHERE tt.owner_id = c.workspace_id AND tm.role != 'guest')
       AND mm.user_id NOT IN (SELECT g.user_id FROM talk_guests g WHERE g.workspace_id = c.workspace_id)) AS gone,
    CASE WHEN m.user_id IS NULL THEN 0 ELSE EXISTS (
      SELECT 1 FROM talk_messages x WHERE x.channel_id = c.id AND (x.parent_id IS NULL OR x.also_in_channel = 1)
        AND x.deleted_at IS NULL AND (x.user_id IS NULL OR x.user_id != ?) AND x.created_at > COALESCE(m.last_read_at, '')
    ) END AS unread,
    CASE WHEN m.user_id IS NULL THEN 0 ELSE (
      SELECT COUNT(*) FROM talk_messages x WHERE x.channel_id = c.id AND (x.parent_id IS NULL OR x.also_in_channel = 1)
        AND x.deleted_at IS NULL AND (x.user_id IS NULL OR x.user_id != ?) AND x.created_at > COALESCE(m.last_read_at, '')
        AND (c.kind IN ('dm', 'group') OR x.mentions LIKE '%"' || ? || '"%' OR x.broadcast IS NOT NULL)
    ) END AS mention_count
  FROM talk_channels c
  LEFT JOIN talk_members m ON m.channel_id = c.id AND m.user_id = ?`;

type ChannelJoinRow = TalkChannelRow & {
  m_user: string | null;
  m_role: 'admin' | 'member' | null;
  m_read: string | null;
  m_notify: TalkMemberRow['notify'] | null;
  m_starred: number | null;
  m_hidden: number | null;
  member_count: number;
  others: string | null;
  gone: string | null;
  unread: number;
  mention_count: number;
};

function channelArgs(actor: TalkActor): string[] {
  return [actor.personId, actor.personId, actor.personId, actor.personId, actor.personId];
}

function toChannelDto(actor: TalkActor, r: ChannelJoinRow): TalkChannelDto {
  const member = r.m_user ? ({ role: r.m_role, created_by: r.created_by } as unknown as TalkMemberRow) : null;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    topic: r.topic,
    description: r.description,
    archived: !!r.archived_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
    memberCount: Number(r.member_count),
    memberIds: r.others ? r.others.split(',') : [],
    inactiveIds: r.gone ? r.gone.split(',') : [],
    deactivated: r.kind === 'dm' && !!r.gone,
    isMember: !!r.m_user,
    role: r.m_role,
    starred: !!r.m_starred,
    notify: r.m_notify ?? 'default',
    lastReadAt: r.m_read,
    unread: !!Number(r.unread),
    mentions: Number(r.mention_count) || 0,
    canManage: canManageChannel(actor, r, member),
  };
}

/** Canales del sidebar: donde soy miembro (sin los DMs que cerré, salvo que tengan algo nuevo). */
export async function listMyChannels(actor: TalkActor): Promise<TalkChannelDto[]> {
  // Sin Talk en este workspace (salió, o le sacaron la app): nada.
  if (!(await workspacePersonKind(actor.workspaceId, actor.personId))) return [];
  const rows = (await getDb()
    .prepare(`${CHANNEL_DTO_SQL} WHERE c.workspace_id = ? AND m.user_id IS NOT NULL AND c.archived_at IS NULL ORDER BY c.kind IN ('dm', 'group'), c.name, c.last_message_at DESC`)
    .all(...channelArgs(actor), actor.workspaceId)) as ChannelJoinRow[];
  return rows
    .filter((r) => !(r.m_hidden && !Number(r.unread)))
    .map((r) => toChannelDto(actor, r));
}

export async function getChannelDto(actor: TalkActor, id: string): Promise<TalkChannelDto | null> {
  const row = (await getDb()
    .prepare(`${CHANNEL_DTO_SQL} WHERE c.workspace_id = ? AND c.id = ?`)
    .get(...channelArgs(actor), actor.workspaceId, id)) as ChannelJoinRow | undefined;
  if (!row) return null;
  if (!row.m_user && (row.kind !== 'public' || actor.guest)) return null;
  return toChannelDto(actor, row);
}

/** Directorio de canales: los públicos (y los privados donde estoy), con búsqueda. */
export async function browseChannels(actor: TalkActor, opts: { q?: string; archived?: boolean } = {}): Promise<TalkChannelDto[]> {
  if (!(await workspacePersonKind(actor.workspaceId, actor.personId))) return [];
  const where = [
    'c.workspace_id = ?',
    actor.guest ? "(c.kind IN ('public', 'private') AND m.user_id IS NOT NULL)" : "(c.kind = 'public' OR (c.kind = 'private' AND m.user_id IS NOT NULL))",
  ];
  const args: Array<string> = [actor.workspaceId];
  where.push(opts.archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL');
  if (opts.q?.trim()) {
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.topic LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    args.push(like, like, like);
  }
  const rows = (await getDb()
    .prepare(`${CHANNEL_DTO_SQL} WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT 500`)
    .all(...channelArgs(actor), ...args)) as ChannelJoinRow[];
  return rows.map((r) => toChannelDto(actor, r));
}

/** #general: lo crea la primera persona que entra a Talk; todas se suman al entrar por primera vez. */
export async function ensureGeneral(actor: TalkActor): Promise<void> {
  const db = getDb();
  const first = !(await db.prepare('SELECT 1 AS x FROM talk_prefs WHERE workspace_id = ? AND user_id = ?').get(actor.workspaceId, actor.personId));
  if (!first) return;
  await db.prepare('INSERT OR IGNORE INTO talk_prefs (workspace_id, user_id) VALUES (?, ?)').run(actor.workspaceId, actor.personId);
  // Un invitado entra solo a los canales a los que lo invitaron.
  if (actor.guest || (await workspacePersonKind(actor.workspaceId, actor.personId)) === 'guest') return;
  let general = (await db
    .prepare("SELECT id FROM talk_channels WHERE workspace_id = ? AND kind = 'public' AND name = 'general'")
    .get(actor.workspaceId)) as { id: string } | undefined;
  if (!general) {
    const id = crypto.randomUUID();
    const now = nowIso();
    await db
      .prepare(
        "INSERT OR IGNORE INTO talk_channels (id, workspace_id, kind, name, topic, description, created_by, created_at, updated_at) VALUES (?, ?, 'public', 'general', '', '', ?, ?, ?)",
      )
      .run(id, actor.workspaceId, actor.personId, now, now);
    general = (await db
      .prepare("SELECT id FROM talk_channels WHERE workspace_id = ? AND kind = 'public' AND name = 'general'")
      .get(actor.workspaceId)) as { id: string } | undefined;
  }
  if (general) await addMembers(general.id, [actor.personId]);
}

export async function addMembers(channelId: string, userIds: string[], role: 'admin' | 'member' = 'member'): Promise<void> {
  const db = getDb();
  const now = nowIso();
  for (const uid of userIds) {
    await db
      .prepare('INSERT OR IGNORE INTO talk_members (channel_id, user_id, role, last_read_at, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(channelId, uid, role, now, now);
  }
}

export interface CreateChannelInput {
  name: string;
  kind: 'public' | 'private';
  topic?: string;
  description?: string;
  memberIds?: string[];
}

export async function createChannel(actor: TalkActor, input: CreateChannelInput): Promise<TalkChannelDto> {
  if (actor.guest || (await workspacePersonKind(actor.workspaceId, actor.personId)) !== 'member') throw new TalkError('forbidden', 403);
  const name = normalizeChannelName(input.name);
  if (!name) throw new TalkError('invalid_name');
  const db = getDb();
  const taken = await db
    .prepare("SELECT 1 AS x FROM talk_channels WHERE workspace_id = ? AND kind IN ('public', 'private') AND name = ?")
    .get(actor.workspaceId, name);
  if (taken) throw new TalkError('name_taken', 409);
  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    await db
      .prepare(
        'INSERT INTO talk_channels (id, workspace_id, kind, name, topic, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, actor.workspaceId, input.kind, name, (input.topic ?? '').slice(0, 250), (input.description ?? '').slice(0, 1000), actor.personId, now, now);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new TalkError('name_taken', 409);
    throw err;
  }
  await addMembers(id, [actor.personId], 'admin');
  const others = await validPeople(actor.workspaceId, (input.memberIds ?? []).filter((m) => m !== actor.personId), { actor, channel: true });
  if (others.length) await addMembers(id, others);
  await emitTalkEvent(actor.workspaceId, 'channel', { channelId: id, actorId: actor.personId, payload: { change: 'created' } });
  return (await getChannelDto(actor, id))!;
}

/**
 * Personas válidas para sumar. Sumar un invitado a un canal es cosa de un
 * admin del workspace (como en Slack); un invitado solo abre DMs con quienes
 * comparte algún canal.
 */
async function validPeople(workspaceId: string, ids: string[], opts: { actor?: TalkActor; channel?: boolean; dm?: boolean } = {}): Promise<string[]> {
  const list = await listTalkPeople(workspaceId);
  const people = new Map(list.map((p) => [p.id, p]));
  const bad = ids.filter((id) => !people.has(id));
  if (bad.length) throw new TalkError('invalid_member');
  const actor = opts.actor;
  if (actor && opts.channel && ids.some((id) => people.get(id)?.guest) && !roleAtLeast(actor.role, 'admin')) throw new TalkError('guest_admin_only', 403);
  if (actor && opts.dm && (actor.guest || people.get(actor.personId)?.guest)) {
    const shared = await sharedPeople(actor);
    if (ids.some((id) => !shared.has(id))) throw new TalkError('invalid_member');
  }
  return [...new Set(ids)];
}

/** Personas que comparten al menos un canal o DM con esta persona (lo que ve un invitado). */
export async function sharedPeople(actor: TalkActor): Promise<Set<string>> {
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT o.user_id FROM talk_members me JOIN talk_channels c ON c.id = me.channel_id AND c.workspace_id = ?
       JOIN talk_members o ON o.channel_id = me.channel_id WHERE me.user_id = ?`,
    )
    .all(actor.workspaceId, actor.personId)) as Array<{ user_id: string }>;
  const set = new Set(rows.map((r) => r.user_id));
  set.add(actor.personId);
  return set;
}

/** Abre (o crea) el DM con estas personas. Una sola persona = DM 1:1; yo solo = DM conmigo. Hasta 9 más. */
export async function openDm(actor: TalkActor, userIds: string[]): Promise<TalkChannelDto> {
  const others = await validPeople(actor.workspaceId, userIds.filter((u) => u !== actor.personId), { actor, dm: true });
  // Como Slack: hasta 9 personas más vos.
  if (others.length > 9) throw new TalkError('too_many_members');
  const all = [...new Set([actor.personId, ...others])].sort();
  const key = all.join(',');
  const kind: TalkChannelKind = all.length > 2 ? 'group' : 'dm';
  const db = getDb();
  let row = (await db.prepare('SELECT id FROM talk_channels WHERE workspace_id = ? AND dm_key = ?').get(actor.workspaceId, key)) as { id: string } | undefined;
  if (!row) {
    const id = crypto.randomUUID();
    const now = nowIso();
    await db
      .prepare('INSERT OR IGNORE INTO talk_channels (id, workspace_id, kind, name, dm_key, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, actor.workspaceId, kind, '', key, actor.personId, now, now);
    row = (await db.prepare('SELECT id FROM talk_channels WHERE workspace_id = ? AND dm_key = ?').get(actor.workspaceId, key)) as { id: string };
    await addMembers(row.id, all);
  }
  await db.prepare('UPDATE talk_members SET hidden = 0 WHERE channel_id = ? AND user_id = ?').run(row.id, actor.personId);
  return (await getChannelDto(actor, row.id))!;
}

export interface UpdateChannelInput {
  name?: string;
  topic?: string;
  description?: string;
  archived?: boolean;
  kind?: 'private';
}

export async function updateChannel(actor: TalkActor, id: string, input: UpdateChannelInput): Promise<TalkChannelDto> {
  const access = await readableChannel(actor, id);
  if (!access) throw new TalkError('not_found', 404);
  const { channel, member } = access;
  const db = getDb();
  const now = nowIso();
  const manage = canManageChannel(actor, channel, member);
  if (input.topic !== undefined || input.description !== undefined) {
    // Tema y descripción: cualquier miembro (como en Slack); en DMs también el tema.
    if (!member) throw new TalkError('not_member', 403);
    if (channel.archived_at) throw new TalkError('channel_archived', 409);
    if (input.topic !== undefined) await db.prepare('UPDATE talk_channels SET topic = ?, updated_at = ? WHERE id = ?').run(input.topic.slice(0, 250), now, id);
    if (input.description !== undefined) await db.prepare('UPDATE talk_channels SET description = ?, updated_at = ? WHERE id = ?').run(input.description.slice(0, 1000), now, id);
  }
  if (input.name !== undefined) {
    if (!manage) throw new TalkError('forbidden', 403);
    const name = normalizeChannelName(input.name);
    if (!name) throw new TalkError('invalid_name');
    if (channel.name === 'general' && channel.kind === 'public' && name !== 'general') throw new TalkError('general_locked', 409);
    const taken = await db
      .prepare("SELECT 1 AS x FROM talk_channels WHERE workspace_id = ? AND kind IN ('public', 'private') AND name = ? AND id != ?")
      .get(actor.workspaceId, name, id);
    if (taken) throw new TalkError('name_taken', 409);
    await db.prepare('UPDATE talk_channels SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
  }
  if (input.kind === 'private') {
    if (!manage || channel.kind !== 'public') throw new TalkError('forbidden', 403);
    if (channel.name === 'general') throw new TalkError('general_locked', 409);
    await db.prepare("UPDATE talk_channels SET kind = 'private', updated_at = ? WHERE id = ?").run(now, id);
    // Quien no es miembro deja de verlo: fuera sus avisos, recordatorios y guardados de ese canal.
    const outsiders = (await db
      .prepare(
        `SELECT DISTINCT user_id FROM (
           SELECT n.user_id FROM notifications n JOIN talk_messages m ON m.id = n.source_id WHERE n.source_type = 'talk_message' AND m.channel_id = ?
           UNION SELECT s.user_id FROM talk_saved s JOIN talk_messages m ON m.id = s.message_id WHERE m.channel_id = ?
           UNION SELECT r.user_id FROM talk_reminders r JOIN talk_messages m ON m.id = r.message_id WHERE m.channel_id = ?
           UNION SELECT f.user_id FROM talk_thread_follows f JOIN talk_messages m ON m.id = f.message_id WHERE m.channel_id = ?
         ) WHERE user_id NOT IN (SELECT user_id FROM talk_members WHERE channel_id = ?)`,
      )
      .all(id, id, id, id, id)) as Array<{ user_id: string }>;
    for (const o of outsiders) await purgeChannelFor(id, o.user_id);
  }
  if (input.archived !== undefined) {
    if (!manage) throw new TalkError('forbidden', 403);
    if (channel.name === 'general' && channel.kind === 'public') throw new TalkError('general_locked', 409);
    await db.prepare('UPDATE talk_channels SET archived_at = ?, updated_at = ? WHERE id = ?').run(input.archived ? now : null, now, id);
  }
  await emitTalkEvent(actor.workspaceId, 'channel', { channelId: id, actorId: actor.personId, payload: { change: 'updated' } });
  return (await getChannelDto(actor, id))!;
}

/** Borra el canal con todos sus mensajes y archivos. Solo quien lo puede administrar; #general no. */
export async function deleteChannel(actor: TalkActor, id: string): Promise<{ fileUrls: string[] }> {
  const access = await readableChannel(actor, id);
  if (!access) throw new TalkError('not_found', 404);
  if (!canManageChannel(actor, access.channel, access.member)) throw new TalkError('forbidden', 403);
  if (access.channel.name === 'general' && access.channel.kind === 'public') throw new TalkError('general_locked', 409);
  const db = getDb();
  const files = (await db.prepare('SELECT url FROM talk_files WHERE channel_id = ?').all(id)) as Array<{ url: string }>;
  const ids = ((await db.prepare('SELECT id FROM talk_messages WHERE channel_id = ?').all(id)) as Array<{ id: string }>).map((r) => r.id);
  await purgeMessageNotifications(ids);
  await db.prepare('DELETE FROM talk_events WHERE channel_id = ?').run(id);
  await db.prepare('DELETE FROM talk_channels WHERE id = ?').run(id);
  await emitTalkEvent(actor.workspaceId, 'channel', { channelId: null, actorId: actor.personId, payload: { change: 'deleted', id } });
  return { fileUrls: files.map((f) => f.url) };
}

export async function joinChannel(actor: TalkActor, id: string): Promise<TalkChannelDto> {
  const access = await readableChannel(actor, id);
  if (!access) throw new TalkError('not_found', 404);
  if (access.channel.archived_at) throw new TalkError('channel_archived', 409);
  if (access.channel.kind !== 'public') throw new TalkError('forbidden', 403);
  await addMembers(id, [actor.personId]);
  await emitTalkEvent(actor.workspaceId, 'channel', { channelId: id, actorId: actor.personId, payload: { change: 'members' } });
  return (await getChannelDto(actor, id))!;
}

/** Sumar personas (miembros del canal; en privados igual que en Slack: cualquiera que esté). */
export async function inviteMembers(actor: TalkActor, id: string, userIds: string[]): Promise<TalkChannelDto> {
  const { channel } = await writableChannel(actor, id);
  if (channel.kind === 'dm' || channel.kind === 'group' || actor.guest) throw new TalkError('forbidden', 403);
  const ids = await validPeople(actor.workspaceId, userIds, { actor, channel: true });
  await addMembers(id, ids);
  await emitTalkEvent(actor.workspaceId, 'channel', { channelId: id, actorId: actor.personId, payload: { change: 'members' } });
  return (await getChannelDto(actor, id))!;
}

/** Salir (yo) o sacar a alguien (quien administra el canal). En #general no se sale. DMs se cierran (ocultan). */
export async function removeMember(actor: TalkActor, id: string, userId: string): Promise<void> {
  const access = await readableChannel(actor, id);
  if (!access || !access.member) throw new TalkError('not_found', 404);
  const { channel } = access;
  const db = getDb();
  if (channel.kind === 'dm' || channel.kind === 'group') {
    if (userId !== actor.personId) throw new TalkError('forbidden', 403);
    await db.prepare('UPDATE talk_members SET hidden = 1 WHERE channel_id = ? AND user_id = ?').run(id, userId);
    return;
  }
  if (channel.name === 'general' && channel.kind === 'public') throw new TalkError('general_locked', 409);
  if (userId !== actor.personId && !canManageChannel(actor, channel, access.member)) throw new TalkError('forbidden', 403);
  await db.prepare('DELETE FROM talk_members WHERE channel_id = ? AND user_id = ?').run(id, userId);
  // En un privado deja de poder leer: fuera lo que tenía de ahí (avisos con texto, recordatorios…).
  // Un invitado tampoco lee los públicos donde no está.
  if (channel.kind === 'private' || (await workspacePersonKind(actor.workspaceId, userId)) === 'guest') await purgeChannelFor(id, userId);
  await emitTalkEvent(actor.workspaceId, 'channel', { channelId: id, actorId: actor.personId, payload: { change: 'members' } });
  // Quien sale deja de recibir eventos del canal (si es privado): el aviso le llega por su cuenta.
  await emitTalkEvent(actor.workspaceId, 'channel', { userId, actorId: actor.personId, payload: { change: 'left', id } });
}

export async function listChannelMembers(actor: TalkActor, id: string): Promise<Array<{ userId: string; role: string; joinedAt: string }>> {
  const access = await readableChannel(actor, id);
  if (!access) throw new TalkError('not_found', 404);
  const rows = (await getDb()
    .prepare('SELECT user_id, role, joined_at FROM talk_members WHERE channel_id = ? ORDER BY role = \'admin\' DESC, joined_at')
    .all(id)) as Array<{ user_id: string; role: string; joined_at: string }>;
  return rows.map((r) => ({ userId: r.user_id, role: r.role, joinedAt: r.joined_at }));
}

export async function updateMemberPrefs(actor: TalkActor, id: string, input: { starred?: boolean; notify?: TalkMemberRow['notify'] }): Promise<void> {
  const access = await readableChannel(actor, id);
  if (!access?.member) throw new TalkError('not_found', 404);
  const db = getDb();
  if (input.starred !== undefined) await db.prepare('UPDATE talk_members SET starred = ? WHERE channel_id = ? AND user_id = ?').run(input.starred ? 1 : 0, id, actor.personId);
  if (input.notify !== undefined) await db.prepare('UPDATE talk_members SET notify = ? WHERE channel_id = ? AND user_id = ?').run(input.notify, id, actor.personId);
  await emitTalkEvent(actor.workspaceId, 'read', { userId: actor.personId, channelId: null, payload: { channelId: id } });
}

/** Marca leído hasta `at` (por defecto, ahora). También sirve para "marcar como no leído desde acá". */
export async function markRead(actor: TalkActor, id: string, at?: string | null): Promise<void> {
  const access = await readableChannel(actor, id);
  if (!access?.member) throw new TalkError('not_found', 404);
  const when = at ?? nowIso();
  await getDb().prepare('UPDATE talk_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?').run(when, id, actor.personId);
  await emitTalkEvent(actor.workspaceId, 'read', { userId: actor.personId, payload: { channelId: id, at: when } });
}

export async function markAllRead(actor: TalkActor): Promise<void> {
  const now = nowIso();
  await getDb()
    .prepare('UPDATE talk_members SET last_read_at = ? WHERE user_id = ? AND channel_id IN (SELECT id FROM talk_channels WHERE workspace_id = ?)')
    .run(now, actor.personId, actor.workspaceId);
  await emitTalkEvent(actor.workspaceId, 'read', { userId: actor.personId, payload: { all: true } });
}

// ---------- Mensajes ----------

export interface TalkFileDto {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface TalkUnfurl {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site?: string;
}

export interface TalkReactionDto {
  emoji: string;
  count: number;
  mine: boolean;
  users: string[];
}

export interface TalkMessageRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  user_id: string | null;
  bot_name: string | null;
  parent_id: string | null;
  body: string;
  files: string;
  unfurls: string;
  mentions: string;
  broadcast: string | null;
  also_in_channel: number;
  reply_count: number;
  reply_users: string;
  last_reply_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  created_at: string;
}

export interface TalkMessageDto {
  id: string;
  channelId: string;
  parentId: string | null;
  userId: string | null;
  botName: string | null;
  body: string;
  files: TalkFileDto[];
  unfurls: TalkUnfurl[];
  reactions: TalkReactionDto[];
  replyCount: number;
  replyUsers: string[];
  lastReplyAt: string | null;
  alsoInChannel: boolean;
  editedAt: string | null;
  deleted: boolean;
  pinned: boolean;
  saved: boolean;
  createdAt: string;
  /** Vista previa rica de Track, CRM o Docs, según lo que esta persona puede ver. */
  refs: import('./talk-unfurl').TalkRefCard[];
}

export const MESSAGE_MAX = 12_000;

export async function getMessageRow(workspaceId: string, id: string): Promise<TalkMessageRow | null> {
  const row = (await getDb().prepare('SELECT * FROM talk_messages WHERE id = ? AND workspace_id = ?').get(id, workspaceId)) as TalkMessageRow | undefined;
  return row ?? null;
}

/** El mensaje si su canal es legible para la persona. */
export async function readableMessage(actor: TalkActor, id: string): Promise<{ message: TalkMessageRow; access: ChannelAccess } | null> {
  const message = await getMessageRow(actor.workspaceId, id);
  if (!message) return null;
  const access = await readableChannel(actor, message.channel_id);
  if (!access) return null;
  return { message, access };
}

/** Filas → DTOs para esta persona (reacciones, archivos, guardado, refs). */
export async function toMessageDtos(actor: TalkActor, rows: TalkMessageRow[]): Promise<TalkMessageDto[]> {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const [reactions, saved, files] = await Promise.all([
    db.prepare(`SELECT message_id, emoji, user_id FROM talk_reactions WHERE message_id IN (${inList(ids.length)}) ORDER BY created_at`).all(...ids) as Promise<
      Array<{ message_id: string; emoji: string; user_id: string }>
    >,
    db.prepare(`SELECT message_id FROM talk_saved WHERE user_id = ? AND done_at IS NULL AND message_id IN (${inList(ids.length)})`).all(actor.personId, ...ids) as Promise<
      Array<{ message_id: string }>
    >,
    db.prepare(`SELECT id, message_id, name, mime, size FROM talk_files WHERE message_id IN (${inList(ids.length)}) ORDER BY created_at`).all(...ids) as Promise<
      Array<{ id: string; message_id: string; name: string; mime: string; size: number }>
    >,
  ]);
  const savedSet = new Set(saved.map((s) => s.message_id));
  const reactBy = new Map<string, TalkReactionDto[]>();
  for (const r of reactions) {
    const list = reactBy.get(r.message_id) ?? [];
    let entry = list.find((e) => e.emoji === r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji, count: 0, mine: false, users: [] };
      list.push(entry);
    }
    entry.count += 1;
    entry.users.push(r.user_id);
    if (r.user_id === actor.personId) entry.mine = true;
    reactBy.set(r.message_id, list);
  }
  const filesBy = new Map<string, TalkFileDto[]>();
  for (const f of files) {
    const list = filesBy.get(f.message_id) ?? [];
    list.push({ id: f.id, name: f.name, mime: f.mime, size: Number(f.size), url: `/api/talk/files/${f.id}` });
    filesBy.set(f.message_id, list);
  }
  const { resolveRefs } = await import('./talk-unfurl');
  const refs = await resolveRefs(actor, rows.filter((r) => !r.deleted_at).map((r) => ({ id: r.id, body: r.body })));
  return rows.map((r) => {
    const deleted = !!r.deleted_at;
    return {
      id: r.id,
      channelId: r.channel_id,
      parentId: r.parent_id,
      userId: r.user_id,
      botName: r.bot_name,
      body: deleted ? '' : r.body,
      files: deleted ? [] : (filesBy.get(r.id) ?? []),
      unfurls: deleted ? [] : parseJson<TalkUnfurl[]>(r.unfurls, []),
      reactions: deleted ? [] : (reactBy.get(r.id) ?? []),
      replyCount: Number(r.reply_count),
      replyUsers: parseJson<string[]>(r.reply_users, []),
      lastReplyAt: r.last_reply_at,
      alsoInChannel: !!r.also_in_channel,
      editedAt: r.edited_at,
      deleted,
      pinned: !!r.pinned_at,
      saved: savedSet.has(r.id),
      createdAt: r.created_at,
      refs: deleted ? [] : (refs.get(r.id) ?? []),
    };
  });
}

export interface ListMessagesOptions {
  before?: string | null;
  after?: string | null;
  /** Centra la página en este mensaje (link a un mensaje, resultado de búsqueda). */
  around?: string | null;
  limit?: number;
}

const CHANNEL_LEVEL = '(parent_id IS NULL OR also_in_channel = 1) AND (deleted_at IS NULL OR reply_count > 0)';

/** Mensajes del canal (los de nivel canal), en orden cronológico. */
export async function listChannelMessages(
  actor: TalkActor,
  channelId: string,
  opts: ListMessagesOptions = {},
): Promise<{ messages: TalkMessageDto[]; hasMoreBefore: boolean; hasMoreAfter: boolean }> {
  const access = await readableChannel(actor, channelId);
  if (!access) throw new TalkError('not_found', 404);
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let rows: TalkMessageRow[];
  let hasMoreBefore = false;
  let hasMoreAfter = false;
  if (opts.around) {
    const target = (await db.prepare('SELECT created_at FROM talk_messages WHERE id = ? AND channel_id = ?').get(opts.around, channelId)) as { created_at: string } | undefined;
    if (!target) return listChannelMessages(actor, channelId, { limit });
    const half = Math.floor(limit / 2);
    const older = (await db
      .prepare(`SELECT * FROM talk_messages WHERE channel_id = ? AND ${CHANNEL_LEVEL} AND created_at < ? ORDER BY created_at DESC LIMIT ?`)
      .all(channelId, target.created_at, half + 1)) as TalkMessageRow[];
    const newer = (await db
      .prepare(`SELECT * FROM talk_messages WHERE channel_id = ? AND ${CHANNEL_LEVEL} AND created_at >= ? ORDER BY created_at ASC LIMIT ?`)
      .all(channelId, target.created_at, half + 1)) as TalkMessageRow[];
    hasMoreBefore = older.length > half;
    hasMoreAfter = newer.length > half;
    rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half)];
  } else if (opts.after) {
    rows = (await db
      .prepare(`SELECT * FROM talk_messages WHERE channel_id = ? AND ${CHANNEL_LEVEL} AND created_at > ? ORDER BY created_at ASC LIMIT ?`)
      .all(channelId, opts.after, limit + 1)) as TalkMessageRow[];
    hasMoreAfter = rows.length > limit;
    rows = rows.slice(0, limit);
  } else {
    const before = opts.before ?? '9999';
    rows = (await db
      .prepare(`SELECT * FROM talk_messages WHERE channel_id = ? AND ${CHANNEL_LEVEL} AND created_at < ? ORDER BY created_at DESC LIMIT ?`)
      .all(channelId, before, limit + 1)) as TalkMessageRow[];
    hasMoreBefore = rows.length > limit;
    rows = rows.slice(0, limit).reverse();
  }
  return { messages: await toMessageDtos(actor, rows), hasMoreBefore, hasMoreAfter };
}

/** Un hilo: el mensaje raíz y sus respuestas. */
export async function getThread(actor: TalkActor, rootId: string): Promise<{ root: TalkMessageDto; replies: TalkMessageDto[]; following: boolean }> {
  const found = await readableMessage(actor, rootId);
  if (!found || found.message.parent_id) throw new TalkError('not_found', 404);
  const replies = (await getDb()
    .prepare('SELECT * FROM talk_messages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1000')
    .all(rootId)) as TalkMessageRow[];
  const [root, ...rest] = await toMessageDtos(actor, [found.message, ...replies]);
  const follow = await getDb().prepare('SELECT 1 AS x FROM talk_thread_follows WHERE message_id = ? AND user_id = ?').get(rootId, actor.personId);
  return { root, replies: rest, following: !!follow };
}

export async function getMessageDtos(actor: TalkActor, ids: string[]): Promise<TalkMessageDto[]> {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return [];
  const rows = (await getDb()
    .prepare(`SELECT * FROM talk_messages WHERE workspace_id = ? AND id IN (${inList(unique.length)})`)
    .all(actor.workspaceId, ...unique)) as TalkMessageRow[];
  const out: TalkMessageRow[] = [];
  const cache = new Map<string, boolean>();
  for (const r of rows) {
    if (!cache.has(r.channel_id)) cache.set(r.channel_id, !!(await readableChannel(actor, r.channel_id)));
    if (cache.get(r.channel_id)) out.push(r);
  }
  return toMessageDtos(actor, out);
}

export interface PostMessageInput {
  channelId: string;
  body: string;
  parentId?: string | null;
  alsoInChannel?: boolean;
  fileIds?: string[];
  /** Mensajes de integraciones (webhook entrante, Flow, API) sin persona. */
  botName?: string | null;
  /** Lo manda el cron de programados. */
  scheduled?: boolean;
}

export interface PostResult {
  message: TalkMessageDto;
  row: TalkMessageRow;
  channel: TalkChannelRow;
}

/**
 * Publica un mensaje. `actor.personId` tiene que ser miembro (las
 * integraciones pasan `asBot` con el owner como persona y botName).
 * Después: avisos (lib/talk-notify.ts), vista previa de links, evento de
 * Flow/webhooks y el evento del tiempo real.
 */
export async function postMessage(actor: TalkActor, input: PostMessageInput, opts: { asBot?: boolean } = {}): Promise<PostResult> {
  const body = input.body.replace(/\s+$/, '');
  const fileIds = [...new Set(input.fileIds ?? [])].slice(0, 10);
  if (!body.trim() && !fileIds.length) throw new TalkError('empty_message');
  if (body.length > MESSAGE_MAX) throw new TalkError('message_too_long');
  const db = getDb();
  let channel: TalkChannelRow;
  if (opts.asBot) {
    const row = await getChannelRow(actor.workspaceId, input.channelId);
    if (!row) throw new TalkError('not_found', 404);
    if (row.archived_at) throw new TalkError('channel_archived', 409);
    channel = row;
  } else {
    channel = (await writableChannel(actor, input.channelId)).channel;
  }
  let parent: TalkMessageRow | null = null;
  let threadState: { replyCount: number; replyUsers: string[]; lastReplyAt: string } | null = null;
  if (input.parentId) {
    parent = await getMessageRow(actor.workspaceId, input.parentId);
    if (!parent || parent.channel_id !== channel.id || parent.parent_id) throw new TalkError('invalid_parent');
    if (parent.deleted_at && parent.reply_count === 0) throw new TalkError('invalid_parent');
  }
  if (fileIds.length) {
    const own = (await db
      .prepare(`SELECT id FROM talk_files WHERE id IN (${inList(fileIds.length)}) AND channel_id = ? AND user_id = ? AND message_id IS NULL`)
      .all(...fileIds, channel.id, actor.personId)) as Array<{ id: string }>;
    if (own.length !== fileIds.length) throw new TalkError('invalid_file');
  }
  const mentions = extractMentions(body);
  // Los grupos mencionados se expanden a personas al guardar (los avisos y el contador de menciones los ven).
  const groupMembers: string[] = [];
  if (mentions.groups.length) {
    const groups = await listTalkGroups(actor.workspaceId);
    for (const g of groups) if (mentions.groups.includes(g.id)) groupMembers.push(...g.members);
  }
  const mentionIds = [...new Set([...mentions.users, ...groupMembers])];
  const broadcast = mentions.channel ? 'channel' : mentions.here ? 'here' : null;
  const id = crypto.randomUUID();
  // Orden estable: dos mensajes en el mismo milisegundo no empatan.
  let now = nowIso();
  // También después de quien se sumó en este mismo milisegundo (su "leído hasta" no tapa el mensaje).
  const last = (await db
    .prepare(
      `SELECT MAX(at) AS at FROM (
         SELECT MAX(created_at) AS at FROM talk_messages WHERE channel_id = ?
         UNION ALL SELECT MAX(joined_at) FROM talk_members WHERE channel_id = ? AND user_id != ?)`,
    )
    .get(channel.id, channel.id, actor.personId)) as { at: string | null } | undefined;
  if (last?.at && last.at >= now) now = new Date(new Date(last.at).getTime() + 1).toISOString();
  await db
    .prepare(
      `INSERT INTO talk_messages (id, workspace_id, channel_id, user_id, bot_name, parent_id, body, mentions, broadcast, also_in_channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      actor.workspaceId,
      channel.id,
      opts.asBot ? null : actor.personId,
      input.botName ?? null,
      parent?.id ?? null,
      body,
      JSON.stringify(mentionIds),
      broadcast,
      parent && input.alsoInChannel ? 1 : 0,
      now,
    );
  if (fileIds.length) {
    await db.prepare(`UPDATE talk_files SET message_id = ? WHERE id IN (${inList(fileIds.length)})`).run(id, ...fileIds);
  }
  if (!parent || input.alsoInChannel) {
    await db.prepare('UPDATE talk_channels SET last_message_at = ? WHERE id = ?').run(now, channel.id);
  }
  if (parent) {
    const users = parseJson<string[]>(parent.reply_users, []);
    if (!opts.asBot && !users.includes(actor.personId)) users.push(actor.personId);
    await db
      .prepare('UPDATE talk_messages SET reply_count = reply_count + 1, last_reply_at = ?, reply_users = ? WHERE id = ?')
      .run(now, JSON.stringify(users.slice(-10)), parent.id);
    threadState = { replyCount: Number(parent.reply_count) + 1, replyUsers: users.slice(-10), lastReplyAt: now };
    // Siguen el hilo: quien lo empezó, quien responde y las personas mencionadas.
    const followers = [parent.user_id, opts.asBot ? null : actor.personId, ...mentionIds].filter((u): u is string => !!u);
    for (const u of new Set(followers)) {
      await db.prepare('INSERT OR IGNORE INTO talk_thread_follows (message_id, user_id, last_read_at) VALUES (?, ?, NULL)').run(parent.id, u);
    }
    if (!opts.asBot) {
      await db.prepare('UPDATE talk_thread_follows SET last_read_at = ? WHERE message_id = ? AND user_id = ?').run(now, parent.id, actor.personId);
    }
  }
  if (!opts.asBot) {
    // Lo que escribo yo queda leído; el borrador de ese lugar se descarta.
    if (!parent || input.alsoInChannel) {
      await db.prepare('UPDATE talk_members SET last_read_at = ?, hidden = 0 WHERE channel_id = ? AND user_id = ? AND (last_read_at IS NULL OR last_read_at < ?)').run(now, channel.id, actor.personId, now);
    }
    await db.prepare('DELETE FROM talk_drafts WHERE user_id = ? AND channel_id = ? AND parent_id = ?').run(actor.personId, channel.id, parent?.id ?? '');
  }
  // Un DM cerrado vuelve a aparecer para todos cuando llega algo.
  if (channel.kind === 'dm' || channel.kind === 'group') {
    await db.prepare('UPDATE talk_members SET hidden = 0 WHERE channel_id = ?').run(channel.id);
  }
  const row = (await getMessageRow(actor.workspaceId, id))!;
  await emitTalkEvent(actor.workspaceId, 'message', {
    channelId: channel.id,
    actorId: opts.asBot ? null : actor.personId,
    payload: {
      id,
      parentId: parent?.id ?? null,
      alsoInChannel: !!(parent && input.alsoInChannel),
      change: 'new',
      at: now,
      mentions: mentionIds,
      broadcast,
      // Hilos: quiénes lo siguen (para "Hilos" sin leer).
      followers: parent
        ? (((await db.prepare('SELECT user_id FROM talk_thread_follows WHERE message_id = ?').all(parent.id)) as Array<{ user_id: string }>).map((f) => f.user_id))
        : [],
      scheduled: !!input.scheduled,
      // El mensaje tal cual (solo para quien ya puede leer el canal: el feed filtra por acceso),
      // así se pinta al toque; lo que depende de quién mira (tarjetas, guardado) llega después.
      message: {
        id,
        channelId: channel.id,
        parentId: parent?.id ?? null,
        userId: opts.asBot ? null : actor.personId,
        botName: input.botName ?? null,
        body,
        alsoInChannel: !!(parent && input.alsoInChannel),
        createdAt: now,
        hasFiles: fileIds.length > 0,
      },
      thread: threadState,
    },
  });
  const [message] = await toMessageDtos(actor, [row]);
  return { message, row, channel };
}

/** Lo que corre después de publicar (avisos, vista previa de links, Flow y webhooks). No espera la respuesta. */
export async function afterPost(actor: TalkActor, result: PostResult, opts: { asBot?: boolean } = {}): Promise<void> {
  const { notifyForMessage } = await import('./talk-notify');
  await notifyForMessage(actor, result.row, result.channel, opts).catch((err) => console.error('[talk] notify failed', err));
  const urls = extractUrls(result.row.body);
  if (urls.length) {
    const { unfurlExternal } = await import('./talk-unfurl');
    const unfurls = await unfurlExternal(urls).catch(() => []);
    if (unfurls.length) {
      await getDb().prepare('UPDATE talk_messages SET unfurls = ? WHERE id = ?').run(JSON.stringify(unfurls), result.row.id);
      await emitTalkEvent(actor.workspaceId, 'message', { channelId: result.channel.id, payload: { id: result.row.id, parentId: result.row.parent_id, change: 'updated' } });
    }
  }
  // Flow y webhooks del workspace. Como en Slack: los DMs nunca salen; un
  // canal privado solo llega a los webhooks y flows cuya persona creadora es
  // miembro del canal (la que lo podría leer).
  if (result.channel.kind === 'public' || result.channel.kind === 'private') {
    const { emitEvent } = await import('./events');
    const { talkPlainText } = await import('./talk-markdown');
    const names = await plainNames(actor.workspaceId);
    const channelId = result.channel.id;
    const audience =
      result.channel.kind === 'private'
        ? async (creatorId: string | null) => !!creatorId && (await isWorkspacePerson(actor.workspaceId, creatorId)) && !!(await getMembership(channelId, creatorId))
        : undefined;
    await emitEvent(
      actor.workspaceId,
      'talk.message.posted',
      {
        id: result.row.id,
        channel: { id: result.channel.id, name: result.channel.name, kind: result.channel.kind },
        text: talkPlainText(result.row.body, names),
        body: result.row.body,
        userId: result.row.user_id,
        userName: result.row.user_id ? (names.user(result.row.user_id) ?? null) : null,
        botName: result.row.bot_name,
        threadId: result.row.parent_id,
        createdAt: result.row.created_at,
      },
      { audience },
    );
  }
}

/**
 * ¿Un webhook o flow de `creatorId` puede recibir este evento de Talk hoy?
 * Público: sí. Privado (o un público que pasó a privado): si es miembro. DM o
 * canal borrado: no.
 */
export async function talkDeliveryAllowed(workspaceId: string, creatorId: string | null, data: unknown): Promise<boolean> {
  const channelId = (data as { channel?: { id?: string } } | null)?.channel?.id;
  if (!channelId) return true;
  const row = await getChannelRow(workspaceId, channelId);
  if (!row || row.kind === 'dm' || row.kind === 'group') return false;
  if (row.kind === 'public') return true;
  return !!creatorId && (await isWorkspacePerson(workspaceId, creatorId)) && !!(await getMembership(channelId, creatorId));
}

/** Nombres para pasar el texto guardado (con <@id>, <#id>) a texto legible. */
export async function plainNames(workspaceId: string): Promise<{ user: (id: string) => string | undefined; channel: (id: string) => string | undefined; group: (id: string) => string | undefined }> {
  const [people, groups, channels] = await Promise.all([
    listTalkPeople(workspaceId),
    listTalkGroups(workspaceId),
    getDb().prepare("SELECT id, name FROM talk_channels WHERE workspace_id = ? AND kind IN ('public', 'private')").all(workspaceId) as Promise<Array<{ id: string; name: string }>>,
  ]);
  const p = new Map(people.map((x) => [x.id, x.name]));
  const g = new Map(groups.map((x) => [x.id, x.handle]));
  const c = new Map(channels.map((x) => [x.id, x.name]));
  return { user: (id) => p.get(id), channel: (id) => c.get(id), group: (id) => g.get(id) };
}

export async function editMessage(actor: TalkActor, id: string, body: string): Promise<TalkMessageDto> {
  const found = await readableMessage(actor, id);
  if (!found || found.message.deleted_at) throw new TalkError('not_found', 404);
  if (found.message.user_id !== actor.personId) throw new TalkError('forbidden', 403);
  if (found.access.channel.archived_at) throw new TalkError('channel_archived', 409);
  // Ventana de edición del workspace (Ajustes de Talk): pasado ese tiempo no se edita.
  const settings = (await getDb().prepare('SELECT edit_window_minutes FROM talk_settings WHERE workspace_id = ?').get(actor.workspaceId)) as
    | { edit_window_minutes: number | null }
    | undefined;
  const windowMin = Number(settings?.edit_window_minutes ?? 0);
  if (windowMin > 0 && Date.now() - new Date(found.message.created_at).getTime() > windowMin * 60_000) throw new TalkError('edit_window_passed', 409);
  const text = body.replace(/\s+$/, '');
  if (!text.trim() && found.message.files === '[]') {
    const hasFiles = await getDb().prepare('SELECT 1 AS x FROM talk_files WHERE message_id = ?').get(id);
    if (!hasFiles) throw new TalkError('empty_message');
  }
  if (text.length > MESSAGE_MAX) throw new TalkError('message_too_long');
  const mentions = extractMentions(text);
  const broadcast = mentions.channel ? 'channel' : mentions.here ? 'here' : null;
  const prev = parseJson<string[]>(found.message.mentions, []);
  await invalidateSummaries([id]);
  await getDb()
    .prepare('UPDATE talk_messages SET body = ?, mentions = ?, broadcast = ?, edited_at = ?, unfurls = ? WHERE id = ?')
    .run(text, JSON.stringify([...new Set([...mentions.users])]), broadcast, nowIso(), found.message.unfurls, id);
  // El evento del feed no conserva el texto viejo.
  await getDb()
    .prepare("UPDATE talk_events SET payload = json_remove(payload, '$.message') WHERE kind = 'message' AND channel_id = ? AND json_extract(payload, '$.id') = ?")
    .run(found.message.channel_id, id);
  // Los avisos de este mensaje muestran el texto editado (no el viejo).
  {
    const { talkPlainText } = await import('./talk-markdown');
    await getDb()
      .prepare("UPDATE notifications SET body = ? WHERE source_type = 'talk_message' AND source_id = ?")
      .run(talkPlainText(text, await plainNames(actor.workspaceId)).slice(0, 280), id);
  }
  await emitTalkEvent(actor.workspaceId, 'message', { channelId: found.message.channel_id, actorId: actor.personId, payload: { id, parentId: found.message.parent_id, change: 'updated' } });
  const row = (await getMessageRow(actor.workspaceId, id))!;
  // Menciones nuevas al editar también avisan (solo las que no estaban).
  const added = mentions.users.filter((u) => !prev.includes(u));
  if (added.length) {
    const { notifyMentionsAdded } = await import('./talk-notify');
    await notifyMentionsAdded(actor, row, found.access.channel, added).catch(() => undefined);
  }
  return (await toMessageDtos(actor, [row]))[0];
}

/** Borra: el autor, o un admin del workspace. Si tiene respuestas queda "Este mensaje fue borrado". */
export async function deleteMessage(actor: TalkActor, id: string): Promise<{ fileUrls: string[] }> {
  const found = await readableMessage(actor, id);
  if (!found || found.message.deleted_at) throw new TalkError('not_found', 404);
  const m = found.message;
  if (m.user_id !== actor.personId && !roleAtLeast(actor.role, 'admin')) throw new TalkError('forbidden', 403);
  const db = getDb();
  const files = (await db.prepare('SELECT url FROM talk_files WHERE message_id = ?').all(id)) as Array<{ url: string }>;
  await db.prepare('DELETE FROM talk_files WHERE message_id = ?').run(id);
  // Campana, emails en cola y recordatorios de este mensaje.
  await purgeMessageNotifications([id]);
  // El evento del feed llevaba el texto: se le saca (una reconexión no lo vuelve a traer).
  await db
    .prepare("UPDATE talk_events SET payload = json_remove(payload, '$.message') WHERE kind = 'message' AND channel_id = ? AND json_extract(payload, '$.id') = ?")
    .run(m.channel_id, id);
  if (m.reply_count > 0) {
    await db.prepare("UPDATE talk_messages SET deleted_at = ?, body = '', unfurls = '[]', pinned_at = NULL WHERE id = ?").run(nowIso(), id);
    await db.prepare('DELETE FROM talk_reactions WHERE message_id = ?').run(id);
  } else {
    await db.prepare('DELETE FROM talk_messages WHERE id = ?').run(id);
  }
  if (m.parent_id) {
    const parent = await getMessageRow(actor.workspaceId, m.parent_id);
    if (parent) {
      const left = (await db
        .prepare('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM talk_messages WHERE parent_id = ? AND deleted_at IS NULL')
        .get(parent.id)) as { n: number; last: string | null };
      await db.prepare('UPDATE talk_messages SET reply_count = ?, last_reply_at = ? WHERE id = ?').run(Number(left.n), left.last, parent.id);
      // Un raíz borrado sin respuestas ya no tiene qué mostrar.
      if (parent.deleted_at && Number(left.n) === 0) await db.prepare('DELETE FROM talk_messages WHERE id = ?').run(parent.id);
    }
  }
  await emitTalkEvent(actor.workspaceId, 'message', { channelId: m.channel_id, actorId: actor.personId, payload: { id, parentId: m.parent_id, change: 'deleted' } });
  return { fileUrls: files.map((f) => f.url) };
}

export async function toggleReaction(actor: TalkActor, id: string, emoji: string, on?: boolean): Promise<TalkMessageDto> {
  if (!isValidReaction(emoji)) throw new TalkError('invalid_emoji');
  const found = await readableMessage(actor, id);
  if (!found || found.message.deleted_at) throw new TalkError('not_found', 404);
  if (!found.access.member) throw new TalkError('not_member', 403);
  if (found.access.channel.archived_at) throw new TalkError('channel_archived', 409);
  const db = getDb();
  const exists = await db.prepare('SELECT 1 AS x FROM talk_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(id, actor.personId, emoji);
  const want = on ?? !exists;
  if (want && !exists) {
    const count = (await db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM talk_reactions WHERE message_id = ?').get(id)) as { n: number };
    if (Number(count.n) >= 50) throw new TalkError('too_many_reactions');
    await db.prepare('INSERT OR IGNORE INTO talk_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(id, actor.personId, emoji, nowIso());
  } else if (!want && exists) {
    await db.prepare('DELETE FROM talk_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(id, actor.personId, emoji);
  }
  await emitTalkEvent(actor.workspaceId, 'reaction', { channelId: found.message.channel_id, actorId: actor.personId, payload: { id, parentId: found.message.parent_id } });
  return (await toMessageDtos(actor, [(await getMessageRow(actor.workspaceId, id))!]))[0];
}

export async function setPinned(actor: TalkActor, id: string, pinned: boolean): Promise<TalkMessageDto> {
  const found = await readableMessage(actor, id);
  if (!found || found.message.deleted_at) throw new TalkError('not_found', 404);
  if (!found.access.member) throw new TalkError('not_member', 403);
  await getDb()
    .prepare('UPDATE talk_messages SET pinned_at = ?, pinned_by = ? WHERE id = ?')
    .run(pinned ? nowIso() : null, pinned ? actor.personId : null, id);
  await emitTalkEvent(actor.workspaceId, 'message', { channelId: found.message.channel_id, actorId: actor.personId, payload: { id, parentId: found.message.parent_id, change: 'updated' } });
  return (await toMessageDtos(actor, [(await getMessageRow(actor.workspaceId, id))!]))[0];
}

export async function listPins(actor: TalkActor, channelId: string): Promise<TalkMessageDto[]> {
  const access = await readableChannel(actor, channelId);
  if (!access) throw new TalkError('not_found', 404);
  const rows = (await getDb()
    .prepare('SELECT * FROM talk_messages WHERE channel_id = ? AND pinned_at IS NOT NULL AND deleted_at IS NULL ORDER BY pinned_at DESC LIMIT 100')
    .all(channelId)) as TalkMessageRow[];
  return toMessageDtos(actor, rows);
}

export async function setFollow(actor: TalkActor, rootId: string, follow: boolean): Promise<void> {
  const found = await readableMessage(actor, rootId);
  if (!found || found.message.parent_id) throw new TalkError('not_found', 404);
  const db = getDb();
  if (follow) await db.prepare('INSERT OR IGNORE INTO talk_thread_follows (message_id, user_id, last_read_at) VALUES (?, ?, ?)').run(rootId, actor.personId, nowIso());
  else await db.prepare('DELETE FROM talk_thread_follows WHERE message_id = ? AND user_id = ?').run(rootId, actor.personId);
}

export async function markThreadRead(actor: TalkActor, rootId: string): Promise<void> {
  await getDb().prepare('UPDATE talk_thread_follows SET last_read_at = ? WHERE message_id = ? AND user_id = ?').run(nowIso(), rootId, actor.personId);
  await emitTalkEvent(actor.workspaceId, 'read', { userId: actor.personId, payload: { threadId: rootId } });
}

/** Hilos que sigo, con los no leídos primero (vista Hilos). */
export async function listThreads(actor: TalkActor, limit = 50): Promise<Array<{ root: TalkMessageDto; unread: boolean; channel: { id: string; name: string; kind: TalkChannelKind } }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT m.*, f.last_read_at AS f_read, c.name AS c_name, c.kind AS c_kind FROM talk_thread_follows f
       JOIN talk_messages m ON m.id = f.message_id
       JOIN talk_channels c ON c.id = m.channel_id
       WHERE f.user_id = ? AND m.workspace_id = ? AND m.reply_count > 0
         AND (${publicClause(actor)} OR EXISTS (SELECT 1 FROM talk_members tm WHERE tm.channel_id = c.id AND tm.user_id = f.user_id))
       ORDER BY m.last_reply_at DESC LIMIT ?`,
    )
    .all(actor.personId, actor.workspaceId, limit)) as Array<TalkMessageRow & { f_read: string | null; c_name: string; c_kind: TalkChannelKind }>;
  const dtos = await toMessageDtos(actor, rows);
  return rows.map((r, i) => ({ root: dtos[i], unread: !!r.last_reply_at && (!r.f_read || r.last_reply_at > r.f_read), channel: { id: r.channel_id, name: r.c_name, kind: r.c_kind } }));
}

export async function countUnreadThreads(actor: TalkActor): Promise<number> {
  return (await listUnreadThreadIds(actor)).length;
}

/** Hilos que sigo con respuestas que no leí (ids de los mensajes raíz). */
export async function listUnreadThreadIds(actor: TalkActor): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT m.id FROM talk_thread_follows f JOIN talk_messages m ON m.id = f.message_id
       WHERE f.user_id = ? AND m.workspace_id = ? AND m.last_reply_at IS NOT NULL AND (f.last_read_at IS NULL OR m.last_reply_at > f.last_read_at)
         AND EXISTS (SELECT 1 FROM talk_messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL AND (r.user_id IS NULL OR r.user_id != f.user_id) AND r.created_at > COALESCE(f.last_read_at, ''))
       LIMIT 500`,
    )
    .all(actor.personId, actor.workspaceId)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Actividad: menciones a mí (y @canal / @aquí) en lo que puedo leer. */
export async function listActivity(actor: TalkActor, limit = 50): Promise<Array<{ message: TalkMessageDto; channel: { id: string; name: string; kind: TalkChannelKind } }>> {
  const rows = (await getDb()
    .prepare(
      `SELECT m.*, c.name AS c_name, c.kind AS c_kind FROM talk_messages m JOIN talk_channels c ON c.id = m.channel_id
       JOIN talk_members tm ON tm.channel_id = c.id AND tm.user_id = ?
       WHERE m.workspace_id = ? AND m.deleted_at IS NULL AND (m.user_id IS NULL OR m.user_id != ?)
         AND (m.mentions LIKE '%"' || ? || '"%' OR m.broadcast IS NOT NULL)
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(actor.personId, actor.workspaceId, actor.personId, actor.personId, limit)) as Array<TalkMessageRow & { c_name: string; c_kind: TalkChannelKind }>;
  const dtos = await toMessageDtos(actor, rows);
  return rows.map((r, i) => ({ message: dtos[i], channel: { id: r.channel_id, name: r.c_name, kind: r.c_kind } }));
}

/** Último mensaje propio del canal o del hilo (↑ para editar). */
export async function lastOwnMessage(actor: TalkActor, channelId: string, parentId: string | null): Promise<string | null> {
  const row = (await getDb()
    .prepare(
      `SELECT id FROM talk_messages WHERE channel_id = ? AND user_id = ? AND deleted_at IS NULL AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} ORDER BY created_at DESC LIMIT 1`,
    )
    .get(...(parentId ? [channelId, actor.personId, parentId] : [channelId, actor.personId]))) as { id: string } | undefined;
  return row?.id ?? null;
}

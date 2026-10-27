/**
 * Chat — colaboración en la bandeja, como Intercom:
 * - Equipos (chat_teams): "Soporte", "Ventas"… con miembros que son agentes
 *   del workspace. Una conversación puede estar asignada a un equipo (y a una
 *   persona); la bandeja tiene una vista por equipo y las reglas pueden
 *   asignar a un equipo y repartir entre sus miembros.
 * - Vistas guardadas (chat_views): filtros con nombre en el sidebar, propias
 *   o compartidas con el workspace.
 * - Seguir una conversación sin estar asignado: avisa los mensajes nuevos.
 * - Presencia: quién está mirando o escribiendo una respuesta (colisión).
 *
 * workspace_id es el dueño del workspace (user.id de la sesión, igual a
 * chat_widgets.user_id). Server-only.
 */
import { getDb } from './db';

function nowIso(): string {
  return new Date().toISOString();
}

export const CHAT_NAME_MAX = 80;

export class ChatCollabError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, CHAT_NAME_MAX) : '';
  if (!name) throw new ChatCollabError('missing_name');
  return name;
}

// ---------- Equipos ----------

export interface ChatTeam {
  id: string;
  workspace_id: string;
  name: string;
  member_ids: string[];
  /** Conversaciones abiertas del equipo (para el sidebar). */
  open_count: number;
  created_at: string;
  updated_at: string;
}

type TeamRow = Omit<ChatTeam, 'member_ids' | 'open_count'> & { members: string | null; open_count: number };

function toTeam(r: TeamRow): ChatTeam {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    name: r.name,
    member_ids: r.members ? r.members.split(',').filter(Boolean) : [],
    open_count: Number(r.open_count ?? 0),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const TEAM_SELECT = `SELECT t.*,
  (SELECT GROUP_CONCAT(m.user_id, ',') FROM chat_team_members m WHERE m.team_id = t.id) AS members,
  (SELECT COUNT(*) FROM chat_conversations c WHERE c.team_id = t.id AND c.status = 'open') AS open_count
  FROM chat_teams t`;

export async function listChatTeams(workspaceId: string): Promise<ChatTeam[]> {
  const rows = (await getDb()
    .prepare(`${TEAM_SELECT} WHERE t.workspace_id = ? ORDER BY t.name COLLATE NOCASE`)
    .all(workspaceId)) as TeamRow[];
  return rows.map(toTeam);
}

export async function getChatTeam(workspaceId: string, id: string): Promise<ChatTeam | null> {
  const row = (await getDb().prepare(`${TEAM_SELECT} WHERE t.id = ? AND t.workspace_id = ?`).get(id, workspaceId)) as
    | TeamRow
    | undefined;
  return row ? toTeam(row) : null;
}

/** Deja solo ids de agentes válidos, sin repetir. */
function cleanMembers(raw: unknown, agentIds: string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ChatCollabError('invalid_input');
  const allowed = new Set(agentIds);
  const out = [...new Set(raw.filter((x): x is string => typeof x === 'string'))];
  if (out.some((id) => !allowed.has(id))) throw new ChatCollabError('invalid_member');
  return out.slice(0, 200);
}

async function setMembers(teamId: string, members: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM chat_team_members WHERE team_id = ?').run(teamId);
  for (const userId of members) {
    await db.prepare('INSERT OR IGNORE INTO chat_team_members (team_id, user_id, created_at) VALUES (?, ?, ?)').run(teamId, userId, nowIso());
  }
}

export async function createChatTeam(
  workspaceId: string,
  input: { name: unknown; memberIds?: unknown },
  agentIds: string[],
): Promise<ChatTeam> {
  const name = cleanName(input.name);
  const members = cleanMembers(input.memberIds, agentIds);
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM chat_teams WHERE workspace_id = ?').get(workspaceId)) as { c: number };
  if (Number(count.c) >= 50) throw new ChatCollabError('too_many_teams');
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare('INSERT INTO chat_teams (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, workspaceId, name, now, now);
  await setMembers(id, members);
  return (await getChatTeam(workspaceId, id))!;
}

export async function updateChatTeam(
  workspaceId: string,
  id: string,
  input: { name?: unknown; memberIds?: unknown },
  agentIds: string[],
): Promise<ChatTeam | null> {
  const team = await getChatTeam(workspaceId, id);
  if (!team) return null;
  if (input.name !== undefined) {
    await getDb().prepare('UPDATE chat_teams SET name = ?, updated_at = ? WHERE id = ?').run(cleanName(input.name), nowIso(), id);
  }
  if (input.memberIds !== undefined) {
    await setMembers(id, cleanMembers(input.memberIds, agentIds));
    await getDb().prepare('UPDATE chat_teams SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  }
  return getChatTeam(workspaceId, id);
}

/** Borra el equipo: sus conversaciones quedan sin equipo y las reglas que asignaban a él, sin destino de equipo. */
export async function deleteChatTeam(workspaceId: string, id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM chat_teams WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  if (res.changes === 0) return false;
  await db.prepare('UPDATE chat_conversations SET team_id = NULL WHERE team_id = ?').run(id);
  await db.prepare('UPDATE chat_assignment_rules SET assign_team_id = NULL WHERE assign_team_id = ?').run(id);
  await db.prepare('DELETE FROM chat_views WHERE workspace_id = ? AND filters LIKE ?').run(workspaceId, `%"teamId":"${id}"%`);
  return true;
}

/** Un equipo del workspace del widget (para asignar o para reglas). */
export async function teamBelongsTo(workspaceId: string, teamId: string): Promise<boolean> {
  return !!(await getDb().prepare('SELECT 1 FROM chat_teams WHERE id = ? AND workspace_id = ?').get(teamId, workspaceId));
}

export async function teamMemberIds(teamId: string): Promise<string[]> {
  const rows = (await getDb().prepare('SELECT user_id FROM chat_team_members WHERE team_id = ?').all(teamId)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

export async function setConversationTeam(conversationId: string, teamId: string | null): Promise<void> {
  await getDb().prepare('UPDATE chat_conversations SET team_id = ?, updated_at = ? WHERE id = ?').run(teamId, nowIso(), conversationId);
}

// ---------- Vistas guardadas ----------

export interface ChatViewFilters {
  status?: 'open' | 'pending' | 'snoozed' | 'resolved' | 'all';
  /** 'mine', 'unassigned' o un id de agente. */
  assignee?: string;
  teamId?: string;
  tag?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  channel?: 'web' | 'email';
  q?: string;
}

export interface ChatView {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  filters: ChatViewFilters;
  shared: boolean;
  /** Conversaciones que cumplen la vista (lo calcula quien la lista). */
  count?: number;
  created_at: string;
  updated_at: string;
}

const STATUSES = new Set(['open', 'pending', 'snoozed', 'resolved', 'all']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

/** Filtros válidos de una vista: lo que no se reconoce se descarta. */
export function cleanViewFilters(raw: unknown): ChatViewFilters {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: ChatViewFilters = {};
  const str = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const status = str(src.status);
  if (status && STATUSES.has(status)) out.status = status as ChatViewFilters['status'];
  const assignee = str(src.assignee, 64);
  if (assignee && assignee !== 'any') out.assignee = assignee;
  const teamId = str(src.teamId, 64);
  if (teamId) out.teamId = teamId;
  const tag = str(src.tag, 40);
  if (tag) out.tag = tag;
  const priority = str(src.priority);
  if (priority && PRIORITIES.has(priority)) out.priority = priority as ChatViewFilters['priority'];
  const channel = str(src.channel);
  if (channel === 'web' || channel === 'email') out.channel = channel;
  const q = str(src.q, 200);
  if (q) out.q = q;
  return out;
}

type ViewRow = Omit<ChatView, 'filters' | 'shared'> & { filters: string; shared: number };

function toView(r: ViewRow): ChatView {
  let filters: ChatViewFilters = {};
  try {
    filters = cleanViewFilters(JSON.parse(r.filters));
  } catch {
    filters = {};
  }
  return { ...r, filters, shared: Number(r.shared) === 1 };
}

/** Las vistas propias y las compartidas del workspace. */
export async function listChatViews(workspaceId: string, personId: string): Promise<ChatView[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM chat_views WHERE workspace_id = ? AND (user_id = ? OR shared = 1) ORDER BY name COLLATE NOCASE')
    .all(workspaceId, personId)) as ViewRow[];
  return rows.map(toView);
}

export async function getChatView(workspaceId: string, personId: string, id: string): Promise<ChatView | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM chat_views WHERE id = ? AND workspace_id = ? AND (user_id = ? OR shared = 1)')
    .get(id, workspaceId, personId)) as ViewRow | undefined;
  return row ? toView(row) : null;
}

export async function createChatView(
  workspaceId: string,
  personId: string,
  input: { name: unknown; filters?: unknown; shared?: unknown },
): Promise<ChatView> {
  const name = cleanName(input.name);
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM chat_views WHERE workspace_id = ? AND user_id = ?').get(workspaceId, personId)) as {
    c: number;
  };
  if (Number(count.c) >= 50) throw new ChatCollabError('too_many_views');
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare('INSERT INTO chat_views (id, workspace_id, user_id, name, filters, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, personId, name, JSON.stringify(cleanViewFilters(input.filters)), input.shared === true ? 1 : 0, now, now);
  return (await getChatView(workspaceId, personId, id))!;
}

/**
 * Renombrar, cambiar filtros o compartir. Una vista compartida la puede
 * editar cualquiera del workspace (como en Intercom); solo su autor la
 * vuelve privada.
 */
export async function updateChatView(
  workspaceId: string,
  personId: string,
  id: string,
  input: { name?: unknown; filters?: unknown; shared?: unknown },
): Promise<ChatView | null> {
  const view = await getChatView(workspaceId, personId, id);
  if (!view) return null;
  const sets: string[] = [];
  const args: Array<string | number> = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    args.push(cleanName(input.name));
  }
  if (input.filters !== undefined) {
    sets.push('filters = ?');
    args.push(JSON.stringify(cleanViewFilters(input.filters)));
  }
  if (input.shared !== undefined) {
    if (view.user_id !== personId) throw new ChatCollabError('forbidden', 403);
    sets.push('shared = ?');
    args.push(input.shared === true ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    args.push(nowIso(), id);
    await getDb().prepare(`UPDATE chat_views SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }
  return getChatView(workspaceId, personId, id);
}

export async function deleteChatView(workspaceId: string, personId: string, id: string): Promise<boolean> {
  const view = await getChatView(workspaceId, personId, id);
  if (!view) return false;
  if (view.user_id !== personId && !view.shared) return false;
  return (await getDb().prepare('DELETE FROM chat_views WHERE id = ?').run(id)).changes > 0;
}

// ---------- Seguir ----------

export async function isFollowing(conversationId: string, userId: string): Promise<boolean> {
  return !!(await getDb()
    .prepare('SELECT 1 FROM chat_conversation_followers WHERE conversation_id = ? AND user_id = ?')
    .get(conversationId, userId));
}

export async function setFollowing(conversationId: string, userId: string, follow: boolean): Promise<boolean> {
  const db = getDb();
  if (follow) {
    await db
      .prepare('INSERT OR IGNORE INTO chat_conversation_followers (conversation_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(conversationId, userId, nowIso());
  } else {
    await db.prepare('DELETE FROM chat_conversation_followers WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId);
  }
  return follow;
}

export async function listFollowers(conversationId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT user_id FROM chat_conversation_followers WHERE conversation_id = ?')
    .all(conversationId)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

// ---------- Presencia (colisión) ----------

/** Cuánto dura la marca sin un nuevo latido: la conversación hace poll cada 3 s. */
export const PRESENCE_TTL_MS = 12_000;

export interface ChatPresence {
  user_id: string;
  name: string | null;
  email: string;
  typing: boolean;
}

export async function touchPresence(conversationId: string, userId: string, typing: boolean, now = Date.now()): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO chat_presence (conversation_id, user_id, typing, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET typing = excluded.typing, expires_at = excluded.expires_at`,
    )
    .run(conversationId, userId, typing ? 1 : 0, new Date(now + PRESENCE_TTL_MS).toISOString());
}

export async function leavePresence(conversationId: string, userId: string): Promise<void> {
  await getDb().prepare('DELETE FROM chat_presence WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId);
}

/** Los otros agentes que tienen abierta la conversación ahora (y si escriben). */
export async function listPresence(conversationId: string, exceptUserId: string, now = Date.now()): Promise<ChatPresence[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT p.user_id, p.typing, u.name, u.email FROM chat_presence p JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = ? AND p.user_id != ? AND p.expires_at > ? ORDER BY p.typing DESC, u.name`,
    )
    .all(conversationId, exceptUserId, new Date(now).toISOString())) as Array<{ user_id: string; typing: number; name: string | null; email: string }>;
  return rows.map((r) => ({ user_id: r.user_id, name: r.name, email: r.email, typing: Number(r.typing) === 1 }));
}

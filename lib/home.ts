import { cache } from 'react';
import { getDb } from '@/lib/db';
import { listTasks } from '@/lib/crm';
import { ownerScopeSql, sessionScope } from '@/lib/crm-visibility';
import { listMyIssues } from '@/lib/track-data';
import { listUserBookings } from '@/lib/calendar';
import { listNotes, noteOwner } from '@/lib/notes';
import { listLinks } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { boardViewer, boardVisibleSql } from '@/lib/board-access';
import { chatAccessSql, groupsViewer } from '@/lib/groups-access';
import { listChatWidgets } from '@/lib/chat-data';
import { dayRangeUtc, getUserTimeZone } from '@/lib/user-tz';
import { normalizeWorkspaceMode, type WorkspaceMode } from '@/lib/workspace-mode';
import type { TeamRole } from '@/lib/teams';
import type { ProductKey } from '@/lib/products';

/**
 * Inicio de la plataforma (/app): agregados de todas las apps. Cada bloque de
 * la página llama a su función (en su propio Suspense), así un bloque lento no
 * frena a los demás; adentro de cada una las lecturas van en paralelo.
 */

export interface HomeUser {
  /** Dueño del workspace activo (donde viven los datos). */
  id: string;
  name?: string | null;
  team?: { id: string } | null;
  actingUser?: { id: string; name?: string | null } | null;
  role: TeamRole;
}

/**
 * Modo del workspace (personal o equipo) desde teams.use_mode. La columna
 * llega con la migración 100: sin ella (o sin fila) la consulta falla o viene
 * vacía y el modo es 'team'.
 */
export const getWorkspaceMode = cache(async (user: { id: string; team?: { id: string } | null }): Promise<WorkspaceMode> => {
  try {
    const db = getDb();
    const row = (user.team
      ? await db.prepare('SELECT use_mode FROM teams WHERE id = ?').get(user.team.id)
      : await db.prepare('SELECT use_mode FROM teams WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1').get(user.id)) as
      | { use_mode?: string | null }
      | undefined;
    return normalizeWorkspaceMode(row?.use_mode);
  } catch {
    return normalizeWorkspaceMode(null);
  }
});

/** Momento del día en la zona de la persona: para el saludo. */
export function dayPart(timeZone: string, at: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  let hour = at.getUTCHours();
  try {
    hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(at));
  } catch {
    /* zona inválida: UTC */
  }
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 20) return 'afternoon';
  return 'evening';
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC, formato de la base) → Date. */
function sqlDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

// ---------- Para hoy ----------

export interface HomeTask {
  id: string;
  subject: string;
  dueAt: string | null;
  overdue: boolean;
  context: string | null;
}

export type HomeTaskScope = 'mine' | 'all';

export function normalizeTaskScope(value: unknown): HomeTaskScope {
  return value === 'all' ? 'all' : 'mine';
}

/**
 * Tareas abiertas del CRM atrasadas o que vencen hoy, con la misma visibilidad
 * que la lista. Por defecto las mías (como HubSpot); 'all' trae todas las que
 * se ven. Una tarea sin owner es del dueño del workspace.
 */
export async function homeCrmTasks(
  user: HomeUser,
  opts: { scope?: HomeTaskScope; limit?: number } = {},
): Promise<{ total: number; items: HomeTask[] }> {
  const limit = opts.limit ?? 5;
  const me = user.actingUser?.id ?? user.id;
  const scope = await sessionScope(user);
  const [overdue, today] = await Promise.all([
    listTasks(user.id, { bucket: 'overdue', ownerScope: scope }),
    listTasks(user.id, { bucket: 'today', ownerScope: scope }),
  ]);
  const mine = (r: { owner_id: string | null }) => opts.scope === 'all' || (r.owner_id ?? user.id) === me;
  const rows = [
    ...overdue.filter(mine).map((r) => ({ r, overdue: true })),
    ...today.filter(mine).map((r) => ({ r, overdue: false })),
  ];
  return {
    total: rows.length,
    items: rows.slice(0, limit).map(({ r, overdue: late }) => ({
      id: r.id,
      subject: r.subject || '',
      dueAt: r.due_at ?? null,
      overdue: late,
      context: r.contact_name ?? r.company_name ?? r.deal_name ?? null,
    })),
  };
}

export interface HomeIssue {
  id: string;
  identifier: string;
  title: string;
  statusName: string | null;
  statusColor: string | null;
}

/** Mis issues de Track en curso (estado de categoría "in_progress"). */
export async function homeTrackIssues(user: HomeUser, limit = 5): Promise<{ total: number; items: HomeIssue[] }> {
  const me = user.actingUser?.id ?? user.id;
  const rows = (await listMyIssues(user.team?.id ?? null, user.id, me, { limit: 200 })).filter(
    (i) => i.status_category === 'in_progress',
  );
  return {
    total: rows.length,
    items: rows.slice(0, limit).map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      statusName: i.status_name,
      statusColor: i.status_color,
    })),
  };
}

export interface HomeBooking {
  id: string;
  invitee: string;
  email: string;
  eventTitle: string;
  startsAt: string;
}

/** Reservas de hoy (confirmadas o pendientes), en la zona de la persona. */
export async function homeCalBookings(user: HomeUser, limit = 5): Promise<{ total: number; items: HomeBooking[] }> {
  const { start, end } = dayRangeUtc(await getUserTimeZone());
  const rows = (
    await listUserBookings(user.id, { from: sqlDate(start), to: sqlDate(end), order: 'asc', limit: 100 })
  ).filter((b) => b.status === 'confirmed' || b.status === 'pending');
  return {
    total: rows.length,
    items: rows.slice(0, limit).map((b) => ({
      id: b.id,
      invitee: b.invitee_name || b.invitee_email,
      email: b.invitee_email,
      eventTitle: b.event_type_title,
      startsAt: b.starts_at,
    })),
  };
}

/**
 * Sin leer: conversaciones de Chat con mensajes del visitante sin leer (en los
 * widgets que ve la persona, el mismo alcance que la bandeja:
 * listChatWidgets) y chats de Groups con unread (con su acceso por etiqueta).
 * Si no se puede resolver el acceso de Groups, falla: el bloque muestra el
 * error en vez de contar chats que la persona no ve.
 */
export async function homeUnread(user: HomeUser): Promise<{ chat: number; groups: number }> {
  const db = getDb();
  const person = user.actingUser?.id ?? user.id;
  const [widgets, gViewer] = await Promise.all([
    listChatWidgets(user.id, user.team?.id ?? null),
    groupsViewer(user.id, person, user.role),
  ]);
  const widgetIds = widgets.map((w) => w.id);
  const gAccess = chatAccessSql(gViewer, 'c');
  const [chat, groups] = await Promise.all([
    widgetIds.length === 0
      ? Promise.resolve({ n: 0 })
      : (db
          .prepare(
            `SELECT COUNT(*) AS n FROM chat_conversations cv
             WHERE cv.widget_id IN (${widgetIds.map(() => '?').join(',')}) AND cv.status != 'resolved'
               AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = cv.id AND m.sender_type = 'visitor' AND m.read_at IS NULL)`,
          )
          .get(...widgetIds) as Promise<{ n: number }>),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM groups_chats c WHERE c.user_id = ? AND c.unread_count > 0${gAccess ? ` AND ${gAccess.sql}` : ''}`,
      )
      .get(user.id, ...(gAccess?.args ?? [])) as Promise<{ n: number }>,
  ]);
  return { chat: Number(chat?.n ?? 0), groups: Number(groups?.n ?? 0) };
}

// ---------- Recientes ----------

export type RecentKind = 'doc' | 'note' | 'board' | 'issue' | 'link' | 'contact' | 'deal' | 'flow';

export interface RecentItem {
  kind: RecentKind;
  product: ProductKey;
  id: string;
  label: string;
  href: string;
  updatedAt: string;
}

const RECENT_PRODUCT: Record<RecentKind, ProductKey> = {
  doc: 'docs',
  note: 'notes',
  board: 'board',
  issue: 'track',
  link: 'link',
  contact: 'crm',
  deal: 'crm',
  flow: 'flow',
};

/** Fecha comparable: '2026-10-25 10:00:00' y '2026-10-25T10:00:00.000Z' ordenan igual. */
function sortKey(value: string): string {
  return value.replace(' ', 'T').slice(0, 19);
}

/**
 * Lo último que se tocó en cada app (mismo alcance que la lista de cada una),
 * mezclado por fecha. Si una fuente falla, las demás se muestran igual y
 * `failed` cuenta las que faltan (la página avisa).
 */
export async function homeRecents(user: HomeUser, limit = 8): Promise<{ items: RecentItem[]; failed: number }> {
  const db = getDb();
  const per = limit;
  type Row = { id: string; label: string | null; updated_at: string };
  let failed = 0;
  const fail = (err: unknown): Row[] => {
    failed += 1;
    console.error('[home] recientes', err);
    return [];
  };
  const all = (sql: string, ...args: Array<string | number>) => (db.prepare(sql).all(...args) as Promise<Row[]>).catch(fail);
  const teamId = user.team?.id ?? null;
  const projectWhere = teamId ? 'p.team_id = ?' : '(p.team_id IS NULL AND p.owner_id = ?)';
  const boardsVisible = boardVisibleSql(boardViewer(user));
  const scope = await sessionScope(user);
  const contactScope = ownerScopeSql('c', scope);
  const dealScope = ownerScopeSql('d', scope);

  const [docs, notes, boards, issues, links, contacts, deals, flows] = await Promise.all([
    all(`SELECT id, title AS label, updated_at FROM docs_pages WHERE user_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT ?`, user.id, per),
    // Notas: solo las de la persona (son privadas aunque el workspace sea compartido).
    listNotes(noteOwner(user), { view: 'all', limit: per })
      .then((rows) => rows.map((n) => ({ id: n.id, label: n.title, updated_at: n.updated_at })))
      .catch(fail),
    all(
      `SELECT b.id, b.name AS label, b.updated_at FROM boards b WHERE b.workspace_id = ? AND ${boardsVisible.sql} ORDER BY b.updated_at DESC LIMIT ?`,
      user.id,
      ...boardsVisible.args,
      per,
    ),
    all(
      `SELECT i.id, i.identifier || ' ' || i.title AS label, i.updated_at FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE ${projectWhere} ORDER BY i.updated_at DESC LIMIT ?`,
      teamId ?? user.id,
      per,
    ),
    listLinks(user.id, { archived: '0', viewer: viewerOf({ id: user.id, actingUser: user.actingUser ?? undefined, role: user.role }), pageSize: per })
      .then((r) => r.links.map((l) => ({ id: l.id, label: l.title || `/${l.slug}`, updated_at: l.updated_at ?? l.created_at })))
      .catch(fail),
    all(
      `SELECT c.id, COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email) AS label, c.updated_at FROM crm_contacts c
       WHERE c.user_id = ?${contactScope.sql ? ` AND ${contactScope.sql}` : ''} ORDER BY c.updated_at DESC LIMIT ?`,
      user.id,
      ...contactScope.args,
      per,
    ),
    all(
      `SELECT d.id, d.name AS label, d.updated_at FROM crm_deals d
       WHERE d.user_id = ?${dealScope.sql ? ` AND ${dealScope.sql}` : ''} ORDER BY d.updated_at DESC LIMIT ?`,
      user.id,
      ...dealScope.args,
      per,
    ),
    all(`SELECT id, name AS label, updated_at FROM flow_flows WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`, user.id, per),
  ]);

  const href: Record<RecentKind, (id: string) => string> = {
    doc: (id) => `/app/docs/${id}`,
    note: (id) => `/app/notes?note=${encodeURIComponent(id)}`,
    board: (id) => `/app/board/${id}`,
    issue: (id) => `/app/track/issues/${id}`,
    link: (id) => `/app/links/${id}`,
    contact: (id) => `/app/crm/contacts/${id}`,
    deal: (id) => `/app/crm/deals/${id}`,
    flow: (id) => `/app/flow/${id}`,
  };
  const groups: Array<[RecentKind, Row[]]> = [
    ['doc', docs],
    ['note', notes],
    ['board', boards],
    ['issue', issues],
    ['link', links],
    ['contact', contacts],
    ['deal', deals],
    ['flow', flows],
  ];
  const items = groups
    .flatMap(([kind, rows]) =>
      rows.map((r) => ({
        kind,
        product: RECENT_PRODUCT[kind],
        id: r.id,
        label: r.label ?? '',
        href: href[kind](r.id),
        updatedAt: r.updated_at,
      })),
    )
    .sort((a, b) => sortKey(b.updatedAt).localeCompare(sortKey(a.updatedAt)))
    .slice(0, limit);
  return { items, failed };
}

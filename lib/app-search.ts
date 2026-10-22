import { getDb } from '@/lib/db';
import { likeContains } from '@/lib/track-views';
import { boardViewer, boardVisibleSql } from '@/lib/board-access';
import type { TeamRole } from '@/lib/teams';

/**
 * Búsqueda global (⌘K) en las apps que no tienen una propia: pizarras,
 * proyectos e issues de Track, tipos de evento y reservas de Cal, widgets de
 * chat, flows, agentes y robots. Solo por nombre (o título / identificador del
 * issue; nombre o email del invitado en las reservas), unas pocas filas por
 * app, con el mismo alcance que la lista de cada una.
 */

export interface AppSearchItem {
  id: string;
  group: 'boards' | 'projects' | 'issues' | 'eventTypes' | 'bookings' | 'widgets' | 'flows' | 'agents' | 'robots';
  label: string;
  meta: string;
  href: string;
}

export interface AppSearchScope {
  /** Dueño del workspace activo (donde viven los datos). */
  id: string;
  team?: { id: string } | null;
  /** Persona real cuando actúa en el workspace de otro (las pizarras restringidas dependen de ella). */
  actingUser?: { id: string } | null;
  role?: TeamRole;
}

const LIMIT = 5;

type Row = { id: string; label: string; meta?: string | null; email?: string | null };

export async function searchApps(user: AppSearchScope, q: string, limit = LIMIT): Promise<AppSearchItem[]> {
  const needle = q.trim();
  if (!needle) return [];
  const like = likeContains(needle);
  const db = getDb();
  const teamId = user.team?.id ?? null;
  const all = (sql: string, ...args: Array<string | number>) =>
    (db.prepare(sql).all(...args, limit) as Promise<Row[]>).catch(() => [] as Row[]);
  // Mismo alcance que la lista de proyectos de Track (lib/track-data projectScope).
  const projectWhere = teamId ? 'p.team_id = ?' : '(p.team_id IS NULL AND p.owner_id = ?)';
  const projectArg = teamId ?? user.id;
  const widgetWhere = teamId ? 'team_id = ?' : 'user_id = ?';
  // Pizarras: las restringidas solo para quien tiene acceso, como la lista.
  const boardsVisible = boardVisibleSql(boardViewer(user));

  const [boards, projects, issues, eventTypes, bookings, widgets, flows, agents, robots] = await Promise.all([
    all(
      `SELECT b.id, b.name AS label FROM boards b WHERE b.workspace_id = ? AND ${boardsVisible.sql} AND b.name LIKE ? ESCAPE '\\' ORDER BY b.updated_at DESC LIMIT ?`,
      user.id,
      ...boardsVisible.args,
      like,
    ),
    all(
      `SELECT p.id, p.name AS label FROM track_projects p WHERE ${projectWhere} AND p.name LIKE ? ESCAPE '\\' ORDER BY p.status ASC, p.name ASC LIMIT ?`,
      projectArg,
      like,
    ),
    all(
      `SELECT i.id, i.title AS label, i.identifier AS meta FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE ${projectWhere} AND (i.title LIKE ? ESCAPE '\\' OR i.identifier LIKE ? ESCAPE '\\') ORDER BY i.updated_at DESC LIMIT ?`,
      projectArg,
      like,
      like,
    ),
    all(
      `SELECT id, title AS label, slug AS meta FROM calendar_event_types WHERE user_id = ? AND title LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
      user.id,
      like,
    ),
    // Reservas: mismo alcance que Cal › Bookings (listUserBookings: las de los
    // tipos de evento del workspace), por nombre o email del invitado.
    all(
      `SELECT b.id, b.invitee_name AS label, b.invitee_email AS email, b.invitee_email || ' · ' || e.title AS meta
       FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND (b.invitee_name LIKE ? ESCAPE '\\' OR b.invitee_email LIKE ? ESCAPE '\\')
       ORDER BY b.starts_at DESC LIMIT ?`,
      user.id,
      like,
      like,
    ),
    all(`SELECT id, name AS label FROM chat_widgets WHERE ${widgetWhere} AND name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`, teamId ?? user.id, like),
    all(`SELECT id, name AS label FROM flow_flows WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`, user.id, like),
    all(`SELECT id, name AS label FROM agents WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`, user.id, like),
    all(`SELECT id, name AS label FROM robots WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`, user.id, like),
  ]);

  const map = (rows: Row[], group: AppSearchItem['group'], href: (id: string) => string): AppSearchItem[] =>
    rows.map((r) => ({ id: r.id, group, label: r.label, meta: r.meta ?? '', href: href(r.id) }));

  return [
    ...map(projects, 'projects', (id) => `/app/track/projects/${id}`),
    ...map(issues, 'issues', (id) => `/app/track/issues/${id}`),
    ...map(boards, 'boards', (id) => `/app/board/${id}`),
    ...map(eventTypes, 'eventTypes', (id) => `/app/calendar/event-types/${id}`),
    // La reserva se abre en Bookings filtrada por el email del invitado (todas las fechas).
    ...bookings.map((r) => ({
      id: r.id,
      group: 'bookings' as const,
      label: r.label || (r.email ?? ''),
      meta: r.meta ?? '',
      href: `/app/calendar/bookings?q=${encodeURIComponent(r.email || r.label)}`,
    })),
    ...map(widgets, 'widgets', (id) => `/app/chat/widgets/${id}`),
    ...map(flows, 'flows', (id) => `/app/flow/${id}`),
    ...map(agents, 'agents', (id) => `/app/agents/${id}`),
    ...map(robots, 'robots', (id) => `/app/robots/${id}`),
  ];
}

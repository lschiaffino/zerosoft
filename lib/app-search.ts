import { getDb } from '@/lib/db';
import { likeContains } from '@/lib/track-views';
import { trackVisibleSql } from '@/lib/track-access';
import { boardViewer, boardVisibleSql } from '@/lib/board-access';
import type { TeamRole } from '@/lib/teams';
import { chatAccessSql, groupsViewer } from '@/lib/groups-access';
import { maskPhoneText } from '@/lib/groups-mask';

/**
 * Búsqueda global (⌘K) en las apps que no tienen una propia: pizarras,
 * proyectos e issues de Track, tipos de evento y reservas de Cal, widgets de
 * chat, flows, agentes, robots y chats de Groups. Solo por nombre (o título / identificador del
 * issue; nombre o email del invitado en las reservas), unas pocas filas por
 * app, con el mismo alcance que la lista de cada una.
 */

export interface AppSearchItem {
  id: string;
  group:
    | 'playbooks'
    | 'crmForms'
    | 'crmQuotes'
    | 'crmApprovals'
    | 'crmScores'
    | 'boards'
    | 'projects'
    | 'issues'
    | 'eventTypes'
    | 'bookings'
    | 'widgets'
    | 'flows'
    | 'agents'
    | 'robots'
    | 'groupsChats'
    | 'groupsTickets'
    | 'groupsMessages'
    | 'groupsLists'
    | 'groupsTemplates'
    | 'groupsRecurring';
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

/** "Grupo de WhatsApp" en el idioma de la paleta (el resto de las metas son datos). */
const WA_GROUP: Record<string, string> = { en: 'WhatsApp group', es: 'Grupo de WhatsApp', pt: 'Grupo de WhatsApp' };

export async function searchApps(user: AppSearchScope, q: string, limit = LIMIT, locale = 'en'): Promise<AppSearchItem[]> {
  const needle = q.trim();
  if (!needle) return [];
  const like = likeContains(needle);
  const db = getDb();
  const teamId = user.team?.id ?? null;
  const all = (sql: string, ...args: Array<string | number>) =>
    (db.prepare(sql).all(...args, limit) as Promise<Row[]>).catch(() => [] as Row[]);
  // Mismo alcance que la lista de proyectos de Track (lib/track-data projectScope).
  // En un team, solo los proyectos que ve la persona (privados e invitados).
  const visible = teamId ? trackVisibleSql('p', user.actingUser?.id ?? user.id) : null;
  const projectWhere = visible ? `p.team_id = ? AND ${visible.sql}` : '(p.team_id IS NULL AND p.owner_id = ?)';
  const projectArgs = [teamId ?? user.id, ...(visible?.args ?? [])];
  const widgetWhere = teamId ? 'team_id = ?' : 'user_id = ?';
  // Pizarras: las restringidas solo para quien tiene acceso, como la lista.
  const boardsVisible = boardVisibleSql(boardViewer(user));

  const waGroup = WA_GROUP[locale] ?? WA_GROUP.en;
  // Groups: acceso por etiqueta y teléfonos ocultos, como la bandeja.
  const gViewer = await groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role ?? 'owner').catch(() => null);
  const gAccess = chatAccessSql(gViewer, 'c');
  const gWhere = gAccess ? ` AND ${gAccess.sql}` : '';
  const gArgs = gAccess?.args ?? [];
  const gMask = (r: Row): Row => (gViewer?.mask ? { ...r, label: maskPhoneText(r.label), meta: r.meta ? maskPhoneText(r.meta) : r.meta } : r);
  const ticketNumber = /^#?\d{1,7}$/.test(needle) ? Number(needle.replace('#', '')) : -1;
  const person = user.actingUser?.id ?? user.id;
  const [boards, projects, issues, eventTypes, bookings, widgets, flows, agents, robots, groupChats, groupTickets, groupMessages, groupRecurring, playbooks, forms, quotes, approvals, scores, groupLists, groupTemplates] = await Promise.all([
    all(
      `SELECT b.id, b.name AS label FROM boards b WHERE b.workspace_id = ? AND ${boardsVisible.sql} AND b.name LIKE ? ESCAPE '\\' ORDER BY b.updated_at DESC LIMIT ?`,
      user.id,
      ...boardsVisible.args,
      like,
    ),
    all(
      `SELECT p.id, p.name AS label FROM track_projects p WHERE ${projectWhere} AND p.name LIKE ? ESCAPE '\\' ORDER BY p.status ASC, p.name ASC LIMIT ?`,
      ...projectArgs,
      like,
    ),
    all(
      // El ID viejo de un issue movido de team también lo encuentra (como Linear, que lo redirige).
      `SELECT i.id, i.title AS label, i.identifier AS meta FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE ${projectWhere} AND (i.title LIKE ? ESCAPE '\\' OR i.identifier LIKE ? ESCAPE '\\'
         OR i.id IN (SELECT a.issue_id FROM track_issue_aliases a WHERE UPPER(a.identifier) = UPPER(?)))
       ORDER BY (UPPER(i.identifier) = UPPER(?)) DESC, i.updated_at DESC LIMIT ?`,
      ...projectArgs,
      like,
      like,
      needle,
      needle,
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
    // Groups: chats y grupos de WhatsApp por nombre o teléfono.
    all(
      `SELECT c.id, CASE WHEN c.name != '' THEN c.name ELSE '+' || c.phone END AS label, CASE c.kind WHEN 'group' THEN ? ELSE '+' || c.phone END AS meta
       FROM groups_chats c WHERE c.user_id = ?${gWhere} AND (c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\') ORDER BY c.last_message_at DESC LIMIT ?`,
      waGroup,
      user.id,
      ...gArgs,
      like,
      like,
    ),
    // Groups: tickets por título o número (#12).
    all(
      `SELECT t.id, t.title AS label, '#' || t.number || CASE WHEN c.name != '' THEN ' · ' || c.name ELSE '' END AS meta
       FROM groups_tickets t LEFT JOIN groups_chats c ON c.id = t.chat_id
       WHERE t.user_id = ?${gAccess ? ` AND c.id IS NOT NULL${gWhere}` : ''} AND (t.title LIKE ? ESCAPE '\\' OR t.number = ?) ORDER BY t.created_at DESC LIMIT ?`,
      user.id,
      ...gArgs,
      like,
      ticketNumber,
    ),
    // Groups: texto de los mensajes (abre el chat en ese mensaje).
    all(
      `SELECT m.id, substr(m.body, 1, 120) AS label, m.chat_id || '|' || CASE WHEN c.name != '' THEN c.name ELSE '+' || c.phone END AS meta
       FROM groups_messages m JOIN groups_chats c ON c.id = m.chat_id
       WHERE m.user_id = ?${gWhere} AND m.direction IN ('in', 'out', 'note') AND m.body LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT ?`,
      user.id,
      ...gArgs,
      like,
    ),
    // Groups: mensajes recurrentes por nombre o texto.
    all(
      `SELECT id, CASE WHEN name != '' THEN name ELSE substr(body, 1, 80) END AS label, '' AS meta
       FROM groups_recurring WHERE user_id = ? AND (name LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT ?`,
      user.id,
      like,
      like,
    ),
    // CRM: playbooks por nombre.
    all(`SELECT id, name AS label FROM crm_playbooks WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`, user.id, like),
    // CRM: formularios por nombre, presupuestos por título o número, aprobaciones
    // pendientes por nombre del deal y scores de lead scoring por nombre.
    all(`SELECT id, name AS label FROM crm_forms WHERE user_id = ? AND status != 'archived' AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`, user.id, like),
    all(
      `SELECT id, CASE WHEN title != '' THEN title ELSE number END AS label, number AS meta FROM crm_quotes
       WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR number LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?`,
      user.id,
      like,
      like,
    ),
    all(
      `SELECT a.id, d.name AS label, COALESCE(st.name, '') AS meta FROM crm_deal_approvals a
       JOIN crm_deals d ON d.id = a.deal_id LEFT JOIN crm_stages st ON st.id = a.stage_id
       WHERE a.user_id = ? AND a.status = 'pending' AND d.name LIKE ? ESCAPE '\\' ORDER BY a.created_at DESC LIMIT ?`,
      user.id,
      like,
    ),
    all(`SELECT id, name AS label FROM crm_scores WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY position ASC LIMIT ?`, user.id, like),
    // Groups: listas guardadas (las compartidas y las propias) y plantillas. Las tareas de los chats son
    // tareas del CRM (mismo id): ⌘K ya las encuentra en Tareas.
    all(
      `SELECT id, name AS label FROM groups_saved_lists WHERE user_id = ? AND (shared = 1 OR owner_id = ?) AND name LIKE ? ESCAPE '\\' ORDER BY position LIMIT ?`,
      user.id,
      person,
      like,
    ),
    all(`SELECT id, name AS label, group_name AS meta FROM groups_templates WHERE user_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`, user.id, like),
  ]);

  const map = (rows: Row[], group: AppSearchItem['group'], href: (id: string) => string): AppSearchItem[] =>
    rows.map((r) => ({ id: r.id, group, label: r.label, meta: r.meta ?? '', href: href(r.id) }));

  return [
    ...map(projects, 'projects', (id) => `/app/track/team/${id}`),
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
    ...map(groupChats.map(gMask), 'groupsChats', (id) => `/app/groups/inbox/${id}`),
    ...map(groupTickets.map(gMask), 'groupsTickets', (id) => `/app/groups/tickets?open=${id}`),
    ...map(groupRecurring, 'groupsRecurring', (id) => `/app/groups/broadcasts/recurring/${id}`),
    ...map(playbooks, 'playbooks', (id) => `/app/crm/playbooks/${id}`),
    ...map(forms, 'crmForms', (id) => `/app/crm/forms/${id}`),
    ...map(quotes, 'crmQuotes', (id) => `/app/crm/quotes/${id}`),
    ...map(approvals, 'crmApprovals', () => '/app/crm/approvals'),
    ...map(scores, 'crmScores', () => '/app/crm/settings?tab=automation'),
    ...groupMessages.map(gMask).map((r) => {
      const [chatId, ...rest] = String(r.meta ?? '').split('|');
      return { id: r.id, group: 'groupsMessages' as const, label: r.label, meta: rest.join('|'), href: `/app/groups/inbox/${chatId}#m-${r.id}` };
    }),
    ...map(groupLists, 'groupsLists', (id) => `/app/groups/inbox?list=${id}`),
    ...map(groupTemplates, 'groupsTemplates', (id) => `/app/groups/templates?use=${id}`),
  ];
}

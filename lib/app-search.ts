import { getDb } from '@/lib/db';
import { likeContains } from '@/lib/track-views';
import { trackVisibleSql } from '@/lib/track-access';
import { boardViewer, boardVisibleSql } from '@/lib/board-access';
import type { TeamRole } from '@/lib/teams';
import { chatAccessSql, groupsViewer } from '@/lib/groups-access';
import { maskPhoneText } from '@/lib/groups-mask';
import { bookingScopeFor } from './calendar-access';

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
    | 'teams'
    | 'issues'
    | 'trackViews'
    | 'trackCycles'
    | 'trackMilestones'
    | 'trackLabels'
    | 'eventTypes'
    | 'bookings'
    | 'calPolls'
    | 'widgets'
    | 'chatConversations'
    | 'chatPeople'
    | 'chatViews'
    | 'chatTeams'
    | 'chatOutbound'
    | 'flows'
    | 'agents'
    | 'robots'
    | 'groupsChats'
    | 'groupsTickets'
    | 'groupsMessages'
    | 'groupsLists'
    | 'groupsTemplates'
    | 'groupsRecurring'
    | 'voiceSessions'
    | 'talkChannels'
    | 'talkDms'
    | 'talkPeople'
    | 'workspaceTeams';
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
/** "Mensaje directo" (Talk) en el idioma de la paleta. */
const TALK_DM: Record<string, string> = { en: 'Direct message', es: 'Mensaje directo', pt: 'Mensagem direta' };
/** Carpetas y variables de Flow en la paleta (van en el grupo de flows). */
const FLOW_FOLDER: Record<string, string> = { en: 'Flow folder', es: 'Carpeta de Flow', pt: 'Pasta do Flow' };
const FLOW_VARIABLE: Record<string, string> = { en: 'Flow variable', es: 'Variable de Flow', pt: 'Variável do Flow' };

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
  // El espacio del owner (sin team) también lo comparte su equipo: filtra privados e invitados igual.
  const visible = trackVisibleSql('p', user.actingUser?.id ?? user.id);
  const projectWhere = teamId ? `p.team_id = ? AND ${visible.sql}` : `(p.team_id IS NULL AND p.owner_id = ? AND ${visible.sql})`;
  const projectArgs = [teamId ?? user.id, ...visible.args];
  const widgetWhere = teamId ? 'team_id = ?' : 'user_id = ?';
  // Pizarras: las restringidas solo para quien tiene acceso, como la lista.
  const boardsVisible = boardVisibleSql(boardViewer(user));

  const waGroup = WA_GROUP[locale] ?? WA_GROUP.en;
  // Groups: acceso por etiqueta y teléfonos ocultos, como la bandeja.
  // Reservas: un member encuentra solo las que atiende (owner y admins, todas).
  const bookingScope = bookingScopeFor(user.role ?? 'owner', user.actingUser?.id ?? user.id) ?? '';
  const gViewer = await groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role ?? 'owner').catch(() => null);
  const gAccess = chatAccessSql(gViewer, 'c');
  const gWhere = gAccess ? ` AND ${gAccess.sql}` : '';
  const gArgs = gAccess?.args ?? [];
  const gMask = (r: Row): Row => (gViewer?.mask ? { ...r, label: maskPhoneText(r.label), meta: r.meta ? maskPhoneText(r.meta) : r.meta } : r);
  const ticketNumber = /^#?\d{1,7}$/.test(needle) ? Number(needle.replace('#', '')) : -1;
  const person = user.actingUser?.id ?? user.id;
  // Track como Linear: también vistas guardadas, cycles, milestones (del team y del project) y labels.
  const ws = teamId ?? user.id;
  const planWhere = teamId ? 'pl.team_id = ?' : '(pl.team_id IS NULL AND pl.owner_id = ?)';
  const [views, cycles, milestones, planMilestones, labels] = await Promise.all([
    all(
      `SELECT v.id, v.name AS label, v.project_id AS meta FROM track_issue_views v JOIN track_projects p ON p.id = v.project_id
       WHERE ${projectWhere} AND (v.user_id = ? OR v.shared = 1) AND v.name LIKE ? ESCAPE '\\' ORDER BY v.name LIMIT ?`,
      ...projectArgs,
      person,
      like,
    ),
    all(
      `SELECT c.id, c.name AS label, c.project_id AS meta FROM track_cycles c JOIN track_projects p ON p.id = c.project_id
       WHERE ${projectWhere} AND c.name LIKE ? ESCAPE '\\' ORDER BY c.start_at DESC LIMIT ?`,
      ...projectArgs,
      like,
    ),
    all(
      `SELECT m.id, m.name AS label, m.project_id AS meta FROM track_milestones m JOIN track_projects p ON p.id = m.project_id
       WHERE ${projectWhere} AND m.name LIKE ? ESCAPE '\\' ORDER BY m.name LIMIT ?`,
      ...projectArgs,
      like,
    ),
    all(
      `SELECT m.id, m.name AS label, m.plan_id AS meta FROM track_plan_milestones m JOIN track_plans pl ON pl.id = m.plan_id
       WHERE ${planWhere} AND m.name LIKE ? ESCAPE '\\' ORDER BY m.name LIMIT ?`,
      teamId ?? user.id,
      like,
    ),
    all(`SELECT id, name AS label FROM track_labels WHERE workspace_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`, ws, like),
  ]);
  const [boards, projects, issues, eventTypes, bookings, calPolls, widgets, flows, agents, robots, groupChats, groupTickets, groupMessages, groupRecurring, playbooks, forms, quotes, approvals, scores, groupLists, groupTemplates, talkChannels, talkDms, talkPeople, voiceSessions] = await Promise.all([
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
      `SELECT id, title AS label, slug AS meta FROM calendar_event_types WHERE user_id = ? AND kind != 'poll' AND title LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
      user.id,
      like,
    ),
    // Reservas: mismo alcance que Cal › Bookings (listUserBookings: las de los
    // tipos de evento del workspace), por nombre o email del invitado.
    all(
      `SELECT b.id, b.invitee_name AS label, b.invitee_email AS email, b.invitee_email || ' · ' || e.title AS meta
       FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE e.user_id = ? AND (b.invitee_name LIKE ? ESCAPE '\\' OR b.invitee_email LIKE ? ESCAPE '\\')
         AND (? = '' OR b.host_user_id = ? OR EXISTS (SELECT 1 FROM json_each(b.co_host_ids) j WHERE j.value = ?))
       ORDER BY b.starts_at DESC LIMIT ?`,
      user.id,
      like,
      like,
      bookingScope,
      bookingScope,
      bookingScope,
    ),
    // Encuestas de horario de Cal por título.
    all(`SELECT id, title AS label FROM calendar_polls WHERE user_id = ? AND title LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`, user.id, like),
    all(`SELECT id, name AS label FROM chat_widgets WHERE ${widgetWhere} AND name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`, teamId ?? user.id, like),
    // Flows, carpetas de Flow y las variables propias (las de cada persona son suyas).
    all(
      `SELECT id, label, meta FROM (
         SELECT id, name AS label, '' AS meta, 0 AS k, updated_at AS ts FROM flow_flows WHERE user_id = ? AND name LIKE ? ESCAPE '\\'
         UNION ALL SELECT 'folder:' || id, name, ?, 1, updated_at FROM flow_folders WHERE user_id = ? AND name LIKE ? ESCAPE '\\'
         UNION ALL SELECT 'var:' || id, key, ?, 2, updated_at FROM flow_variables WHERE user_id = ? AND person_id = ? AND key LIKE ? ESCAPE '\\'
       ) ORDER BY k, ts DESC LIMIT ?`,
      user.id,
      like,
      FLOW_FOLDER[locale] ?? FLOW_FOLDER.en,
      user.id,
      like,
      FLOW_VARIABLE[locale] ?? FLOW_VARIABLE.en,
      user.id,
      user.actingUser?.id ?? user.id,
      like,
    ),
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
    // Talk: canales que la persona ve (públicos y los privados donde está) y sus DMs por el nombre de la otra persona.
    all(
      `SELECT c.id, '#' || c.name AS label, c.topic AS meta FROM talk_channels c
       WHERE c.workspace_id = ? AND c.kind IN ('public', 'private') AND c.archived_at IS NULL
         AND (c.kind = 'public' OR EXISTS (SELECT 1 FROM talk_members m WHERE m.channel_id = c.id AND m.user_id = ?))
         AND c.name LIKE ? ESCAPE '\\' ORDER BY c.name LIMIT ?`,
      user.id,
      person,
      like,
    ),
    // DMs 1:1, grupales y el DM con uno mismo: por el nombre o email de cualquiera de las personas.
    all(
      `SELECT c.id,
         COALESCE((SELECT group_concat(COALESCE(u.name, u.email), ', ') FROM talk_members o JOIN users u ON u.id = o.user_id WHERE o.channel_id = c.id AND o.user_id != ?),
                  (SELECT COALESCE(u.name, u.email) FROM users u WHERE u.id = ?)) AS label,
         ? AS meta
       FROM talk_channels c JOIN talk_members me ON me.channel_id = c.id AND me.user_id = ?
       WHERE c.workspace_id = ? AND c.kind IN ('dm', 'group')
         AND EXISTS (SELECT 1 FROM talk_members o JOIN users u ON u.id = o.user_id WHERE o.channel_id = c.id
                       AND (o.user_id != ? OR (SELECT COUNT(*) FROM talk_members x WHERE x.channel_id = c.id) = 1)
                       AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'))
       ORDER BY c.last_message_at DESC LIMIT ?`,
      person,
      person,
      TALK_DM[locale] ?? TALK_DM.en,
      person,
      user.id,
      person,
      like,
      like,
    ),
    // Personas del workspace: abrir (o empezar) un DM con ellas.
    all(
      `SELECT u.id, COALESCE(u.name, u.email) AS label, u.email AS meta FROM users u
       WHERE (u.id = ? OR u.id IN (SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.role != 'guest'))
         AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\') ORDER BY COALESCE(u.name, u.email) LIMIT ?`,
      user.id,
      user.id,
      like,
      like,
    ),
    // Voice: reuniones propias (son privadas de quien las grabó) por título o por lo que se dijo.
    all(
      `SELECT s.id, CASE WHEN s.title != '' THEN s.title ELSE substr(s.started_at, 1, 10) END AS label, substr(s.started_at, 1, 10) AS meta
       FROM voice_sessions s WHERE s.workspace_id = ? AND s.person_id = ? AND s.kind = 'meeting'
         AND (s.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM voice_segments g WHERE g.session_id = s.id AND g.text LIKE ? ESCAPE '\\'))
       ORDER BY s.started_at DESC LIMIT ?`,
      user.id,
      person,
      like,
      like,
    ),
  ]);

  // Subequipos del workspace (Ajustes › Equipos), por nombre o @handle.
  const workspaceTeams = await all(
    `SELECT g.id, g.name AS label, g.slug AS meta FROM workspace_groups g
     WHERE g.workspace_id = ? AND (g.name LIKE ? ESCAPE '\\' OR g.slug LIKE ? ESCAPE '\\') ORDER BY g.name LIMIT ?`,
    user.id,
    like,
    like,
  ).catch(() => [] as Row[]);

  // Chat: conversaciones (asunto, visitante o texto), personas, vistas guardadas y equipos.
  const chatWidgets = `SELECT id FROM chat_widgets WHERE ${widgetWhere}`;
  const [chatConversations, chatPeople, chatViews, chatTeams, chatOutbound] = await Promise.all([
    all(
      `SELECT c.id, COALESCE(NULLIF(v.name, ''), NULLIF(v.email, ''), NULLIF(c.subject, ''), 'Visitor') AS label,
              COALESCE(NULLIF(c.subject, ''), substr((SELECT m.body FROM chat_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1), 1, 80)) AS meta
       FROM chat_conversations c JOIN chat_visitors v ON v.id = c.visitor_id
       WHERE c.widget_id IN (${chatWidgets}) AND (c.subject LIKE ? ESCAPE '\\' OR v.name LIKE ? ESCAPE '\\' OR v.email LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM chat_messages sm WHERE sm.conversation_id = c.id AND sm.deleted_at IS NULL AND sm.body LIKE ? ESCAPE '\\'))
       ORDER BY c.updated_at DESC LIMIT ?`,
      teamId ?? user.id,
      like,
      like,
      like,
      like,
    ),
    all(
      `SELECT v.id, COALESCE(NULLIF(v.name, ''), v.email) AS label, v.email AS meta FROM chat_visitors v
       WHERE v.widget_id IN (${chatWidgets}) AND (v.name LIKE ? ESCAPE '\\' OR v.email LIKE ? ESCAPE '\\')
       ORDER BY v.created_at DESC LIMIT ?`,
      teamId ?? user.id,
      like,
      like,
    ),
    all(
      `SELECT id, name AS label FROM chat_views WHERE workspace_id = ? AND (user_id = ? OR shared = 1) AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`,
      user.id,
      person,
      like,
    ),
    all(`SELECT id, name AS label FROM chat_teams WHERE workspace_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`, user.id, like),
    all(
      `SELECT id, name AS label, widget_id AS meta FROM chat_outbound WHERE widget_id IN (${chatWidgets}) AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`,
      teamId ?? user.id,
      like,
    ),
  ]);

  const map = (rows: Row[], group: AppSearchItem['group'], href: (id: string) => string): AppSearchItem[] =>
    rows.map((r) => ({ id: r.id, group, label: r.label, meta: r.meta ?? '', href: href(r.id) }));

  return [
    // Los teams de Track van bajo "Teams" (los "Projects" son los de planificación).
    ...map(projects, 'teams', (id) => `/app/track/team/${id}`),
    ...views.map((r) => ({ id: r.id, group: 'trackViews' as const, label: r.label, meta: '', href: `/app/track/team/${r.meta}?savedView=${r.id}` })),
    ...cycles.map((r) => ({ id: r.id, group: 'trackCycles' as const, label: r.label, meta: '', href: `/app/track/cycles?team=${encodeURIComponent(String(r.meta))}&cycle=${r.id}` })),
    ...milestones.map((r) => ({
      id: r.id,
      group: 'trackMilestones' as const,
      label: r.label,
      meta: '',
      href: `/app/track/team/${r.meta}?filter=${encodeURIComponent(JSON.stringify({ match: 'and', rules: [{ field: 'milestone', op: 'is', values: [r.id] }] }))}`,
    })),
    ...planMilestones.map((r) => ({ id: r.id, group: 'trackMilestones' as const, label: r.label, meta: '', href: `/app/track/projects/${r.meta}` })),
    ...labels.map((r) => ({
      id: r.id,
      group: 'trackLabels' as const,
      label: r.label,
      meta: '',
      href: `/app/track/issues?filter=${encodeURIComponent(JSON.stringify({ match: 'and', rules: [{ field: 'label', op: 'is', values: [r.id] }] }))}`,
    })),
    ...map(issues, 'issues', (id) => `/app/track/issues/${id}`),
    ...map(boards, 'boards', (id) => `/app/board/${id}`),
    ...map(eventTypes, 'eventTypes', (id) => `/app/calendar/event-types/${id}`),
    ...map(calPolls, 'calPolls', (id) => `/app/calendar/polls/${id}`),
    // La reserva se abre en Bookings filtrada por el email del invitado (todas las fechas).
    ...bookings.map((r) => ({
      id: r.id,
      group: 'bookings' as const,
      label: r.label || (r.email ?? ''),
      meta: r.meta ?? '',
      href: `/app/calendar/bookings?q=${encodeURIComponent(r.email || r.label)}`,
    })),
    ...map(widgets, 'widgets', (id) => `/app/chat/widgets/${id}`),
    ...map(chatConversations, 'chatConversations', (id) => `/app/chat/inbox/${id}`),
    ...map(chatPeople, 'chatPeople', (id) => `/app/chat/people/${id}`),
    ...map(chatViews, 'chatViews', (id) => `/app/chat/inbox?view=${id}`),
    ...map(chatTeams, 'chatTeams', (id) => `/app/chat/inbox?team=${id}`),
    ...chatOutbound.map((r) => ({ id: r.id, group: 'chatOutbound' as const, label: r.label, meta: '', href: `/app/chat/widgets/${r.meta}/outbound?open=${r.id}` })),
    ...map(flows, 'flows', (id) =>
      id.startsWith('folder:') ? `/app/flow?folder=${id.slice(7)}` : id.startsWith('var:') ? '/app/flow/variables' : `/app/flow/${id}`,
    ),
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
    ...map(voiceSessions, 'voiceSessions', (id) => `/app/voice/meetings/${id}`),
    ...map(talkChannels, 'talkChannels', (id) => `/app/talk/${id}`),
    ...map(talkDms, 'talkDms', (id) => `/app/talk/${id}`),
    ...map(talkPeople, 'talkPeople', (id) => `/app/talk?dm=${encodeURIComponent(id)}`),
    ...workspaceTeams.map((r) => ({ id: r.id, group: 'workspaceTeams' as const, label: r.label, meta: `@${r.meta}`, href: '/app/settings/teams' })),
  ];
}

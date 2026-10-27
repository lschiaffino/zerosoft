/**
 * Chat — export masivo de conversaciones (CSV o JSON) de un rango de fechas,
 * desde Reportes. El JSON trae los mensajes (sin notas internas salvo que se
 * pidan); el CSV una fila por conversación. Server-only.
 */
import { getDb } from './db';
import type { ReportRange } from './chat-inbox';

function inClause(count: number): string {
  return `(${Array.from({ length: count }, () => '?').join(', ')})`;
}

export const EXPORT_MAX = 5000;

export interface ExportConversation {
  id: string;
  widget: string;
  status: string;
  priority: string;
  channel: string;
  subject: string | null;
  team: string | null;
  assignee: string | null;
  visitorName: string | null;
  visitorEmail: string | null;
  tags: string[];
  csat: number | null;
  createdAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  messages?: Array<{ from: string; author: string | null; body: string; note: boolean; createdAt: string }>;
}

export async function exportConversations(
  widgetIds: string[],
  range: ReportRange,
  opts: { withMessages?: boolean; withNotes?: boolean; status?: string } = {},
): Promise<ExportConversation[]> {
  if (widgetIds.length === 0) return [];
  const db = getDb();
  const statusSql = opts.status ? ' AND c.status = ?' : '';
  const rows = (await db
    .prepare(
      `SELECT c.id, w.name AS widget, c.status, c.priority, COALESCE(c.channel, 'web') AS channel, c.subject,
              t.name AS team, u.email AS assignee, v.name AS visitor_name, v.email AS visitor_email,
              (SELECT GROUP_CONCAT(tag, ',') FROM chat_conversation_tags g WHERE g.conversation_id = c.id) AS tags,
              c.csat_score, c.created_at, c.first_response_at, c.resolved_at
       FROM chat_conversations c
       JOIN chat_widgets w ON w.id = c.widget_id
       JOIN chat_visitors v ON v.id = c.visitor_id
       LEFT JOIN chat_teams t ON t.id = c.team_id
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.widget_id IN ${inClause(widgetIds.length)} AND c.created_at >= ? AND c.created_at < ?${statusSql}
       ORDER BY c.created_at ASC
       LIMIT ${EXPORT_MAX}`,
    )
    .all(...widgetIds, range.from, range.to, ...(opts.status ? [opts.status] : []))) as Array<Record<string, string | number | null>>;

  const out: ExportConversation[] = rows.map((r) => ({
    id: String(r.id),
    widget: String(r.widget),
    status: String(r.status),
    priority: String(r.priority),
    channel: String(r.channel),
    subject: (r.subject as string | null) ?? null,
    team: (r.team as string | null) ?? null,
    assignee: (r.assignee as string | null) ?? null,
    visitorName: (r.visitor_name as string | null) ?? null,
    visitorEmail: (r.visitor_email as string | null) ?? null,
    tags: String(r.tags ?? '').split(',').filter(Boolean),
    csat: r.csat_score == null ? null : Number(r.csat_score),
    createdAt: String(r.created_at),
    firstResponseAt: (r.first_response_at as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
  }));

  if (opts.withMessages && out.length > 0) {
    const byId = new Map(out.map((c) => [c.id, c]));
    for (const c of out) c.messages = [];
    const ids = out.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const msgs = (await db
        .prepare(
          `SELECT m.conversation_id, m.sender_type, m.body, m.is_note, m.created_at, u.email AS author
           FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
           WHERE m.conversation_id IN ${inClause(chunk.length)} AND m.deleted_at IS NULL${opts.withNotes ? '' : ' AND m.is_note = 0'}
           ORDER BY m.created_at ASC`,
        )
        .all(...chunk)) as Array<{ conversation_id: string; sender_type: string; body: string; is_note: number; created_at: string; author: string | null }>;
      for (const m of msgs) {
        byId.get(m.conversation_id)?.messages?.push({
          from: m.sender_type === 'user' ? 'teammate' : m.sender_type,
          author: m.author,
          body: m.body,
          note: Number(m.is_note) === 1,
          createdAt: m.created_at,
        });
      }
    }
  }
  return out;
}

function cell(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function exportToCsv(list: ExportConversation[]): string {
  const header = ['id', 'widget', 'status', 'priority', 'channel', 'subject', 'team', 'assignee', 'visitor_name', 'visitor_email', 'tags', 'csat', 'created_at', 'first_response_at', 'resolved_at'];
  const lines = list.map((c) =>
    [c.id, c.widget, c.status, c.priority, c.channel, c.subject, c.team, c.assignee, c.visitorName, c.visitorEmail, c.tags.join(' '), c.csat, c.createdAt, c.firstResponseAt, c.resolvedAt]
      .map(cell)
      .join(','),
  );
  return `${[header.join(','), ...lines].join('\n')}\n`;
}

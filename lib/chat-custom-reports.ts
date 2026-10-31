/**
 * Chat — reportes propios: una métrica agrupada por una dimensión, en un
 * rango de días y opcionalmente un widget. Se guardan con nombre y corren
 * siempre sobre los widgets que la persona puede ver. Server-only.
 */
import { getDb } from './db';
import { ChatCollabError } from './chat-collab';

export const REPORT_METRICS = ['conversations', 'resolved', 'resolution_rate', 'first_response', 'resolution_time', 'csat', 'messages'] as const;
export const REPORT_GROUPS = ['day', 'week', 'tag', 'widget', 'team', 'channel', 'priority', 'status', 'assignee', 'company'] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export interface SavedReport {
  id: string;
  name: string;
  metric: ReportMetric;
  group_by: ReportGroup;
  range_days: number;
  widget_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportInput {
  name?: unknown;
  metric?: unknown;
  groupBy?: unknown;
  group_by?: unknown;
  rangeDays?: unknown;
  range_days?: unknown;
  widgetId?: unknown;
  widget_id?: unknown;
}

function clean(input: ReportInput, current?: SavedReport): Omit<SavedReport, 'id' | 'created_at' | 'updated_at'> {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 80) : current?.name;
  if (!name) throw new ChatCollabError('missing_name');
  const metric = input.metric ?? current?.metric ?? 'conversations';
  const group = input.groupBy ?? input.group_by ?? current?.group_by ?? 'day';
  if (!(REPORT_METRICS as readonly unknown[]).includes(metric) || !(REPORT_GROUPS as readonly unknown[]).includes(group)) throw new ChatCollabError('invalid_input');
  const days = Number(input.rangeDays ?? input.range_days ?? current?.range_days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new ChatCollabError('invalid_input');
  const widget = input.widgetId ?? input.widget_id;
  return {
    name,
    metric: metric as ReportMetric,
    group_by: group as ReportGroup,
    range_days: days,
    widget_id: widget === undefined ? (current?.widget_id ?? null) : typeof widget === 'string' && widget ? widget.slice(0, 64) : null,
  };
}

export async function listSavedReports(workspaceId: string): Promise<SavedReport[]> {
  return (await getDb().prepare('SELECT * FROM chat_saved_reports WHERE workspace_id = ? ORDER BY name COLLATE NOCASE LIMIT 200').all(workspaceId)) as SavedReport[];
}

export async function getSavedReport(workspaceId: string, id: string): Promise<SavedReport | null> {
  return ((await getDb().prepare('SELECT * FROM chat_saved_reports WHERE workspace_id = ? AND id = ?').get(workspaceId, id)) as SavedReport | undefined) ?? null;
}

export async function createSavedReport(workspaceId: string, userId: string, input: ReportInput): Promise<SavedReport> {
  const v = clean(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare('INSERT INTO chat_saved_reports (id, workspace_id, created_by, name, metric, group_by, range_days, widget_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, userId, v.name, v.metric, v.group_by, v.range_days, v.widget_id, now, now);
  return (await getSavedReport(workspaceId, id))!;
}

export async function updateSavedReport(workspaceId: string, id: string, input: ReportInput): Promise<SavedReport | null> {
  const current = await getSavedReport(workspaceId, id);
  if (!current) return null;
  const v = clean(input, current);
  await getDb()
    .prepare('UPDATE chat_saved_reports SET name = ?, metric = ?, group_by = ?, range_days = ?, widget_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(v.name, v.metric, v.group_by, v.range_days, v.widget_id, new Date().toISOString(), id, workspaceId);
  return getSavedReport(workspaceId, id);
}

export async function deleteSavedReport(workspaceId: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM chat_saved_reports WHERE workspace_id = ? AND id = ?').run(workspaceId, id)).changes > 0;
}

// ---------- Correr ----------

interface Conv {
  id: string;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  csat_score: number | null;
  status: string;
  priority: string;
  channel: string | null;
  widget_id: string;
  widget_name: string;
  team_id: string | null;
  team_name: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  company_id: string | null;
  company_name: string | null;
  tags: string | null;
  messages: number;
}

export interface ReportResultRow {
  key: string;
  /** Lo que se muestra; para claves traducibles (estado, canal, prioridad) la UI traduce la clave. */
  label: string;
  value: number | null;
  conversations: number;
}

function ms(v: string): number {
  return Date.parse(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
}

/** Lunes de la semana (UTC) de una fecha, YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(ms(iso));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function groupsOf(c: Conv, group: ReportGroup): Array<[string, string]> {
  switch (group) {
    case 'day': {
      const k = new Date(ms(c.created_at)).toISOString().slice(0, 10);
      return [[k, k]];
    }
    case 'week': {
      const k = weekStart(c.created_at);
      return [[k, k]];
    }
    case 'tag':
      return (c.tags ? c.tags.split(',') : ['']).map((t) => [t, t]);
    case 'widget':
      return [[c.widget_id, c.widget_name]];
    case 'team':
      return [[c.team_id ?? '', c.team_name ?? '']];
    case 'channel':
      return [[c.channel ?? 'web', c.channel ?? 'web']];
    case 'priority':
      return [[c.priority, c.priority]];
    case 'status':
      return [[c.status, c.status]];
    case 'assignee':
      return [[c.assigned_to ?? '', c.assignee_name ?? '']];
    case 'company':
      return [[c.company_id ?? '', c.company_name ?? '']];
  }
}

function metricOf(metric: ReportMetric, list: Conv[]): number | null {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  switch (metric) {
    case 'conversations':
      return list.length;
    case 'resolved':
      return list.filter((c) => c.resolved_at).length;
    case 'resolution_rate':
      return list.length ? (list.filter((c) => c.resolved_at).length / list.length) * 100 : null;
    case 'first_response':
      return avg(list.filter((c) => c.first_response_at).map((c) => (ms(c.first_response_at!) - ms(c.created_at)) / 60_000));
    case 'resolution_time':
      return avg(list.filter((c) => c.resolved_at).map((c) => (ms(c.resolved_at!) - ms(c.created_at)) / 60_000));
    case 'csat':
      return avg(list.filter((c) => c.csat_score != null).map((c) => Number(c.csat_score)));
    case 'messages':
      return list.reduce((a, c) => a + Number(c.messages), 0);
  }
}

/** Pura: agrupa y calcula. Fechas en orden; lo demás de mayor a menor. */
export function aggregateReport(conversations: Conv[], metric: ReportMetric, group: ReportGroup): ReportResultRow[] {
  const map = new Map<string, { label: string; list: Conv[] }>();
  for (const c of conversations) {
    for (const [key, label] of groupsOf(c, group)) {
      const entry = map.get(key) ?? { label, list: [] };
      entry.list.push(c);
      map.set(key, entry);
    }
  }
  const rows = [...map.entries()].map(([key, e]) => ({ key, label: e.label, value: metricOf(metric, e.list), conversations: e.list.length }));
  if (group === 'day' || group === 'week') return rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, 100);
}

export async function runReport(report: Pick<SavedReport, 'metric' | 'group_by' | 'range_days' | 'widget_id'>, widgetIds: string[], now = new Date()): Promise<{ rows: ReportResultRow[]; from: string; to: string; total: number }> {
  const ids = report.widget_id ? widgetIds.filter((id) => id === report.widget_id) : widgetIds;
  const from = new Date(now.getTime() - report.range_days * 86_400_000).toISOString();
  const to = now.toISOString();
  if (ids.length === 0) return { rows: [], from, to, total: 0 };
  const conversations = (await getDb()
    .prepare(
      `SELECT c.id, c.created_at, c.first_response_at, c.resolved_at, c.csat_score, c.status, c.priority, c.channel, c.widget_id, c.assigned_to, c.team_id,
              w.name AS widget_name, t.name AS team_name, COALESCE(NULLIF(u.name, ''), u.email) AS assignee_name,
              v.company_id AS company_id, co.name AS company_name,
              (SELECT GROUP_CONCAT(tag) FROM chat_conversation_tags x WHERE x.conversation_id = c.id) AS tags,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS messages
       FROM chat_conversations c
       JOIN chat_widgets w ON w.id = c.widget_id
       LEFT JOIN chat_teams t ON t.id = c.team_id
       LEFT JOIN users u ON u.id = c.assigned_to
       LEFT JOIN chat_visitors v ON v.id = c.visitor_id
       LEFT JOIN chat_companies co ON co.id = v.company_id
       WHERE c.widget_id IN (${ids.map(() => '?').join(', ')}) AND c.created_at >= ? AND c.created_at <= ?
       LIMIT 20000`,
    )
    .all(...ids, from, to)) as Conv[];
  return { rows: aggregateReport(conversations, report.metric, report.group_by), from, to, total: conversations.length };
}

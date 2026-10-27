/**
 * Chat — reportes por desglose, como los de Intercom: bot contra humano
 * (deflexión), por tag, por widget, por equipo y por canal, horas pico y
 * cumplimiento de SLA histórico. Mismo rango que getChatRangeReport
 * (conversaciones CREADAS en el rango). Server-only.
 */
import { getDb } from './db';
import { DEFAULT_SLA_FIRST_RESPONSE_MINUTES } from './chat-data';
import type { ReportRange } from './chat-inbox';

function inClause(count: number): string {
  return `(${Array.from({ length: count }, () => '?').join(', ')})`;
}

function ts(v: string): number {
  return Date.parse(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
}

export interface BotMetrics {
  /** Conversaciones donde respondió el bot. */
  botConversations: number;
  /** Resueltas sin que respondiera nadie del equipo (deflexión). */
  botResolved: number;
  /** El bot derivó a una persona. */
  handedOff: number;
  /** botResolved / botConversations (0 a 1), o null sin conversaciones con bot. */
  resolutionRate: number | null;
}

export interface BreakdownRow {
  key: string;
  label: string;
  conversations: number;
  resolved: number;
  avgFirstResponseMinutes: number | null;
  csatAverage: number | null;
}

export interface SlaCompliance {
  /** Conversaciones con objetivo de primera respuesta (todas: hay un default). */
  firstResponseTargets: number;
  firstResponseMet: number;
  firstResponseBreached: number;
  /** Con objetivo de resolución configurado. */
  resolutionTargets: number;
  resolutionMet: number;
  resolutionBreached: number;
}

export interface ChatBreakdownReport {
  bot: BotMetrics;
  tags: BreakdownRow[];
  widgets: BreakdownRow[];
  teams: BreakdownRow[];
  channels: BreakdownRow[];
  /** hours[día 0-6, domingo = 0][hora 0-23] = conversaciones nuevas, en `timeZone`. */
  hours: number[][];
  timeZone: string;
  sla: SlaCompliance;
}

interface Row {
  id: string;
  widget_id: string;
  widget_name: string;
  team_id: string | null;
  team_name: string | null;
  channel: string | null;
  priority: string;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  csat_score: number | null;
  tags: string | null;
  bot_replies: number;
  human_replies: number;
  handoffs: number;
}

interface Acc {
  label: string;
  conversations: number;
  resolved: number;
  first: number[];
  csat: number[];
}

function bump(map: Map<string, Acc>, key: string, label: string, r: Row) {
  let a = map.get(key);
  if (!a) {
    a = { label, conversations: 0, resolved: 0, first: [], csat: [] };
    map.set(key, a);
  }
  a.conversations += 1;
  if (r.resolved_at) a.resolved += 1;
  if (r.first_response_at) a.first.push((ts(r.first_response_at) - ts(r.created_at)) / 60_000);
  if (r.csat_score != null) a.csat.push(r.csat_score);
}

function rows(map: Map<string, Acc>, limit = 20): BreakdownRow[] {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [...map.entries()]
    .map(([key, a]) => ({
      key,
      label: a.label,
      conversations: a.conversations,
      resolved: a.resolved,
      avgFirstResponseMinutes: avg(a.first),
      csatAverage: avg(a.csat),
    }))
    .sort((x, y) => y.conversations - x.conversations || x.label.localeCompare(y.label))
    .slice(0, limit);
}

/** Día de la semana y hora en la zona dada (UTC si la zona no existe). */
export function weekdayHour(date: Date, timeZone: string): { day: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(date);
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), hour };
  } catch {
    return { day: date.getUTCDay(), hour: date.getUTCHours() };
  }
}

export async function getChatBreakdownReport(
  widgetIds: string[],
  range: ReportRange,
  opts: { timeZone?: string; now?: Date } = {},
): Promise<ChatBreakdownReport> {
  const timeZone = opts.timeZone || 'UTC';
  const now = (opts.now ?? new Date()).getTime();
  const hours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const empty: ChatBreakdownReport = {
    bot: { botConversations: 0, botResolved: 0, handedOff: 0, resolutionRate: null },
    tags: [],
    widgets: [],
    teams: [],
    channels: [],
    hours,
    timeZone,
    sla: { firstResponseTargets: 0, firstResponseMet: 0, firstResponseBreached: 0, resolutionTargets: 0, resolutionMet: 0, resolutionBreached: 0 },
  };
  if (widgetIds.length === 0) return empty;
  const db = getDb();
  const list = (await db
    .prepare(
      `SELECT c.id, c.widget_id, w.name AS widget_name, c.team_id, t.name AS team_name, c.channel, c.priority,
              c.created_at, c.first_response_at, c.resolved_at, c.csat_score,
              (SELECT GROUP_CONCAT(tag, ',') FROM chat_conversation_tags g WHERE g.conversation_id = c.id) AS tags,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender_type = 'bot') AS bot_replies,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender_type = 'user' AND m.is_note = 0 AND m.deleted_at IS NULL) AS human_replies,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender_type = 'system' AND m.body LIKE 'AI handoff:%') AS handoffs
       FROM chat_conversations c
       JOIN chat_widgets w ON w.id = c.widget_id
       LEFT JOIN chat_teams t ON t.id = c.team_id
       WHERE c.widget_id IN ${inClause(widgetIds.length)} AND c.created_at >= ? AND c.created_at < ?
       ORDER BY c.created_at DESC
       LIMIT 20000`,
    )
    .all(...widgetIds, range.from, range.to)) as Row[];

  const policies = (await db
    .prepare(`SELECT widget_id, priority, first_response_minutes, resolution_minutes FROM chat_sla_policies WHERE widget_id IN ${inClause(widgetIds.length)} AND active = 1`)
    .all(...widgetIds)) as Array<{ widget_id: string; priority: string; first_response_minutes: number; resolution_minutes: number | null }>;
  const policy = new Map(policies.map((p) => [`${p.widget_id}:${p.priority}`, p]));

  const bot = { botConversations: 0, botResolved: 0, handedOff: 0 };
  const tags = new Map<string, Acc>();
  const widgets = new Map<string, Acc>();
  const teams = new Map<string, Acc>();
  const channels = new Map<string, Acc>();
  const sla = { ...empty.sla };

  for (const r of list) {
    const botReplies = Number(r.bot_replies);
    const humanReplies = Number(r.human_replies);
    if (botReplies > 0) {
      bot.botConversations += 1;
      if (Number(r.handoffs) > 0) bot.handedOff += 1;
      if (r.resolved_at && humanReplies === 0) bot.botResolved += 1;
    }
    for (const tag of (r.tags ?? '').split(',').filter(Boolean)) bump(tags, tag, `#${tag}`, r);
    bump(widgets, r.widget_id, r.widget_name, r);
    if (r.team_id) bump(teams, r.team_id, r.team_name ?? r.team_id, r);
    const ch = r.channel === 'email' ? 'email' : 'web';
    bump(channels, ch, ch, r);

    const created = ts(r.created_at);
    const { day, hour } = weekdayHour(new Date(created), timeZone);
    if (day >= 0) hours[day][hour] += 1;

    const p = policy.get(`${r.widget_id}:${r.priority}`);
    const firstDue = created + (p?.first_response_minutes ?? DEFAULT_SLA_FIRST_RESPONSE_MINUTES) * 60_000;
    sla.firstResponseTargets += 1;
    if (r.first_response_at) {
      if (ts(r.first_response_at) <= firstDue) sla.firstResponseMet += 1;
      else sla.firstResponseBreached += 1;
    } else if (now > firstDue) {
      sla.firstResponseBreached += 1;
    }
    if (p?.resolution_minutes != null) {
      const resDue = created + p.resolution_minutes * 60_000;
      sla.resolutionTargets += 1;
      if (r.resolved_at) {
        if (ts(r.resolved_at) <= resDue) sla.resolutionMet += 1;
        else sla.resolutionBreached += 1;
      } else if (now > resDue) {
        sla.resolutionBreached += 1;
      }
    }
  }

  return {
    bot: { ...bot, resolutionRate: bot.botConversations ? bot.botResolved / bot.botConversations : null },
    tags: rows(tags),
    widgets: rows(widgets),
    teams: rows(teams),
    channels: rows(channels, 2),
    hours,
    timeZone,
    sla,
  };
}

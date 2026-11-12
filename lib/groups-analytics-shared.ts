/**
 * Lines, reportes: tipos y funciones puras de las pestañas. Lo común a todos
 * los productos (zona horaria, rango, percentiles, CSV) vive en el kit
 * (lib/analytics/period.ts) y se reexporta acá. Sin base ni APIs del
 * servidor: lo usan el servidor, los componentes del cliente y los tests.
 */

import type { Kpi, RangeInfo } from './analytics-kit/period';

export {
  ANALYTICS_PERIODS,
  ANALYTICS_TZ_COOKIE,
  MAX_RANGE_DAYS,
  RESPONSE_BUCKETS,
  addDays,
  analyticsRange,
  csvCell,
  dayList,
  delta,
  isDay,
  localDay,
  median,
  responseBuckets,
  share,
  toCsv,
  tzOffsetSec,
  tzOffsetSql,
  tzSegments,
  validTz,
  weightedQuantile,
  zonedMidnight,
  type AnalyticsRange,
  type Kpi,
  type RangeInfo,
  type RangeInput,
  type TzSegment,
} from './analytics-kit/period';

export const ANALYTICS_TABS = ['overview', 'conversations', 'response', 'team', 'groups', 'broadcasts', 'tickets', 'labels'] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

export function analyticsTab(raw: string | undefined | null): AnalyticsTab {
  return (ANALYTICS_TABS as readonly string[]).includes(raw ?? '') ? (raw as AnalyticsTab) : 'overview';
}

// ---------- Datos por pestaña ----------

export interface DayPoint {
  day: string;
  inbound: number;
  outbound: number;
}

export interface LineStat {
  /** null: una línea que ya no existe. */
  id: string | null;
  name: string | null;
  inbound: number;
  outbound: number;
  activeChats: number;
  prevTotal: number;
}

export interface ChatStat {
  id: string;
  name: string;
  kind: 'dm' | 'group';
  inbound: number;
  outbound: number;
  members: number;
  lastAt: string | null;
}

export interface OverviewData {
  tab: 'overview';
  range: RangeInfo;
  kpis: { inbound: Kpi; outbound: Kpi; activeChats: Kpi; newChats: Kpi; firstResponseMin: Kpi; ticketsCreated: Kpi; awaiting: Kpi; openTickets: Kpi };
  responses: number;
  perDay: DayPoint[];
  prevPerDay: DayPoint[];
  lines: LineStat[];
  topChats: ChatStat[];
}

export interface ConversationsData {
  tab: 'conversations';
  range: RangeInfo;
  kpis: { inbound: Kpi; outbound: Kpi; activeChats: Kpi; newChats: Kpi; newGroups: Kpi; perChat: Kpi };
  perDay: DayPoint[];
  prevPerDay: DayPoint[];
  newPerDay: Array<{ day: string; value: number }>;
  /** [día de la semana 0 = lunes][hora 0-23]: mensajes recibidos. */
  heatmap: number[][];
  lines: LineStat[];
}

export interface WaitingChat {
  id: string;
  name: string;
  kind: 'dm' | 'group';
  since: string;
}

export interface ResponseData {
  tab: 'response';
  range: RangeInfo;
  kpis: { medianMin: Kpi; p90Min: Kpi; responses: Kpi; unanswered: Kpi; awaiting: Kpi; resolutionMin: Kpi; breached: Kpi };
  perDay: Array<{ day: string; medianMin: number | null; responses: number }>;
  /** Cantidad de respuestas por tramo (RESPONSE_BUCKETS + el resto). */
  buckets: number[];
  /** Chats esperando ahora por antigüedad: < 1 h, < 4 h, < 24 h, < 3 días, más. */
  waitingAges: number[];
  waiting: WaitingChat[];
}

export type SenderKind = 'person' | 'phone' | 'ai' | 'auto';

export interface AgentStat {
  key: string;
  kind: SenderKind;
  /** null si la persona ya no está en el workspace o no es una persona. */
  id: string | null;
  name: string | null;
  sent: number;
  prevSent: number;
  chats: number;
  responses: number;
  medianMin: number | null;
  assigned: number;
  closed: number;
  openChats: number;
  ticketsResolved: number;
}

export interface TeamData {
  tab: 'team';
  range: RangeInfo;
  kpis: { people: Kpi; sent: Kpi; perPerson: Kpi; assignments: Kpi; unassigned: Kpi };
  agents: AgentStat[];
}

export interface GroupsData {
  tab: 'groups';
  range: RangeInfo;
  kpis: { groups: Kpi; active: Kpi; quiet: Kpi; messages: Kpi; members: Kpi };
  perDay: DayPoint[];
  prevPerDay: DayPoint[];
  top: ChatStat[];
}

export interface BroadcastStat {
  id: string;
  name: string;
  at: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  /** null: fuera del detalle (solo se leen los recibos de los últimos envíos). */
  delivered: number | null;
  read: number | null;
  replied: number | null;
}

export interface BroadcastsData {
  tab: 'broadcasts';
  range: RangeInfo;
  kpis: { broadcasts: Kpi; recipients: Kpi; sent: Kpi; failed: Kpi };
  /** Embudo de los envíos con detalle. */
  funnel: { broadcasts: number; sent: number; delivered: number; read: number; replied: number };
  rows: BroadcastStat[];
}

export interface TicketsData {
  tab: 'tickets';
  range: RangeInfo;
  kpis: { created: Kpi; resolved: Kpi; open: Kpi; resolutionMin: Kpi; breached: Kpi; tasksCreated: Kpi; tasksOpen: Kpi; tasksOverdue: Kpi };
  perDay: Array<{ day: string; created: number; resolved: number }>;
  byPriority: Array<{ key: string; value: number }>;
  bySource: Array<{ key: string; value: number }>;
  byStatus: Array<{ key: string; value: number }>;
  tasksDone: number;
}

export interface LabelStat {
  id: string;
  name: string;
  color: string;
  chats: number;
  awaiting: number;
  activeChats: number;
  inbound: number;
  outbound: number;
}

export interface LabelsData {
  tab: 'labels';
  range: RangeInfo;
  kpis: { labels: Kpi; labelled: Kpi; unlabelled: Kpi };
  rows: LabelStat[];
}

export type AnalyticsData = OverviewData | ConversationsData | ResponseData | TeamData | GroupsData | BroadcastsData | TicketsData | LabelsData;

/** ¿La pestaña no tiene nada que mostrar en el período? */
export function isEmptyData(d: AnalyticsData): boolean {
  switch (d.tab) {
    case 'overview':
      return !d.kpis.inbound.value && !d.kpis.outbound.value && !d.kpis.ticketsCreated.value && !d.kpis.newChats.value;
    case 'conversations':
      return !d.kpis.inbound.value && !d.kpis.outbound.value && !d.kpis.newChats.value;
    case 'response':
      return !d.kpis.responses.value && !d.kpis.unanswered.value && !d.kpis.awaiting.value && d.kpis.resolutionMin.value == null && !d.kpis.breached.value;
    case 'team':
      return d.agents.length === 0;
    case 'groups':
      return !d.kpis.groups.value;
    case 'broadcasts':
      return d.rows.length === 0;
    case 'tickets':
      return !d.kpis.created.value && !d.kpis.resolved.value && !d.kpis.open.value && !d.kpis.tasksCreated.value && !d.kpis.tasksOpen.value;
    case 'labels':
      return d.rows.length === 0;
  }
}

// ---------- CSV ----------

/** Filas del CSV de una pestaña (encabezados en inglés, como el resto de los exports). */
export function analyticsCsvRows(d: AnalyticsData): unknown[][] {
  switch (d.tab) {
    case 'overview':
    case 'conversations':
    case 'groups':
      return [['day', 'received', 'sent', 'previous_received', 'previous_sent'], ...d.perDay.map((p, i) => [p.day, p.inbound, p.outbound, d.prevPerDay[i]?.inbound ?? '', d.prevPerDay[i]?.outbound ?? ''])];
    case 'response':
      return [['day', 'first_response_median_min', 'responses'], ...d.perDay.map((p) => [p.day, p.medianMin ?? '', p.responses])];
    case 'team':
      return [
        ['sender', 'kind', 'messages_sent', 'chats', 'first_responses', 'first_response_median_min', 'assignments', 'chats_closed', 'open_chats', 'tickets_resolved'],
        ...d.agents.map((a) => [a.name ?? a.kind, a.kind, a.sent, a.chats, a.responses, a.medianMin ?? '', a.assigned, a.closed, a.openChats, a.ticketsResolved]),
      ];
    case 'broadcasts':
      return [
        ['broadcast', 'date', 'status', 'recipients', 'sent', 'failed', 'delivered', 'read', 'replied'],
        ...d.rows.map((b) => [b.name, b.at, b.status, b.total, b.sent, b.failed, b.delivered ?? '', b.read ?? '', b.replied ?? '']),
      ];
    case 'tickets':
      return [['day', 'tickets_created', 'tickets_resolved'], ...d.perDay.map((p) => [p.day, p.created, p.resolved])];
    case 'labels':
      return [['label', 'chats', 'waiting', 'active_chats', 'received', 'sent'], ...d.rows.map((l) => [l.name, l.chats, l.awaiting, l.activeChats, l.inbound, l.outbound])];
  }
}

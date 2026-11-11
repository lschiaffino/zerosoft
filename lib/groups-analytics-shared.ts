/**
 * Lines, reportes: tipos y funciones puras (zona horaria, rango, percentiles,
 * CSV). Sin base ni APIs del servidor: lo usan el servidor, los componentes
 * del cliente y los tests.
 */

export const ANALYTICS_TABS = ['overview', 'conversations', 'response', 'team', 'groups', 'broadcasts', 'tickets', 'labels'] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];
export const ANALYTICS_PERIODS = [7, 30, 90] as const;
/** Tope de un rango propio: un año. Más que eso no se lee de la base. */
export const MAX_RANGE_DAYS = 366;
/** Cookie con la zona horaria del navegador (la pone el tablero al abrirse). */
export const ANALYTICS_TZ_COOKIE = 'zs_tz';

export function analyticsTab(raw: string | undefined | null): AnalyticsTab {
  return (ANALYTICS_TABS as readonly string[]).includes(raw ?? '') ? (raw as AnalyticsTab) : 'overview';
}

// ---------- Zona horaria ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

/** Zona IANA válida o UTC. */
export function validTz(tz: string | undefined | null): string {
  if (!tz || tz.length > 64) return 'UTC';
  try {
    formatter(tz);
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Segundos que hay que sumarle a UTC para tener la hora local en ese instante. */
export function tzOffsetSec(ms: number, tz: string): number {
  if (tz === 'UTC') return 0;
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((local - Math.floor(ms / 1000) * 1000) / 1000);
}

/** Un día de calendario real (no 2026-02-30), entre 1970 y 9999: antes de eso no hay mensajes ni offsets confiables. */
export function isDay(v: string | undefined | null): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v) || v < '1970-01-02' || v > '9999-01-01') return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

/** Día de calendario ± n. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Día local (YYYY-MM-DD) de un instante. */
export function localDay(ms: number, tz: string): string {
  return new Date(ms + tzOffsetSec(ms, tz) * 1000).toISOString().slice(0, 10);
}

/** Instante UTC de la medianoche local de ese día. */
export function zonedMidnight(day: string, tz: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const first = guess - tzOffsetSec(guess, tz) * 1000;
  return guess - tzOffsetSec(first, tz) * 1000;
}

export interface TzSegment {
  /** Desde este segundo UTC (incluido) vale `offsetSec`. El primero arranca en -∞. */
  fromSec: number;
  offsetSec: number;
}

/**
 * Tramos de offset constante entre dos instantes (cambios de hora). Con esto
 * el SQL calcula el día y la hora local exactos sin traer los mensajes.
 */
export function tzSegments(tz: string, fromMs: number, toMs: number): TzSegment[] {
  const out: TzSegment[] = [{ fromSec: Number.NEGATIVE_INFINITY, offsetSec: tzOffsetSec(fromMs, tz) }];
  if (tz === 'UTC') return out;
  let t = fromMs;
  let off = out[0].offsetSec;
  while (t < toMs) {
    const next = Math.min(t + DAY_MS, toMs);
    const nextOff = tzOffsetSec(next, tz);
    if (nextOff !== off) {
      // El cambio está en (t, next]: se busca al minuto.
      let lo = t;
      let hi = next;
      while (hi - lo > 60_000) {
        const mid = lo + Math.max(1, Math.floor((hi - lo) / 120_000)) * 60_000;
        if (tzOffsetSec(mid, tz) === off) lo = mid;
        else hi = mid;
      }
      out.push({ fromSec: Math.floor(hi / 1000), offsetSec: nextOff });
      off = nextOff;
    }
    t = next;
  }
  return out;
}

/** Expresión SQL (enteros en línea, sin parámetros) del offset local para la columna de segundos `col`. */
export function tzOffsetSql(segments: TzSegment[], col: string): string {
  if (segments.length <= 1) return String(Math.trunc(segments[0]?.offsetSec ?? 0));
  const whens = segments.slice(1).map((s, i) => `WHEN ${col} < ${Math.trunc(s.fromSec)} THEN ${Math.trunc(segments[i].offsetSec)}`);
  return `(CASE ${whens.join(' ')} ELSE ${Math.trunc(segments[segments.length - 1].offsetSec)} END)`;
}

// ---------- Rango ----------

export interface AnalyticsRange {
  tz: string;
  /** Rango del período: [since, until) en ISO. */
  since: string;
  until: string;
  /** El período anterior, del mismo largo: [prevSince, since). */
  prevSince: string;
  days: number;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  custom: boolean;
  /** El rango pedido era más largo que el tope y se recortó. */
  clipped: boolean;
}

export interface RangeInput {
  days?: number;
  from?: string;
  to?: string;
  tz?: string;
}

/**
 * Rango del reporte en días de calendario de la zona de quien mira: los
 * últimos `days` (hoy incluido) o un rango propio (inclusive, hasta un año).
 * Un rango invertido se ignora. Puro.
 */
export function analyticsRange(input: RangeInput = {}, now = new Date()): AnalyticsRange {
  const tz = validTz(input.tz);
  const today = localDay(now.getTime(), tz);
  let from: string;
  let to: string;
  let custom = false;
  let clipped = false;
  if (isDay(input.from) && (!isDay(input.to) || input.to >= input.from)) {
    custom = true;
    from = input.from;
    to = isDay(input.to) ? input.to : today < from ? from : today;
    if (to > addDays(from, MAX_RANGE_DAYS - 1)) {
      to = addDays(from, MAX_RANGE_DAYS - 1);
      clipped = true;
    }
  } else {
    const n = Math.min(MAX_RANGE_DAYS, Math.max(1, Math.round(Number(input.days) || 30)));
    to = today;
    from = addDays(today, -(n - 1));
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  const prevFrom = addDays(from, -days);
  return {
    tz,
    since: new Date(zonedMidnight(from, tz)).toISOString(),
    until: new Date(zonedMidnight(addDays(to, 1), tz)).toISOString(),
    prevSince: new Date(zonedMidnight(prevFrom, tz)).toISOString(),
    days,
    from,
    to,
    prevFrom,
    prevTo: addDays(from, -1),
    custom,
    clipped,
  };
}

export function dayList(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}

// ---------- Números ----------

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Cuantil de una distribución dada como [valor, cantidad]. q = 0.5 es la
 * mediana (promedio de las dos del medio si es par); el resto, rango más
 * cercano. null sin muestras.
 */
export function weightedQuantile(pairs: Array<[number, number]>, q: number): number | null {
  const sorted = pairs.filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return null;
  const at = (rank: number): number => {
    let seen = 0;
    for (const [v, n] of sorted) {
      seen += n;
      if (seen >= rank) return v;
    }
    return sorted[sorted.length - 1][0];
  };
  if (q === 0.5) return total % 2 ? at((total + 1) / 2) : Math.round((at(total / 2) + at(total / 2 + 1)) / 2);
  return at(Math.min(total, Math.max(1, Math.ceil(q * total))));
}

/** Cambio contra el período anterior en fracción (0.25 = +25 %). null si no hay con qué comparar. */
export function delta(value: number | null | undefined, prev: number | null | undefined): number | null {
  if (value == null || prev == null || !Number.isFinite(value) || !Number.isFinite(prev) || prev === 0) return null;
  return (value - prev) / prev;
}

/** Fracción segura: 0 si el divisor es 0. */
export function share(part: number, total: number): number {
  return total > 0 && Number.isFinite(part) ? Math.min(1, Math.max(0, part / total)) : 0;
}

/** Tramos de la primera respuesta, en minutos (límite superior exclusivo; el último no tiene tope). */
export const RESPONSE_BUCKETS = [5, 15, 60, 240, 1440] as const;

export function responseBuckets(pairs: Array<[number, number]>): number[] {
  const out = new Array<number>(RESPONSE_BUCKETS.length + 1).fill(0);
  for (const [min, n] of pairs) {
    const i = RESPONSE_BUCKETS.findIndex((b) => min < b);
    out[i === -1 ? RESPONSE_BUCKETS.length : i] += n;
  }
  return out;
}

// ---------- Datos por pestaña ----------

export interface Kpi {
  value: number | null;
  /** Mismo dato en el período anterior. undefined: no se compara (es una foto de ahora). */
  prev?: number | null;
}

export interface DayPoint {
  day: string;
  inbound: number;
  outbound: number;
}

export interface RangeInfo {
  from: string;
  to: string;
  days: number;
  tz: string;
  prevFrom: string;
  prevTo: string;
  custom: boolean;
  clipped: boolean;
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

/** Celda CSV: comillas si hace falta y sin fórmulas (= + - @ al inicio). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

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

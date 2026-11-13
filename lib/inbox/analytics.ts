/**
 * Inbox, analítica: lo que pasó en el Inbox de una persona (WhatsApp, Gmail y
 * grupos) en un período, contra el anterior. Todo sale de sus propias filas
 * (owner_id = su id real): el Inbox es personal, ni el workspace ni sus
 * admins lo ven, así que no hay vista de equipo ni se mezcla con nadie.
 *
 * Una pasada por los mensajes de los dos períodos (índice
 * idx_inbox_messages_owner_sent) de la que salen todas las series, y una por
 * los chats para lo que se cerró, se archivó y lo que espera ahora.
 */
import { getDb } from '../db';
import {
  RESPONSE_BUCKETS,
  analyticsRange,
  dayIndexSql,
  daySeries,
  hourSql,
  idxDay,
  num,
  rangeInfo,
  rangeSegments,
  responseBuckets,
  sumOf,
  weekdaySql,
  weightedQuantile,
  type AnalyticsRange,
  type Kpi,
  type RangeInfo,
  type RangeInput,
} from '../analytics-kit/period';
import { shortCache } from '../analytics-kit/cache';
import { WAITING_AFTER_MS } from './types';

export { RESPONSE_BUCKETS };

/** Por dónde llegó: WhatsApp (chats de a dos), email (Gmail) o grupos de WhatsApp. */
export const INBOX_CHANNELS = ['whatsapp', 'email', 'groups'] as const;
export type InboxAnalyticsChannel = (typeof INBOX_CHANNELS)[number];

export interface InboxDay {
  day: string;
  received: number;
  sent: number;
  whatsapp: number;
  email: number;
  groups: number;
  done: number;
}

export interface InboxChannelStat {
  key: InboxAnalyticsChannel;
  received: number;
  sent: number;
  /** Chats con algún mensaje en el período. */
  threads: number;
  /** Mensajes (recibidos + enviados) del período anterior. */
  prevTotal: number;
}

export interface InboxThreadStat {
  id: string;
  title: string;
  channel: InboxAnalyticsChannel;
  received: number;
  sent: number;
}

export interface InboxAnalytics {
  range: RangeInfo;
  kpis: {
    received: Kpi;
    sent: Kpi;
    threads: Kpi;
    /** Mediana de minutos hasta tu primera respuesta (chats de a dos y email). */
    firstResponseMin: Kpi;
    /** Chats esperando tu respuesta, ahora. */
    toReply: Kpi;
    /** Chats donde respondiste y esperás hace más de un día, ahora. */
    waiting: Kpi;
    done: Kpi;
    archived: Kpi;
  };
  perDay: InboxDay[];
  prevPerDay: InboxDay[];
  /** Mediana de la primera respuesta por día (null sin respuestas ese día). */
  responsePerDay: Array<{ day: string; medianMin: number | null; responses: number }>;
  /** Respuestas por tramo de RESPONSE_BUCKETS (y el resto). */
  buckets: number[];
  byChannel: InboxChannelStat[];
  /** [día de la semana, 0 = lunes][hora local]: mensajes recibidos. */
  heatmap: number[][];
  topThreads: InboxThreadStat[];
}

type Arg = string | number;

interface FactRow {
  k: string;
  a: string | number | null;
  b: string | number | null;
  c: string | number | null;
  n1: number | null;
  n2: number | null;
  n3: number | null;
}

/** El canal de un chat en SQL (alias t de inbox_threads). */
const CHANNEL_SQL = `CASE WHEN t.channel = 'gmail' THEN 'email' WHEN t.kind = 'group' THEN 'groups' ELSE 'whatsapp' END`;

/**
 * El SQL de los mensajes de los dos períodos y sus argumentos (exportado para
 * revisar el plan en los tests). Una sola lectura por rango con índice; cada
 * sección agrega algo distinto de la misma CTE.
 */
export function inboxFactsSql(owner: string, range: AnalyticsRange, topLimit = 8): { sql: string; args: Arg[] } {
  const segments = rangeSegments(range);
  const day = dayIndexSql(segments, 'x.ts');
  const hour = hourSql(segments, 'x.ts');
  const sql = `WITH b AS MATERIALIZED (
      SELECT x.*, ${day} AS day, ${hour} AS hour FROM (
        SELECT m.id, m.thread_id, m.from_me, m.sent_at AS at, CAST(strftime('%s', m.sent_at) AS INTEGER) AS ts,
               CASE WHEN m.sent_at >= ? THEN 1 ELSE 0 END AS cur, ${CHANNEL_SQL} AS ch
        FROM inbox_messages m
        JOIN inbox_threads t ON t.id = m.thread_id
        WHERE m.owner_id = ? AND m.sent_at >= ? AND m.sent_at < ? AND m.hidden_at IS NULL AND t.owner_id = m.owner_id
      ) x
    ),
    s AS (
      SELECT id, thread_id, from_me, at, ts, cur, day, LAG(from_me) OVER (PARTITION BY thread_id ORDER BY at, id) AS prev
      FROM b WHERE ch != 'groups'
    ),
    p AS MATERIALIZED (
      SELECT from_me, cur, day, ts, LEAD(ts) OVER (PARTITION BY thread_id ORDER BY at, id) AS rts
      FROM s WHERE prev IS NULL OR prev != from_me
    )
    SELECT 'd' AS k, day AS a, ch AS b, NULL AS c, SUM(from_me = 0) AS n1, SUM(from_me = 1) AS n2, 0 AS n3 FROM b GROUP BY day, ch
    UNION ALL
    SELECT 'c', ch, cur, NULL, SUM(from_me = 0), SUM(from_me = 1), COUNT(DISTINCT thread_id) FROM b GROUP BY ch, cur
    UNION ALL
    SELECT 't', cur, NULL, NULL, COUNT(DISTINCT thread_id), 0, 0 FROM b GROUP BY cur
    UNION ALL
    SELECT 'hm', ${weekdaySql('day')} AS wd, hour, NULL, COUNT(*), 0, 0 FROM b WHERE cur = 1 AND from_me = 0 GROUP BY wd, hour
    UNION ALL
    SELECT 'r', cur, day, NULL, (rts - ts + 30) / 60 AS mins, COUNT(*), 0 FROM p WHERE from_me = 0 AND rts IS NOT NULL GROUP BY cur, day, mins
    UNION ALL
    SELECT * FROM (SELECT 'top', thread_id, NULL, NULL, SUM(from_me = 0), SUM(from_me = 1), COUNT(*) FROM b WHERE cur = 1
      GROUP BY thread_id ORDER BY COUNT(*) DESC, thread_id LIMIT ${Math.trunc(topLimit)})`;
  return { sql, args: [range.since, owner, range.prevSince, range.until] };
}

/** Lo que se cerró y archivó por día (los dos períodos) y lo que espera ahora. */
async function threadFacts(owner: string, range: AnalyticsRange, now: Date): Promise<{ done: FactRow[]; archived: Kpi; toReply: number; waiting: number }> {
  const db = getDb();
  const segments = rangeSegments(range);
  const nowS = now.toISOString();
  const [doneRows, counts] = await Promise.all([
    db
      .prepare(
        `SELECT 'done' AS k, ${dayIndexSql(segments, "CAST(strftime('%s', done_at) AS INTEGER)")} AS a, NULL AS b, NULL AS c, COUNT(*) AS n1, 0 AS n2, 0 AS n3
         FROM inbox_threads WHERE owner_id = ? AND done_at >= ? AND done_at < ? GROUP BY a`,
      )
      .all(owner, range.prevSince, range.until) as Promise<FactRow[]>,
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM inbox_threads WHERE owner_id = ? AND archived_at >= ? AND archived_at < ?) AS archived,
           (SELECT COUNT(*) FROM inbox_threads WHERE owner_id = ? AND archived_at >= ? AND archived_at < ?) AS prev_archived,
           (SELECT COUNT(*) FROM inbox_threads INDEXED BY idx_inbox_threads_reply WHERE owner_id = ? AND done_at IS NULL AND archived_at IS NULL
              AND last_from_me = 0 AND kind <> 'group' AND last_message_at IS NOT NULL AND (snoozed_until IS NULL OR snoozed_until <= ?)) AS to_reply,
           (SELECT COUNT(*) FROM inbox_threads WHERE owner_id = ? AND done_at IS NULL AND archived_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?)
              AND last_from_me = 1 AND last_outbound_at < ?) AS waiting`,
      )
      .get(
        owner,
        range.since,
        range.until,
        owner,
        range.prevSince,
        range.since,
        owner,
        nowS,
        owner,
        nowS,
        new Date(now.getTime() - WAITING_AFTER_MS).toISOString(),
      ) as Promise<Record<string, unknown> | undefined>,
  ]);
  return {
    done: doneRows,
    archived: { value: num(counts?.archived), prev: num(counts?.prev_archived) },
    toReply: num(counts?.to_reply),
    waiting: num(counts?.waiting),
  };
}

const emptyDay = (): Omit<InboxDay, 'day'> => ({ received: 0, sent: 0, whatsapp: 0, email: 0, groups: 0, done: 0 });

/**
 * La analítica del Inbox de una persona. `owner` es su id real (nunca el del
 * workspace): solo se leen sus filas.
 */
export async function inboxAnalytics(owner: string, query: RangeInput = {}, opts: { now?: Date } = {}): Promise<InboxAnalytics> {
  const now = opts.now ?? new Date();
  const range = analyticsRange(query, now);
  const { sql, args } = inboxFactsSql(owner, range);
  const [rows, threads] = await Promise.all([getDb().prepare(sql).all(...args) as Promise<FactRow[]>, threadFacts(owner, range, now)]);

  const byDay = new Map<string, Omit<InboxDay, 'day'>>();
  const at = (day: string) => {
    let v = byDay.get(day);
    if (!v) byDay.set(day, (v = emptyDay()));
    return v;
  };
  for (const r of rows) {
    if (r.k !== 'd') continue;
    const v = at(idxDay(r.a));
    const ch = String(r.b) as InboxAnalyticsChannel;
    const total = num(r.n1) + num(r.n2);
    v.received += num(r.n1);
    v.sent += num(r.n2);
    if (ch === 'email' || ch === 'groups' || ch === 'whatsapp') v[ch] += total;
  }
  for (const r of threads.done) at(idxDay(r.a)).done += num(r.n1);
  const { cur: perDay, prev: prevPerDay } = daySeries(range, byDay, emptyDay);

  const channel = (key: InboxAnalyticsChannel, cur: number) => rows.find((r) => r.k === 'c' && r.a === key && num(r.b) === cur);
  const byChannel: InboxChannelStat[] = INBOX_CHANNELS.map((key) => {
    const c = channel(key, 1);
    const p = channel(key, 0);
    return { key, received: num(c?.n1), sent: num(c?.n2), threads: num(c?.n3), prevTotal: num(p?.n1) + num(p?.n2) };
  });
  const threadsKpi = (cur: number) => num(rows.find((r) => r.k === 't' && num(r.a) === cur)?.n1);

  const pairs = (cur: number): Array<[number, number]> => rows.filter((r) => r.k === 'r' && num(r.a) === cur).map((r) => [Math.max(0, num(r.n1)), num(r.n2)]);
  const curPairs = pairs(1);
  const perDayPairs = new Map<string, Array<[number, number]>>();
  for (const r of rows) {
    if (r.k !== 'r' || num(r.a) !== 1) continue;
    const d = idxDay(r.b);
    const list = perDayPairs.get(d) ?? [];
    list.push([Math.max(0, num(r.n1)), num(r.n2)]);
    perDayPairs.set(d, list);
  }
  const responsePerDay = perDay.map((p) => {
    const list = perDayPairs.get(p.day) ?? [];
    return { day: p.day, medianMin: weightedQuantile(list, 0.5), responses: sumOf(list, ([, n]) => n) };
  });

  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) {
    if (r.k !== 'hm') continue;
    const d = num(r.a);
    const h = num(r.b);
    if (d >= 0 && d < 7 && h >= 0 && h < 24) heatmap[d][h] += num(r.n1);
  }

  const topRows = rows.filter((r) => r.k === 'top');
  const titles = new Map<string, { title: string; channel: InboxAnalyticsChannel }>();
  if (topRows.length) {
    const ids = topRows.map((r) => String(r.a));
    const found = (await getDb()
      .prepare(`SELECT t.id, t.title, t.handle, ${CHANNEL_SQL} AS ch FROM inbox_threads t WHERE t.owner_id = ? AND t.id IN (${ids.map(() => '?').join(',')})`)
      .all(owner, ...ids)) as Array<{ id: string; title: string; handle: string; ch: InboxAnalyticsChannel }>;
    for (const t of found) titles.set(t.id, { title: t.title || t.handle, channel: t.ch });
  }
  const topThreads: InboxThreadStat[] = topRows
    .filter((r) => titles.has(String(r.a)))
    .map((r) => ({ id: String(r.a), ...(titles.get(String(r.a)) as { title: string; channel: InboxAnalyticsChannel }), received: num(r.n1), sent: num(r.n2) }));

  return {
    range: rangeInfo(range),
    kpis: {
      received: { value: sumOf(perDay, (p) => p.received), prev: sumOf(prevPerDay, (p) => p.received) },
      sent: { value: sumOf(perDay, (p) => p.sent), prev: sumOf(prevPerDay, (p) => p.sent) },
      threads: { value: threadsKpi(1), prev: threadsKpi(0) },
      firstResponseMin: { value: weightedQuantile(curPairs, 0.5), prev: weightedQuantile(pairs(0), 0.5) },
      toReply: { value: threads.toReply },
      waiting: { value: threads.waiting },
      done: { value: sumOf(perDay, (p) => p.done), prev: sumOf(prevPerDay, (p) => p.done) },
      archived: threads.archived,
    },
    perDay,
    prevPerDay,
    responsePerDay,
    buckets: responseBuckets(curPairs),
    byChannel,
    heatmap,
    topThreads,
  };
}

/** ¿No hay nada que mostrar en el período? (Lo que espera ahora no cuenta: es de siempre.) */
export function isInboxAnalyticsEmpty(d: InboxAnalytics): boolean {
  return !d.kpis.received.value && !d.kpis.sent.value && !d.kpis.done.value && !d.kpis.archived.value;
}

const cache = shortCache<InboxAnalytics>();

/** Igual que inboxAnalytics, con la caché corta del kit (por persona y rango). */
export function cachedInboxAnalytics(owner: string, query: RangeInput = {}): Promise<InboxAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([owner, r.since, r.until, r.tz]), () => inboxAnalytics(owner, query, { now }));
}

/** Para los tests. */
export function clearInboxAnalyticsCache(): void {
  cache.clear();
}

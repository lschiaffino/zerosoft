/**
 * Send, analítica con el kit (el formato de Lines): visitas, personas,
 * tiempo de lectura, cuánto del documento leyeron y descargas de los
 * documentos que la persona ve, en un período contra el anterior (días y
 * horas en la zona de quien mira). Las visitas las anota el visor público
 * (lib/send/viewer); acá solo se agregan.
 */
import { getDb } from '../db';
import type { SendActor } from './types';
import {
  analyticsRange,
  dayIndexSql,
  daySeries,
  hourSql,
  idxDay,
  num,
  rangeInfo,
  rangeSegments,
  sumOf,
  weekdaySql,
  type AnalyticsRange,
  type Kpi,
  type RangeInfo,
  type RangeInput,
} from '../analytics-kit/period';
import { shortCache } from '../analytics-kit/cache';

export interface SendDay {
  day: string;
  visits: number;
  minutes: number;
}

export interface SendDocStat {
  id: string;
  title: string;
  visits: number;
  viewers: number;
  seconds: number;
  /** Promedio de la parte leída (0..1) de las visitas con páginas; null si ninguna tenía. */
  completion: number | null;
  downloads: number;
  prevVisits: number;
}

export interface SendAnalytics {
  range: RangeInfo;
  kpis: { visits: Kpi; viewers: Kpi; avgSeconds: Kpi; completion: Kpi; downloads: Kpi };
  perDay: SendDay[];
  docs: SendDocStat[];
  countries: Array<{ name: string; count: number }>;
  devices: Array<{ name: string; count: number }>;
  /** Visitas por día de la semana (0 = lunes) y hora local. */
  heat: number[][];
  docCount: number;
  docList: Array<{ id: string; title: string }>;
}

/** Una fila agregada por documento, día y período (cur = 1 el elegido). */
export interface SendFact {
  document_id: string;
  cur: number;
  day: number;
  visits: number;
  seconds: number;
  downloads: number;
  done_sum: number;
  done_n: number;
}

type Arg = string | number;

/** Agrega las filas leídas (puro: lo prueban los tests). */
export function aggregateSend(
  range: AnalyticsRange,
  docs: Array<{ id: string; title: string }>,
  facts: SendFact[],
  viewers: Array<{ document_id: string | null; cur: number; n: number }>,
  breakdowns: { countries: Array<{ name: string | null; n: number }>; devices: Array<{ name: string | null; n: number }> },
  heatRows: Array<{ wd: number; hr: number; n: number }>,
): Omit<SendAnalytics, 'docCount' | 'docList'> {
  const byDay = new Map<string, { visits: number; minutes: number }>();
  const stats = new Map<string, SendDocStat & { doneSum: number; doneN: number }>(
    docs.map((d) => [d.id, { id: d.id, title: d.title, visits: 0, viewers: 0, seconds: 0, completion: null, downloads: 0, prevVisits: 0, doneSum: 0, doneN: 0 }]),
  );
  const tot = { cur: { visits: 0, seconds: 0, downloads: 0, doneSum: 0, doneN: 0 }, prev: { visits: 0, seconds: 0, downloads: 0, doneSum: 0, doneN: 0 } };
  for (const r of facts) {
    const day = idxDay(r.day);
    const v = byDay.get(day) ?? { visits: 0, minutes: 0 };
    v.visits += num(r.visits);
    v.minutes += num(r.seconds) / 60;
    byDay.set(day, v);
    const t = num(r.cur) === 1 ? tot.cur : tot.prev;
    t.visits += num(r.visits);
    t.seconds += num(r.seconds);
    t.downloads += num(r.downloads);
    t.doneSum += num(r.done_sum);
    t.doneN += num(r.done_n);
    const s = stats.get(r.document_id);
    if (!s) continue;
    if (num(r.cur) !== 1) {
      s.prevVisits += num(r.visits);
      continue;
    }
    s.visits += num(r.visits);
    s.seconds += num(r.seconds);
    s.downloads += num(r.downloads);
    s.doneSum += num(r.done_sum);
    s.doneN += num(r.done_n);
  }
  const people = { cur: 0, prev: 0 };
  for (const v of viewers) {
    if (v.document_id == null) {
      if (num(v.cur) === 1) people.cur = num(v.n);
      else people.prev = num(v.n);
    } else if (num(v.cur) === 1) {
      const s = stats.get(v.document_id);
      if (s) s.viewers = num(v.n);
    }
  }
  const { cur: perDay } = daySeries(range, byDay, () => ({ visits: 0, minutes: 0 }));
  for (const p of perDay) p.minutes = Math.round(p.minutes * 10) / 10;
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const h of heatRows) {
    const wd = num(h.wd);
    const hr = num(h.hr);
    if (wd >= 0 && wd < 7 && hr >= 0 && hr < 24) heat[wd][hr] += num(h.n);
  }
  const list = (rows: Array<{ name: string | null; n: number }>) => rows.filter((r) => r.name).map((r) => ({ name: String(r.name), count: num(r.n) }));
  const avg = (sum: number, n: number) => (n > 0 ? sum / n : null);
  return {
    range: rangeInfo(range),
    kpis: {
      visits: { value: tot.cur.visits, prev: tot.prev.visits },
      viewers: { value: people.cur, prev: people.prev },
      avgSeconds: { value: avg(tot.cur.seconds, tot.cur.visits), prev: avg(tot.prev.seconds, tot.prev.visits) },
      completion: { value: avg(tot.cur.doneSum, tot.cur.doneN), prev: avg(tot.prev.doneSum, tot.prev.doneN) },
      downloads: { value: tot.cur.downloads, prev: tot.prev.downloads },
    },
    perDay,
    docs: [...stats.values()]
      .filter((d) => d.visits + d.prevVisits > 0)
      .map(({ doneSum, doneN, ...d }) => ({ ...d, completion: avg(doneSum, doneN) }))
      .sort((a, b) => b.visits - a.visits || b.seconds - a.seconds || a.title.localeCompare(b.title)),
    countries: list(breakdowns.countries),
    devices: list(breakdowns.devices),
    heat,
  };
}

const SEC = `CAST(strftime('%s', s.started_at) AS INTEGER)`;

/** La analítica de Send de los documentos que ve la persona (o de uno, si lo ve). */
export async function sendAnalytics(actor: SendActor, docId: string | undefined, query: RangeInput = {}, now = new Date()): Promise<SendAnalytics> {
  const range = analyticsRange(query, now);
  const db = getDb();
  let docs = (await db
    .prepare(`SELECT d.id, d.title FROM send_documents d WHERE d.workspace_id = ? AND d.deleted_at IS NULL AND (? = 1 OR d.owner_id = ? OR d.sharing = 'workspace') ORDER BY d.title`)
    .all(actor.ws, actor.admin ? 1 : 0, actor.person)) as Array<{ id: string; title: string }>;
  const docCount = docs.length;
  const docList = docs.map((d) => ({ id: d.id, title: d.title }));
  if (docId) docs = docs.filter((d) => d.id === docId);
  if (!docs.length) return { ...aggregateSend(range, [], [], [], { countries: [], devices: [] }, []), docCount, docList };
  const ids = docs.map((d) => d.id);
  const marks = ids.map(() => '?').join(',');
  const segs = rangeSegments(range);
  const day = dayIndexSql(segs, SEC);
  const scope = `s.workspace_id = ? AND s.document_id IN (${marks})`;
  const cur = `CASE WHEN s.started_at >= ? THEN 1 ELSE 0 END`;
  const both: Arg[] = [actor.ws, ...ids, range.prevSince, range.until];
  const only: Arg[] = [actor.ws, ...ids, range.since, range.until];
  const person = `COALESCE(s.visitor_id, s.email, s.session_id)`;
  const [facts, viewersAll, viewersDoc, countries, devices, heatRows] = await Promise.all([
    db
      .prepare(
        `SELECT s.document_id, ${cur} AS cur, ${day} AS day, COUNT(*) AS visits, SUM(s.seconds) AS seconds, SUM(s.downloads) AS downloads,
                SUM(CASE WHEN s.page_total > 0 THEN MIN(1.0, CAST(s.pages_seen AS REAL) / s.page_total) ELSE 0 END) AS done_sum,
                SUM(CASE WHEN s.page_total > 0 THEN 1 ELSE 0 END) AS done_n
         FROM send_visits s WHERE ${scope} AND s.started_at >= ? AND s.started_at < ? GROUP BY s.document_id, cur, day`,
      )
      .all(range.since, ...both) as Promise<SendFact[]>,
    db
      .prepare(`SELECT NULL AS document_id, ${cur} AS cur, COUNT(DISTINCT ${person}) AS n FROM send_visits s WHERE ${scope} AND s.started_at >= ? AND s.started_at < ? GROUP BY cur`)
      .all(range.since, ...both) as Promise<Array<{ document_id: string | null; cur: number; n: number }>>,
    db
      .prepare(`SELECT s.document_id, 1 AS cur, COUNT(DISTINCT ${person}) AS n FROM send_visits s WHERE ${scope} AND s.started_at >= ? AND s.started_at < ? GROUP BY s.document_id`)
      .all(...only) as Promise<Array<{ document_id: string | null; cur: number; n: number }>>,
    db
      .prepare(`SELECT s.country AS name, COUNT(*) AS n FROM send_visits s WHERE ${scope} AND s.started_at >= ? AND s.started_at < ? GROUP BY name ORDER BY n DESC, name LIMIT 8`)
      .all(...only) as Promise<Array<{ name: string | null; n: number }>>,
    db
      .prepare(`SELECT NULLIF(s.device, '') AS name, COUNT(*) AS n FROM send_visits s WHERE ${scope} AND s.started_at >= ? AND s.started_at < ? GROUP BY name ORDER BY n DESC, name LIMIT 8`)
      .all(...only) as Promise<Array<{ name: string | null; n: number }>>,
    db
      .prepare(`SELECT ${weekdaySql(day)} AS wd, ${hourSql(segs, SEC)} AS hr, COUNT(*) AS n FROM send_visits s WHERE ${scope} AND s.started_at >= ? AND s.started_at < ? GROUP BY wd, hr`)
      .all(...only) as Promise<Array<{ wd: number; hr: number; n: number }>>,
  ]);
  return { ...aggregateSend(range, docs, facts, [...viewersAll, ...viewersDoc], { countries, devices }, heatRows), docCount, docList };
}

export function isSendAnalyticsEmpty(d: SendAnalytics): boolean {
  return d.docCount === 0 || !(d.kpis.visits.value || d.kpis.visits.prev);
}

const cache = shortCache<SendAnalytics>();

/** Con la caché corta del kit. La clave lleva quién mira (ve otros documentos), el documento y el rango. */
export function cachedSendAnalytics(actor: SendActor, docId: string | undefined, query: RangeInput = {}): Promise<SendAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([actor.ws, actor.person, actor.admin, docId ?? '', r.since, r.until, r.tz]), () => sendAnalytics(actor, docId, query, now));
}

export function clearSendAnalyticsCache(): void {
  cache.clear();
}

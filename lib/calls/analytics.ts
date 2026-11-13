/**
 * Calls, analítica: llamadas grabadas, minutos, cuánto habla el equipo,
 * preguntas, temas y competidores, y lo mismo por rep, en un período contra
 * el anterior.
 *
 * Quién ve qué: las mismas reglas que la biblioteca (lib/calls/core.ts). Con
 * la visibilidad del workspace en "privado", una persona que no es admin solo
 * cuenta sus llamadas; los admins y el modo "equipo" ven todas. Solo se leen
 * columnas chicas (métricas y el análisis por json_extract), nunca la
 * transcripción, por rango con índice (idx_calls_ws).
 */
import { getDb } from '../db';
import {
  analyticsRange,
  dayIndexSql,
  daySeries,
  idxDay,
  num,
  rangeInfo,
  rangeSegments,
  sumOf,
  type AnalyticsRange,
  type Kpi,
  type RangeInfo,
  type RangeInput,
} from '../analytics-kit/period';
import { shortCache } from '../analytics-kit/cache';
import { getSettings } from './settings';
import type { CallsActor, CallStatus } from './types';

/** Lo que cuenta como grabado: estuvo (o está) grabando. Lo agendado, salteado o fallido no. */
export const RECORDED_STATUSES: readonly CallStatus[] = ['recording', 'uploading', 'processing', 'ready'];
/** Tope de llamadas leídas por consulta (los dos períodos). */
const ROW_CAP = 20_000;

export interface CallsDay {
  day: string;
  calls: number;
  minutes: number;
}

export interface CallsRepStat {
  id: string;
  name: string | null;
  calls: number;
  minutes: number;
  /** Promedio de la parte del tiempo que habla el equipo (0..1). null sin llamadas con hablantes. */
  talkRatio: number | null;
  /** Preguntas del cliente. */
  questions: number;
  /** Puntaje promedio de la metodología (0..100). null sin análisis. */
  score: number | null;
  prevCalls: number;
}

export interface NameCount {
  name: string;
  calls: number;
}

export interface CallsAnalytics {
  range: RangeInfo;
  kpis: {
    calls: Kpi;
    minutes: Kpi;
    avgMinutes: Kpi;
    talkRatio: Kpi;
    questions: Kpi;
    teamQuestions: Kpi;
    score: Kpi;
    reps: Kpi;
  };
  perDay: CallsDay[];
  prevPerDay: CallsDay[];
  topics: NameCount[];
  competitors: NameCount[];
  reps: CallsRepStat[];
  /** Llamadas por tramo de cuánto habla el equipo: menos de 40 %, 40 a 60 %, más de 60 %. */
  talkBands: [number, number, number];
}

type Arg = string | number;

interface CallFact {
  owner_id: string;
  owner_name: string | null;
  cur: number;
  day: number;
  ms: number;
  talk: number | null;
  q_ext: number | null;
  q_int: number | null;
  score: number | null;
  analyzed: number;
}

/** Condiciones de alcance (alias c): workspace, visibilidad y lo grabado. */
async function scope(actor: CallsActor): Promise<{ sql: string; args: Arg[] }> {
  const settings = await getSettings(actor.ws);
  return {
    sql: `c.workspace_id = ? AND c.deleted_at IS NULL AND c.status IN (${RECORDED_STATUSES.map(() => '?').join(',')}) AND (? = 1 OR c.owner_id = ? OR ? = 'team')`,
    args: [actor.ws, ...RECORDED_STATUSES, actor.admin ? 1 : 0, actor.person, settings.visibility],
  };
}

/** El SQL de las llamadas de los dos períodos (exportado para revisar el plan en los tests). */
export function callsFactsSql(range: AnalyticsRange, sc: { sql: string; args: Arg[] }): { sql: string; args: Arg[] } {
  const day = dayIndexSql(rangeSegments(range), "CAST(strftime('%s', c.started_at) AS INTEGER)");
  return {
    sql: `SELECT c.owner_id, u.name AS owner_name, CASE WHEN c.started_at >= ? THEN 1 ELSE 0 END AS cur, ${day} AS day, c.duration_ms AS ms,
            CASE WHEN json_valid(c.metrics) THEN json_extract(c.metrics, '$.talkRatio') END AS talk,
            CASE WHEN json_valid(c.metrics) THEN json_extract(c.metrics, '$.questionsExternal') END AS q_ext,
            CASE WHEN json_valid(c.metrics) THEN json_extract(c.metrics, '$.questionsInternal') END AS q_int,
            CASE WHEN json_valid(c.analysis) THEN json_extract(c.analysis, '$.scorecard.total') END AS score,
            CASE WHEN json_valid(c.analysis) THEN json_array_length(c.analysis, '$.scorecard.items') ELSE 0 END AS analyzed
          FROM calls c LEFT JOIN users u ON u.id = c.owner_id
          WHERE c.started_at >= ? AND c.started_at < ? AND ${sc.sql}
          LIMIT ${ROW_CAP}`,
    args: [range.since, range.prevSince, range.until, ...sc.args],
  };
}

/** Temas o competidores del período (cada llamada cuenta una vez por nombre), sin distinguir mayúsculas. */
async function namesOf(range: AnalyticsRange, sc: { sql: string; args: Arg[] }, path: '$.topics' | '$.competitors', limit = 10): Promise<NameCount[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT MIN(n) AS name, COUNT(DISTINCT id) AS calls FROM (
         SELECT c.id, trim(json_extract(j.value, '$.name')) AS n FROM calls c, json_each(c.analysis, '${path}') j
         WHERE c.started_at >= ? AND c.started_at < ? AND ${sc.sql} AND json_valid(c.analysis)
       ) WHERE n IS NOT NULL AND n != '' GROUP BY lower(n) ORDER BY calls DESC, name LIMIT ${Math.trunc(limit)}`,
    )
    .all(range.since, range.until, ...sc.args)) as Array<{ name: string; calls: number }>;
  return rows.map((r) => ({ name: String(r.name), calls: num(r.calls) }));
}

const avg = (list: number[]): number | null => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Agrega las llamadas leídas (puro: lo prueban los tests). */
export function aggregateCalls(range: AnalyticsRange, rows: CallFact[]): Omit<CallsAnalytics, 'topics' | 'competitors'> {
  const byDay = new Map<string, { calls: number; minutes: number }>();
  const reps = new Map<string, CallsRepStat & { talks: number[]; scores: number[] }>();
  const per = (cur: number) => rows.filter((r) => num(r.cur) === cur);
  for (const r of rows) {
    const day = idxDay(r.day);
    const v = byDay.get(day) ?? { calls: 0, minutes: 0 };
    v.calls += 1;
    v.minutes += num(r.ms) / 60_000;
    byDay.set(day, v);
    let rep = reps.get(r.owner_id);
    if (!rep) {
      rep = { id: r.owner_id, name: r.owner_name, calls: 0, minutes: 0, talkRatio: null, questions: 0, score: null, prevCalls: 0, talks: [], scores: [] };
      reps.set(r.owner_id, rep);
    }
    if (num(r.cur) !== 1) {
      rep.prevCalls += 1;
      continue;
    }
    rep.calls += 1;
    rep.minutes += num(r.ms) / 60_000;
    rep.questions += num(r.q_ext);
    if (finite(r.talk)) rep.talks.push(r.talk);
    if (finite(r.score) && num(r.analyzed) > 0) rep.scores.push(r.score);
  }
  const { cur: perDay, prev: prevPerDay } = daySeries(range, byDay, () => ({ calls: 0, minutes: 0 }));
  const round = (v: number) => Math.round(v * 10) / 10;
  for (const p of [...perDay, ...prevPerDay]) p.minutes = round(p.minutes);

  const kpis = (list: CallFact[]) => {
    const talks = list.map((r) => r.talk).filter(finite);
    const scores = list.filter((r) => num(r.analyzed) > 0).map((r) => r.score).filter(finite);
    const minutes = sumOf(list, (r) => num(r.ms) / 60_000);
    return {
      calls: list.length,
      minutes: Math.round(minutes),
      avgMinutes: list.length ? round(minutes / list.length) : null,
      talkRatio: avg(talks),
      questions: sumOf(list, (r) => num(r.q_ext)),
      teamQuestions: sumOf(list, (r) => num(r.q_int)),
      score: scores.length ? Math.round(avg(scores) as number) : null,
      reps: new Set(list.map((r) => r.owner_id)).size,
    };
  };
  const c = kpis(per(1));
  const p = kpis(per(0));
  const bands: [number, number, number] = [0, 0, 0];
  for (const r of per(1)) {
    if (!finite(r.talk)) continue;
    bands[r.talk < 0.4 ? 0 : r.talk <= 0.6 ? 1 : 2] += 1;
  }
  return {
    range: rangeInfo(range),
    kpis: {
      calls: { value: c.calls, prev: p.calls },
      minutes: { value: c.minutes, prev: p.minutes },
      avgMinutes: { value: c.avgMinutes, prev: p.avgMinutes },
      talkRatio: { value: c.talkRatio, prev: p.talkRatio },
      questions: { value: c.questions, prev: p.questions },
      teamQuestions: { value: c.teamQuestions, prev: p.teamQuestions },
      score: { value: c.score, prev: p.score },
      reps: { value: c.reps, prev: p.reps },
    },
    perDay,
    prevPerDay,
    reps: [...reps.values()]
      .filter((r) => r.calls > 0)
      .map(({ talks, scores, ...r }) => ({ ...r, minutes: Math.round(r.minutes), talkRatio: avg(talks), score: scores.length ? Math.round(avg(scores) as number) : null }))
      .sort((a, b) => b.calls - a.calls || b.minutes - a.minutes || (a.name ?? '').localeCompare(b.name ?? '')),
    talkBands: bands,
  };
}

/** La analítica de Calls que ve esta persona. */
export async function callsAnalytics(actor: CallsActor, query: RangeInput = {}, opts: { now?: Date } = {}): Promise<CallsAnalytics> {
  const range = analyticsRange(query, opts.now ?? new Date());
  const sc = await scope(actor);
  const { sql, args } = callsFactsSql(range, sc);
  const [rows, topics, competitors] = await Promise.all([
    getDb().prepare(sql).all(...args) as Promise<CallFact[]>,
    namesOf(range, sc, '$.topics'),
    namesOf(range, sc, '$.competitors'),
  ]);
  return { ...aggregateCalls(range, rows), topics, competitors };
}

export function isCallsAnalyticsEmpty(d: CallsAnalytics): boolean {
  return !d.kpis.calls.value;
}

const cache = shortCache<CallsAnalytics>();

/** Con la caché corta del kit. La clave lleva quién mira y qué puede ver. */
export async function cachedCallsAnalytics(actor: CallsActor, query: RangeInput = {}): Promise<CallsAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  // La visibilidad va en la clave: si un admin pasa el workspace a privado, nadie sigue viendo lo de otros desde la caché.
  const { visibility } = await getSettings(actor.ws);
  return cache.get(JSON.stringify([actor.ws, actor.person, actor.admin, visibility, r.since, r.until, r.tz]), () => callsAnalytics(actor, query, { now }));
}

export function clearCallsAnalyticsCache(): void {
  cache.clear();
}

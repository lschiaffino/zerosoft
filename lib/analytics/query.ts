/**
 * Consultas de Analytics sobre libsql: tendencias, embudos, retención,
 * caminos, web, eventos en vivo y SQL. Todas filtran por project_id primero
 * (los índices empiezan por ahí) y agregan en SQL o, si el cálculo es por
 * persona (embudos, retención, caminos), traen filas acotadas y cuentan en
 * lib/analytics/compute.ts. Server-only.
 */
import { ensureMigrated, getClient, getDb } from '../db';
import {
  alignSeries,
  breakdownSeries,
  bucketList,
  bucketOf,
  bucketBefore,
  bucketSql,
  computeFunnel,
  computePaths,
  computeRetention,
  periodSql,
  periodStartLocal,
  retentionCellPeople,
  periodLabel,
  periodOf,
  previousAligned,
  resolveRange,
  type FunnelRow,
} from './compute';
import { actionSql, cohortSql, filtersSql, groupKeySql, needsPerson, numericProp, personJoins, PERSON_KEY, propText, type Arg, type Frag } from './sql-build';
import { applyFormula, collapsePath, computeLifecycle, correlate, formulaValue, parseFormula, percentile, PERCENTILE_OF, round2, stickinessHistogram } from './compute-more';
import { parseTestFilters } from './projects';
import { fromLocal, offsetMsAt, projectTz, tzShiftSql } from './tz';
import { checkSql, SQL_MAX_ROWS, wrapSql } from './sql-safe';
import { runReadOnly, SqlRunError } from './sql-run';
import { getCohort, loadActions, type ActionMap } from './records';
import { channelSql, referrerSql, webFiltersSql } from './web-core';
import { groupPropText } from './sql-build';
import type { ProjectRow } from './projects';
import { ACTION_PREFIX, funnelWindowMs, PROPERTY_MATHS } from './types';
import { pathWindow } from './funnel-core';
import { activeInWindow, isWeekend, rolling } from './trend-core';
import type {
  CorrelationQuery,
  CorrelationResult,
  FunnelQuery,
  FunnelResult,
  InsightQuery,
  InsightResult,
  LifecycleQuery,
  LifecycleResult,
  LiveEvent,
  PathsQuery,
  PathsResult,
  PropertyFilter,
  RetentionQuery,
  RetentionResult,
  SqlResult,
  StickinessQuery,
  StickinessResult,
  TrendsQuery,
  TrendsResult,
  WebQuery,
  WebResult,
} from './types';

/** Filas que un embudo, una retención o un camino trae como mucho. */
export const ROW_CAP = 200_000;
const DAY = 86_400_000;

type Row = Record<string, unknown>;

async function all(sql: string, args: Arg[]): Promise<Row[]> {
  return (await getDb().prepare(sql).all(...args)) as Row[];
}

export class QueryError extends Error {
  constructor(
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}

/** Desfase en ms en un instante; `shiftFor` corrige lo que cae después de un cambio de hora dentro del rango. */
const offAt = (p: ProjectRow, at: number) => offsetMsAt(projectTz(p), at);
const shiftFor = (p: ProjectRow, range: { from: number; to: number }, col = 'e.ts') => tzShiftSql(projectTz(p), range.from, range.to, col);

async function cohortFrag(project: ProjectRow, cohortId: string | null | undefined, now: number): Promise<Frag | null> {
  if (!cohortId) return null;
  const c = await getCohort(project.id, cohortId);
  if (!c) throw new QueryError('cohort_not_found');
  const sub = cohortSql(project.id, c.definition, now, c.id);
  return { sql: `${PERSON_KEY} IN (${sub.sql})`, args: sub.args };
}

/** WHERE común: proyecto, rango, evento (salvo '*'), filtros y cohorte. */
function whereFor(
  project: ProjectRow,
  range: { from: number; to: number },
  event: string | null,
  filters: PropertyFilter[],
  cohort: Frag | null,
  actions?: ActionMap,
): Frag {
  const parts = ['e.project_id = ?', 'e.ts >= ?', 'e.ts <= ?'];
  const args: Arg[] = [project.id, range.from, range.to];
  if (event && event !== '*') {
    const m = eventMatch(event, actions);
    parts.push(m.sql);
    args.push(...m.args);
  }
  const f = filtersSql(filters);
  if (f.sql) {
    parts.push(f.sql);
    args.push(...f.args);
  }
  if (cohort) {
    parts.push(cohort.sql);
    args.push(...cohort.args);
  }
  return { sql: parts.join(' AND '), args };
}

/** Condición de un evento o de una acción guardada. Una acción borrada no matchea nada. */
function eventMatch(event: string, actions?: ActionMap): Frag {
  if (event === '*') return { sql: '1', args: [] };
  if (event.startsWith(ACTION_PREFIX)) {
    const a = actions?.get(event.slice(ACTION_PREFIX.length));
    return a ? actionSql(a.steps) : { sql: '0', args: [] };
  }
  return { sql: 'e.event = ?', args: [event] };
}

/** Filtros de gente interna del proyecto, si la consulta los pide. */
function internalFilters(project: ProjectRow, on: boolean | undefined): PropertyFilter[] {
  return on ? parseTestFilters(project.test_filters) : [];
}

// ---------- Tendencias ----------

const MATH_SUFFIX: Record<string, string> = {
  unique: 'unique users',
  wau: 'weekly active',
  mau: 'monthly active',
  per_user_min: 'min per user',
  per_user_max: 'max per user',
  per_user_median: 'median per user',
  per_user_p75: 'p75 per user',
  per_user_p90: 'p90 per user',
  per_user_p95: 'p95 per user',
  per_user_p99: 'p99 per user',
  p75: 'p75',
  sessions: 'sessions',
  per_user: 'per user',
  unique_group: 'unique groups',
  sum: 'sum',
  avg: 'average',
  min: 'minimum',
  max: 'maximum',
  median: 'median',
  p90: 'p90',
  p95: 'p95',
  p99: 'p99',
};

function seriesLabel(event: string, s: { math: string; mathProperty?: string; label?: string; orEvents?: string[] }, actions?: ActionMap): string {
  if (s.label) return s.label;
  const one = (ev: string) => (ev === '*' ? 'All events' : ev.startsWith(ACTION_PREFIX) ? (actions?.get(ev.slice(ACTION_PREFIX.length))?.name ?? 'Deleted action') : ev);
  const name = [event, ...(s.orEvents ?? [])].map(one).join(' / ');
  const suffix = MATH_SUFFIX[s.math];
  if (!suffix) return name;
  return s.mathProperty && PROPERTY_MATHS.includes(s.math as never) ? `${name} (${suffix} of ${s.mathProperty})` : `${name} (${suffix})`;
}

function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/**
 * Una serie sin filtros, apertura ni cohorte y por día (o semana/mes si es
 * total): los días cerrados salen de analytics_daily y el resto de los
 * eventos crudos. Devuelve null si no aplica.
 */
async function trendFromRollup(
  project: ProjectRow,
  event: string,
  math: 'total' | 'unique',
  interval: TrendsQuery['interval'],
  range: { from: number; to: number },
  buckets: string[],
): Promise<number[] | null> {
  if (!project.rolled_through || event === '*') return null;
  if (interval === 'hour' || (math === 'unique' && interval !== 'day')) return null;
  // El rango tiene que arrancar a medianoche local para que los días cierren.
  if ((range.from + offAt(project, range.from)) % DAY !== 0) return null;
  const fromDay = bucketOf(range.from, 'day', projectTz(project));
  const rolled = project.dirty_from && project.dirty_from <= project.rolled_through ? dayBefore(project.dirty_from) : project.rolled_through;
  if (rolled < fromDay) return null;
  const toDay = bucketOf(range.to, 'day', projectTz(project));
  const lastRolled = rolled < toDay ? rolled : toDay;
  const daily = (await all(`SELECT day, ${math === 'unique' ? 'uniques' : 'count'} AS n FROM analytics_daily WHERE project_id = ? AND event = ? AND day >= ? AND day <= ?`, [
    project.id,
    event,
    fromDay,
    lastRolled,
  ])) as Array<{ day: string; n: number }>;
  const rows: Array<{ bucket: string; count: number }> = daily.map((d) => ({
    // La fila ya es un día local: la semana o el mes salen de esa fecha, sin zona.
    bucket: interval === 'day' ? d.day : bucketOf(Date.parse(`${d.day}T00:00:00Z`), interval, 0),
    count: Number(d.n),
  }));
  if (lastRolled < toDay) {
    const rawFrom = fromLocal(Date.parse(`${dayAfter(lastRolled)}T00:00:00Z`), projectTz(project));
    const rawRange = { from: rawFrom, to: range.to };
    const agg = math === 'unique' ? `COUNT(DISTINCT ${PERSON_KEY})` : 'COUNT(*)';
    const raw = (await all(
      `SELECT ${bucketSql(interval, 'e.ts', shiftFor(project, rawRange))} AS bucket, ${agg} AS count FROM analytics_events e ${math === 'unique' ? personJoins(false) : ''}
       WHERE e.project_id = ? AND e.event = ? AND e.ts >= ? AND e.ts <= ? GROUP BY 1`,
      [offAt(project, rawFrom), project.id, event, rawFrom, range.to],
    )) as Array<{ bucket: string; count: number }>;
    rows.push(...raw);
  }
  return alignSeries(rows, buckets);
}

function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
}

/** Agregación SQL de los conteos ('per_user' y las de propiedad se resuelven aparte). */
function aggSql(s: TrendsQuery['series'][number]): Frag {
  switch (s.math) {
    case 'unique':
      return { sql: `COUNT(DISTINCT ${PERSON_KEY})`, args: [] };
    case 'sessions':
      return { sql: 'COUNT(DISTINCT e.session_id)', args: [] };
    case 'per_user':
      return { sql: `CAST(COUNT(*) AS REAL) / MAX(COUNT(DISTINCT ${PERSON_KEY}), 1)`, args: [] };
    case 'unique_group':
      if (!s.groupType) throw new QueryError('group_type_required');
      return { sql: `COUNT(DISTINCT ${groupKeySql()})`, args: [`$."$groups"."${s.groupType}"`] };
    case 'sum':
    case 'avg':
    case 'min':
    case 'max': {
      if (!s.mathProperty) throw new QueryError('math_property_required');
      const v = numericProp(s.mathProperty);
      return { sql: `${s.math.toUpperCase()}(${v.sql})`, args: v.args };
    }
    default:
      return { sql: 'COUNT(*)', args: [] };
  }
}

/** Percentiles: trae los valores (con tope) y calcula acá, que SQLite no los tiene. */
async function percentileSeries(
  project: ProjectRow,
  s: TrendsQuery['series'][number],
  q: TrendsQuery,
  where: Frag,
  joins: string,
  buckets: string[],
  range: { from: number; to: number },
  bd: Frag | null,
): Promise<Array<{ value: string | null; data: number[]; total: number }>> {
  if (!s.mathProperty) throw new QueryError('math_property_required');
  const p = PERCENTILE_OF[s.math];
  const v = numericProp(s.mathProperty);
  const rows = (await all(
    `SELECT ${bucketSql(q.interval, 'e.ts', shiftFor(project, range))} AS bucket, ${bd ? bd.sql : 'NULL'} AS value, ${v.sql} AS v FROM analytics_events e ${joins}
     WHERE ${where.sql} AND ${v.sql} IS NOT NULL LIMIT ?`,
    [offAt(project, range.from), ...(bd?.args ?? []), ...v.args, ...where.args, ...v.args, ROW_CAP],
  )) as Array<{ bucket: string; value: string | null; v: number }>;
  const groups = new Map<string | null, Map<string, number[]>>();
  for (const r of rows) {
    const k = bd ? (r.value ?? '(none)') : null;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = new Map()));
    let list = g.get(String(r.bucket));
    if (!list) g.set(String(r.bucket), (list = []));
    list.push(Number(r.v));
  }
  const out = [...groups.entries()].map(([value, g]) => ({
    value,
    data: buckets.map((b) => percentile(g.get(b) ?? [], p)),
    total: percentile([...g.values()].flat(), p),
  }));
  return out.sort((a, b) => b.total - a.total).slice(0, q.breakdownLimit ?? 25);
}

/** Solo lo que es un número: una palabra o un texto vacío no van a ningún rango. */
function numericText(text: Frag): Frag {
  const conds = [`${text.sql} NOT GLOB '*[^0-9.+-]*'`, `${text.sql} GLOB '*[0-9]*'`, `${text.sql} NOT GLOB '?*[+-]*'`, `${text.sql} NOT GLOB '*.*.*'`];
  return { sql: `(${conds.join(' AND ')})`, args: conds.flatMap(() => text.args) };
}

/** Rangos ya calculados, para que todas las corridas de un resultado (comparación, suavizado) usen los mismos. */
type BinCache = Map<string, { lo: number; width: number; count: number }>;

/** Expresión del valor de la apertura. Con rangos, los arma la primera corrida: la del período actual. */
async function trendBreakdownFrag(q: TrendsQuery, where: Frag, joins: string, seriesIndex: number, bins: BinCache): Promise<Frag | null> {
  const list = [q.breakdown, ...(q.breakdownsMore ?? [])].filter((b): b is NonNullable<TrendsQuery['breakdown']> => Boolean(b));
  if (!list.length) return null;
  const parts: Frag[] = [];
  for (const [i, b] of list.entries()) {
    if (b.type === 'group' && !b.groupType) throw new QueryError('group_type_required');
    const text = b.type === 'group' ? groupPropText(b.key, b.groupType!) : propText(b.key, b.type as 'event' | 'person');
    if (!b.bins) {
      parts.push(text);
      continue;
    }
    const num = `CAST(${text.sql} AS REAL)`;
    const isNum = numericText(text);
    const key = `${seriesIndex}:${i}`;
    let range = bins.get(key);
    if (!range) {
      const seen = (await getDb()
        .prepare(`SELECT MIN(${num}) AS lo, MAX(${num}) AS hi FROM analytics_events e ${joins} WHERE ${where.sql} AND ${isNum.sql}`)
        .get(...text.args, ...text.args, ...where.args, ...isNum.args)) as { lo: number | null; hi: number | null } | undefined;
      const lo = Number(seen?.lo ?? 0);
      const hi = Number(seen?.hi ?? 0);
      range = { lo, width: (hi - lo) / b.bins || 1, count: b.bins };
      bins.set(key, range);
    }
    // Lo que en otro período queda fuera de estos rangos va al más cercano.
    const index = `MAX(0, MIN(${range.count - 1}, CAST((${num} - ?) / ? AS INTEGER)))`;
    parts.push({
      sql: `(CASE WHEN ${isNum.sql} THEN printf('%g to %g', ? + ${index} * ?, ? + (${index} + 1) * ?) ELSE NULL END)`,
      args: [...isNum.args, range.lo, ...text.args, range.lo, range.width, range.width, range.lo, ...text.args, range.lo, range.width, range.width],
    });
  }
  if (parts.length === 1) return parts[0];
  return { sql: parts.map((f) => `COALESCE(${f.sql}, '(none)')`).join(" || ' / ' || "), args: parts.flatMap((f) => f.args) };
}

/** Con una apertura en rangos, las filas van de menor a mayor y "sin valor" al final. */
function sortBinned<T extends { label: string; breakdownValue: string | null }>(q: TrendsQuery, list: T[]): T[] {
  if (!q.breakdown?.bins || q.breakdownsMore?.length) return list;
  const start = (v: string | null) => {
    const n = Number.parseFloat(v ?? '');
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  return list.map((x, i) => ({ x, i })).sort((a, b) => (a.x.label === b.x.label ? start(a.x.breakdownValue) - start(b.x.breakdownValue) : a.i - b.i)).map((y) => y.x);
}

const PER_USER_OF: Record<string, number> = { per_user_median: 0.5, per_user_p75: 0.75, per_user_p90: 0.9, per_user_p95: 0.95, per_user_p99: 0.99 };

/** Conteos por persona en cada cubeta y su mínimo, máximo, mediana o percentil. */
async function perUserSeries(
  project: ProjectRow,
  s: TrendsQuery['series'][number],
  q: TrendsQuery,
  where: Frag,
  joins: string,
  buckets: string[],
  range: { from: number; to: number },
  bd: Frag | null,
): Promise<Array<{ value: string | null; data: number[]; total: number }>> {
  const p = s.math === 'per_user_min' ? 0 : s.math === 'per_user_max' ? 1 : PER_USER_OF[s.math];
  const rows = (await all(
    `SELECT ${bucketSql(q.interval, 'e.ts', shiftFor(project, range))} AS bucket, ${bd ? bd.sql : 'NULL'} AS value, ${PERSON_KEY} AS person, COUNT(*) AS n FROM analytics_events e ${joins}
     WHERE ${where.sql} GROUP BY 1, 2, 3 LIMIT ?`,
    [offAt(project, range.from), ...(bd?.args ?? []), ...where.args, ROW_CAP],
  )) as Array<{ bucket: string; value: string | null; person: string; n: number }>;
  const groups = new Map<string | null, { perBucket: Map<string, number[]>; perPerson: Map<string, number> }>();
  for (const r of rows) {
    const k = bd ? (r.value ?? '(none)') : null;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { perBucket: new Map(), perPerson: new Map() }));
    let list = g.perBucket.get(String(r.bucket));
    if (!list) g.perBucket.set(String(r.bucket), (list = []));
    list.push(Number(r.n));
    g.perPerson.set(String(r.person), (g.perPerson.get(String(r.person)) ?? 0) + Number(r.n));
  }
  const out = [...groups.entries()].map(([value, g]) => ({
    value,
    data: buckets.map((b) => percentile(g.perBucket.get(b) ?? [], p)),
    total: percentile([...g.perPerson.values()], p),
  }));
  return out.sort((a, b) => b.total - a.total).slice(0, q.breakdownLimit ?? 25);
}

/** Activos en los últimos 7 o 30 días: el total es el valor de la última cubeta. */
async function activeSeries(
  project: ProjectRow,
  s: TrendsQuery['series'][number],
  q: TrendsQuery,
  extra: Frag | null,
  filters: PropertyFilter[],
  cohort: Frag | null,
  actions: ActionMap,
  joins: string,
  buckets: string[],
  range: { from: number; to: number },
  bd: Frag | null,
): Promise<Array<{ value: string | null; data: number[]; total: number }>> {
  const days = s.math === 'wau' ? 7 : 30;
  const wide = { from: range.from - days * DAY, to: range.to };
  const base = whereFor(project, wide, extra ? null : s.event, filters, cohort, actions);
  const where = extra ? andFrag(base, extra) : base;
  const rows = (await all(
    `SELECT DISTINCT ${bucketSql('day', 'e.ts', shiftFor(project, wide))} AS day, ${bd ? bd.sql : 'NULL'} AS value, ${PERSON_KEY} AS person FROM analytics_events e ${joins}
     WHERE ${where.sql} LIMIT ?`,
    [offAt(project, wide.from), ...(bd?.args ?? []), ...where.args, ROW_CAP],
  )) as Array<{ day: string; value: string | null; person: string }>;
  const groups = new Map<string | null, Array<{ day: string; person: string }>>();
  for (const r of rows) {
    const k = bd ? (r.value ?? '(none)') : null;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push({ day: String(r.day), person: String(r.person) });
  }
  const lastDay = bucketOf(range.to, 'day', projectTz(project));
  const out = [...groups.entries()].map(([value, g]) => {
    const data = activeInWindow(g, buckets, q.interval, days, lastDay);
    return { value, data, total: data[data.length - 1] ?? 0 };
  });
  return out.sort((a, b) => b.total - a.total).slice(0, q.breakdownLimit ?? 25);
}

function andFrag(a: Frag, b: Frag): Frag {
  return { sql: `${a.sql} AND ${b.sql}`, args: [...a.args, ...b.args] };
}

/** Condición extra de una serie: otros eventos con OR y solo la primera vez de cada persona. */
function seriesExtra(project: ProjectRow, s: TrendsQuery['series'][number], filters: PropertyFilter[], actions: ActionMap): Frag | null {
  const events = [s.event, ...(s.orEvents ?? [])];
  const ms = events.map((e) => eventMatch(e, actions));
  const match: Frag = { sql: ms.length === 1 ? ms[0].sql : `(${ms.map((m) => m.sql).join(' OR ')})`, args: ms.flatMap((m) => m.args) };
  if (!s.first) return events.length > 1 ? match : null;
  // Con "la primera de todas" valen los filtros de afuera: si esa primera vez no los cumple, no cuenta.
  const f = s.first === 'matching' ? filtersSql(filters) : { sql: '', args: [] };
  const needs = s.first === 'matching' && needsPerson(filters);
  const first: Frag = {
    sql: `(${PERSON_KEY}, e.ts) IN (SELECT ${PERSON_KEY}, MIN(e.ts) FROM analytics_events e ${personJoins(needs)} WHERE e.project_id = ? AND e.ts >= 0 AND e.ts <= 8640000000000000 AND ${match.sql}${f.sql ? ` AND ${f.sql}` : ''} GROUP BY 1)`,
    args: [project.id, ...match.args, ...f.args],
  };
  return andFrag(match, first);
}

async function trendOnce(project: ProjectRow, q: TrendsQuery, range: { from: number; to: number }, now: number, bins: BinCache = new Map()): Promise<{ buckets: string[]; series: Array<{ label: string; breakdownValue: string | null; data: number[]; total: number; latest?: boolean }>; usedRollup: boolean }> {
  // Por cohorte: una corrida por cada una, con su nombre como valor.
  if (q.breakdownCohorts?.length) {
    const runs = [];
    for (const id of q.breakdownCohorts) {
      const c = await getCohort(project.id, id);
      if (!c) throw new QueryError('cohort_not_found');
      const r = await trendOnce(project, { ...q, breakdownCohorts: null, breakdown: null, breakdownsMore: [], cohortId: id }, range, now, bins);
      runs.push(...r.series.map((x) => ({ ...x, breakdownValue: c.name })));
    }
    return { buckets: bucketList(range.from, range.to, q.interval, projectTz(project)), series: runs, usedRollup: false };
  }
  const off = offAt(project, range.from);
  const shift = shiftFor(project, range);
  const tz = projectTz(project);
  const buckets = bucketList(range.from, range.to, q.interval, tz);
  const hideWeekends = q.interval === 'day' && Boolean(q.options?.hideWeekends);
  const cohort = await cohortFrag(project, q.cohortId, now);
  const actions = await loadActions(project.id, q.series.flatMap((s) => [s.event, ...(s.orEvents ?? [])]));
  let usedRollup = false;
  const out: Array<{ label: string; breakdownValue: string | null; data: number[]; total: number; latest?: boolean }> = [];
  for (const [seriesIndex, s] of q.series.entries()) {
    const filters = [...internalFilters(project, q.excludeInternal), ...q.filters, ...s.filters];
    const label = seriesLabel(s.event, s, actions);
    const isAction = s.event.startsWith(ACTION_PREFIX);
    if (!filters.length && !q.breakdown && !q.breakdownsMore?.length && !cohort && !isAction && s.math === 'total' && !s.orEvents?.length && !s.first && !hideWeekends) {
      const data = await trendFromRollup(project, s.event, s.math, q.interval, range, buckets);
      if (data) {
        usedRollup = true;
        out.push({ label, breakdownValue: null, data, total: data.reduce((a, b) => a + b, 0) });
        continue;
      }
    }
    const withPerson = needsPerson(filters) || q.breakdown?.type === 'person' || Boolean(q.breakdownsMore?.some((b) => b.type === 'person'));
    const isPerUser = s.math.startsWith('per_user_');
    const isActive = s.math === 'wau' || s.math === 'mau';
    const usesPerson = s.math === 'unique' || s.math === 'per_user' || isPerUser || isActive || Boolean(s.first);
    const joins = usesPerson || withPerson || cohort ? personJoins(withPerson) : '';
    const extra = seriesExtra(project, s, filters, actions);
    const base = extra ? andFrag(whereFor(project, range, null, filters, cohort, actions), extra) : whereFor(project, range, s.event, filters, cohort, actions);
    // Sin fines de semana: se sacan de los eventos, así únicos, promedios y totales no los cuentan.
    const where = hideWeekends ? andFrag(base, { sql: `CAST(strftime('%w', (e.ts + CAST(? AS INTEGER)${shift}) / 1000, 'unixepoch') AS INTEGER) NOT IN (0, 6)`, args: [off] }) : base;
    const bd = await trendBreakdownFrag(q, where, joins, seriesIndex, bins);
    if (isActive) {
      for (const b of await activeSeries(project, s, q, extra, filters, cohort, actions, joins, buckets, range, bd)) out.push({ label, breakdownValue: b.value, data: b.data, total: b.total, latest: true });
      continue;
    }
    if (isPerUser) {
      for (const b of await perUserSeries(project, s, q, where, joins, buckets, range, bd)) out.push({ label, breakdownValue: b.value, data: b.data, total: b.total });
      continue;
    }
    if (PERCENTILE_OF[s.math] !== undefined) {
      for (const b of await percentileSeries(project, s, q, where, joins, buckets, range, bd)) out.push({ label, breakdownValue: b.value, data: b.data, total: b.total });
      continue;
    }
    const agg = aggSql(s);
    if (bd) {
      const value = bd;
      const rows = (await all(
        `SELECT ${bucketSql(q.interval, 'e.ts', shift)} AS bucket, ${value.sql} AS value, ${agg.sql} AS count FROM analytics_events e ${joins}
         WHERE ${where.sql} GROUP BY 1, 2`,
        [off, ...value.args, ...agg.args, ...where.args],
      )) as Array<{ bucket: string; value: string | null; count: number }>;
      const summable = s.math === 'total' || s.math === 'sum';
      // Únicos, promedios y demás no se suman por día: el total de cada valor es su propia cuenta sobre el rango.
      const exact = summable
        ? null
        : new Map(
            ((await all(`SELECT ${value.sql} AS value, ${agg.sql} AS n FROM analytics_events e ${joins} WHERE ${where.sql} GROUP BY 1`, [...value.args, ...agg.args, ...where.args])) as Array<{ value: string | null; n: number | null }>).map(
              (r) => [r.value ?? '(none)', round2(Number(r.n ?? 0))] as const,
            ),
          );
      for (const b of breakdownSeries(rows.map((r) => ({ ...r, count: round2(Number(r.count ?? 0)) })), buckets, q.breakdownLimit ?? 25, summable)) {
        out.push({ label, breakdownValue: b.value, data: b.data, total: exact ? (exact.get(b.value) ?? 0) : round2(b.total) });
      }
    } else {
      const rows = (await all(`SELECT ${bucketSql(q.interval, 'e.ts', shift)} AS bucket, ${agg.sql} AS count FROM analytics_events e ${joins} WHERE ${where.sql} GROUP BY 1`, [
        off,
        ...agg.args,
        ...where.args,
      ])) as Array<{ bucket: string; count: number | null }>;
      const data = alignSeries(rows.map((r) => ({ bucket: r.bucket, count: round2(Number(r.count ?? 0)) })), buckets);
      let total = round2(data.reduce((a, b) => a + b, 0));
      if (s.math !== 'total' && s.math !== 'sum') {
        // Únicos, promedios y demás se calculan sobre el rango entero (no son la suma de cada cubeta).
        const t = (await getDb()
          .prepare(`SELECT ${agg.sql} AS n FROM analytics_events e ${joins} WHERE ${where.sql}`)
          .get(...agg.args, ...where.args)) as { n: number | null } | undefined;
        total = round2(Number(t?.n ?? 0));
      }
      out.push({ label, breakdownValue: null, data, total });
    }
  }
  return { buckets, series: sortBinned(q, out), usedRollup };
}

/** Series con la comparación y la fórmula ya aplicadas. */
async function trendsFor(project: ProjectRow, q: TrendsQuery, range: { from: number; to: number }, now: number, bins: BinCache = new Map()): Promise<{ buckets: string[]; series: TrendsResult['series']; usedRollup: boolean }> {
  const cur = await trendOnce(project, q, range, now, bins);
  const series = cur.series.map((s) => ({ ...s }) as TrendsResult['series'][number]);
  if (q.compare) {
    const prev = await trendOnce(project, q, previousAligned(range, q.interval, projectTz(project)), now, bins);
    for (const s of series) {
      const match = prev.series.find((p) => p.label === s.label && p.breakdownValue === s.breakdownValue);
      const data = match?.data ?? [];
      s.compare = s.data.map((_, i) => data[i] ?? 0);
      s.compareTotal = match?.total ?? 0;
    }
  }
  // Fórmula: una sola serie calculada (sin apertura, que multiplicaría las letras).
  if (q.formula && !q.breakdown && !q.breakdownsMore?.length && !q.breakdownCohorts?.length) {
    const node = parseFormula(q.formula);
    if (!node) throw new QueryError('invalid_formula');
    const data = applyFormula(node, series.map((x) => x.data), cur.buckets.length);
    const out: TrendsResult['series'][number] = {
      label: q.formula,
      breakdownValue: null,
      data,
      total: formulaValue(node, series.map((x) => x.total)),
    };
    if (q.compare) {
      out.compare = applyFormula(node, series.map((x) => x.compare ?? []), cur.buckets.length);
      out.compareTotal = formulaValue(node, series.map((x) => x.compareTotal ?? 0));
    }
    return { buckets: cur.buckets, series: [out], usedRollup: cur.usedRollup };
  }
  return { buckets: cur.buckets, series, usedRollup: cur.usedRollup };
}

export async function runTrends(project: ProjectRow, q: TrendsQuery, now = Date.now()): Promise<TrendsResult> {
  const tz = projectTz(project);
  const range = resolveRange(q.dateRange, now, tz);
  const bins: BinCache = new Map();
  const base = await trendsFor(project, q, range, now, bins);
  let { buckets, series } = base;
  const o = q.options;
  const daily = q.interval === 'day';
  // El promedio móvil mira días antes del rango, para que el primer día ya tenga su ventana completa.
  if (daily && o?.smoothing) {
    const n = o.smoothing;
    // El promedio mira los días reales, también los fines de semana, aunque después no se muestren.
    const wide = await trendsFor(project, { ...q, options: { ...o, hideWeekends: false } }, { from: range.from - (n - 1) * DAY, to: range.to }, now, bins);
    const len = buckets.length;
    series = series.map((s) => {
      const w = wide.series.find((x) => x.label === s.label && x.breakdownValue === s.breakdownValue);
      if (!w) return { ...s, data: rolling(s.data, n), compare: s.compare && rolling(s.compare, n) };
      return { ...s, data: rolling(w.data, n).slice(-len), compare: w.compare && rolling(w.compare, n).slice(-len) };
    });
  }
  const weekendsHidden = Boolean(daily && o?.hideWeekends);
  if (weekendsHidden) {
    const keep = buckets.map((b, i) => (isWeekend(b) ? -1 : i)).filter((i) => i >= 0);
    buckets = keep.map((i) => buckets[i]);
    series = series.map((s) => {
      const data = keep.map((i) => s.data[i]);
      const compare = s.compare && keep.map((i) => s.compare![i]);
      // Los activos en una ventana valen lo de su último punto: el último que se ve.
      return s.latest ? { ...s, data, compare, total: data[data.length - 1] ?? 0, compareTotal: compare ? (compare[compare.length - 1] ?? 0) : s.compareTotal } : { ...s, data, compare };
    });
  }
  const lastIncomplete = buckets.length > 0 && buckets[buckets.length - 1] === bucketOf(now, q.interval, tz);
  return { kind: 'trends', buckets, series: series.map(({ latest: _latest, ...x }) => x), usedRollup: base.usedRollup, options: o ?? null, lastIncomplete, weekendsHidden };
}

// ---------- Embudos ----------

/** Filas de un embudo (persona, sesión o grupo, ts, qué pasos y exclusiones cumple). La fecha rige en todos los pasos. */
async function funnelRows(project: ProjectRow, q: FunnelQuery, range: { from: number; to: number }, now: number): Promise<{ list: FunnelRow[]; truncated: boolean; actions: ActionMap; exclusions: Array<{ fromStep: number; toStep: number }> }> {
  const cohort = await cohortFrag(project, q.cohortId, now);
  const stepEvents = q.steps.map((s) => [s.event, ...(s.orEvents ?? [])]);
  const allStepEvents = new Set(stepEvents.flat());
  const n = q.steps.length;
  // Un evento que también es paso no puede excluir; en cualquier orden la exclusión rige en todo el embudo.
  const exclusions = (q.exclusions ?? [])
    .filter((x) => !allStepEvents.has(x.event))
    .map((x) => (q.order === 'unordered' ? { ...x, fromStep: 0, toStep: n - 1 } : { ...x, toStep: Math.min(x.toStep, n - 1) }))
    .filter((x) => x.fromStep < x.toStep);
  const actions = await loadActions(project.id, [...allStepEvents, ...exclusions.map((x) => x.event)]);
  const filters = [...internalFilters(project, q.excludeInternal), ...q.filters];
  const withPerson = needsPerson(filters) || q.steps.some((s) => needsPerson(s.filters)) || exclusions.some((x) => needsPerson(x.filters)) || q.breakdown?.type === 'person';
  const stepMatch = (i: number): Frag => {
    const ms = stepEvents[i].map((e) => eventMatch(e, actions));
    return { sql: ms.length === 1 ? ms[0].sql : `(${ms.map((m) => m.sql).join(' OR ')})`, args: ms.flatMap((m) => m.args) };
  };
  const flags: Frag[] = q.steps.map((s, i) => {
    const f = filtersSql(s.filters);
    const m = stepMatch(i);
    const parts = [m.sql, f.sql].filter(Boolean);
    return { sql: `(${parts.join(' AND ')})`, args: [...m.args, ...f.args] };
  });
  const exFlags: Frag[] = exclusions.map((x) => {
    const f = filtersSql(x.filters);
    const m = eventMatch(x.event, actions);
    const parts = [m.sql, f.sql].filter(Boolean);
    return { sql: `(${parts.join(' AND ')})`, args: [...m.args, ...f.args] };
  });
  const events = [...new Set([...allStepEvents, ...exclusions.map((x) => x.event)])];
  // Con una acción un paso puede ser cualquier evento, y en orden estricto importan todos los del medio.
  const anyEvent = q.order === 'strict' || events.includes('*') || events.some((e) => e.startsWith(ACTION_PREFIX));
  const where = whereFor(project, range, null, filters, cohort);
  const key: Frag = q.groupType ? { sql: groupKeySql(), args: [`$."$groups"."${q.groupType}"`] } : q.bySession ? { sql: 'e.session_id', args: [] } : { sql: PERSON_KEY, args: [] };
  const value = q.breakdown ? propText(q.breakdown.key, q.breakdown.type) : null;
  const notNull = q.groupType || q.bySession;
  const rows = (await all(
    `SELECT ${key.sql} AS person, e.ts AS ts${q.bySession ? `, ${PERSON_KEY} AS owner` : ''}${value ? `, ${value.sql} AS value` : ''}, ${[...flags.map((f, i) => `${f.sql} AS s${i}`), ...exFlags.map((f, i) => `${f.sql} AS x${i}`)].join(', ')}
     FROM analytics_events e ${personJoins(withPerson)}
     WHERE ${where.sql}${anyEvent ? '' : ` AND e.event IN (${events.map(() => '?').join(',')})`}${notNull ? ` AND ${key.sql} IS NOT NULL` : ''}
     ORDER BY person, e.ts LIMIT ?`,
    [...key.args, ...(value?.args ?? []), ...flags.flatMap((f) => f.args), ...exFlags.flatMap((f) => f.args), ...where.args, ...(anyEvent ? [] : events), ...(notNull ? key.args : []), ROW_CAP + 1],
  )) as Row[];

  // Primera vez: el momento en que cada uno hizo por primera vez ese evento, en toda su historia.
  let truncated = rows.length > ROW_CAP;
  const firstAt = new Map<number, Map<string, number>>();
  for (let i = 0; i < n; i++) {
    const s = q.steps[i];
    if (!s.first) continue;
    const m = stepMatch(i);
    const f = s.first === 'matching' ? filtersSql(s.filters) : { sql: '', args: [] };
    const needs = s.first === 'matching' && needsPerson(s.filters);
    const firsts = (await all(
      `SELECT ${key.sql} AS person, MIN(e.ts) AS ts FROM analytics_events e ${personJoins(needs)}
       WHERE e.project_id = ? AND e.ts >= 0 AND e.ts <= 8640000000000000 AND ${m.sql}${f.sql ? ` AND ${f.sql}` : ''}${notNull ? ` AND ${key.sql} IS NOT NULL` : ''} GROUP BY 1 LIMIT ?`,
      [...key.args, project.id, ...m.args, ...f.args, ...(notNull ? key.args : []), ROW_CAP + 1],
    )) as Row[];
    if (firsts.length > ROW_CAP) truncated = true;
    firstAt.set(i, new Map(firsts.map((r) => [String(r.person), Number(r.ts)])));
  }

  const list: FunnelRow[] = rows.slice(0, ROW_CAP).map((r) => {
    const person = String(r.person);
    const ts = Number(r.ts);
    return {
      person,
      ts,
      steps: q.steps.map((_, i) => i).filter((i) => Number(r[`s${i}`]) === 1 && (!firstAt.has(i) || firstAt.get(i)?.get(person) === ts)),
      excl: exclusions.map((_, i) => i).filter((i) => Number(r[`x${i}`]) === 1),
      value: value ? (r.value == null ? null : String(r.value)) : undefined,
      owner: q.bySession ? String(r.owner) : undefined,
    };
  });

  // Primera de todas: si esa primera vez no cumple los filtros del paso o cae fuera de las fechas,
  // la persona queda afuera de todo el embudo aunque después lo haga bien. Quien nunca lo hizo sigue.
  const everSteps = q.steps.flatMap((s, i) => (s.first === 'ever' ? [i] : []));
  if (!everSteps.length) return { truncated, actions, exclusions, list };
  const met = new Set(list.flatMap((r) => everSteps.filter((i) => r.steps.includes(i)).map((i) => `${i}:${r.person}`)));
  const out = new Set<string>();
  for (const i of everSteps) {
    for (const person of firstAt.get(i)?.keys() ?? []) if (!met.has(`${i}:${person}`)) out.add(person);
  }
  return { truncated, actions, exclusions, list: list.filter((r) => !out.has(r.person)) };
}

function funnelStepLabel(s: FunnelQuery['steps'][number], actions: ActionMap): string {
  if (s.label) return s.label;
  const name = (e: string) => (e.startsWith(ACTION_PREFIX) ? (actions.get(e.slice(ACTION_PREFIX.length))?.name ?? 'Deleted action') : e);
  return [s.event, ...(s.orEvents ?? [])].map(name).join(' / ');
}

export async function runFunnel(project: ProjectRow, q: FunnelQuery, now = Date.now()): Promise<FunnelResult> {
  const range = resolveRange(q.dateRange, now, projectTz(project));
  const windowMs = funnelWindowMs(q);
  const order = q.order ?? 'ordered';
  const display = q.display ?? 'steps';
  const { list, truncated, actions, exclusions } = await funnelRows(project, { ...q, order }, range, now);
  const c = computeFunnel(list, q.steps.length, windowMs, range, {
    order,
    exclusions,
    attribution: q.breakdown ? (q.attribution ?? 'first') : null,
    attributionStep: Math.min(q.attributionStep ?? 0, q.steps.length - 1),
    historical: display === 'trends' ? { interval: q.interval ?? 'day', tz: projectTz(project), now } : null,
  });
  const first = c.counts[0] || 0;
  return {
    kind: 'funnel',
    steps: q.steps.map((s, i) => ({
      label: funnelStepLabel(s, actions),
      event: s.event,
      count: c.counts[i],
      conversion: first ? c.counts[i] / first : 0,
      stepConversion: i === 0 ? 1 : c.counts[i - 1] ? c.counts[i] / c.counts[i - 1] : 0,
      dropped: i + 1 < q.steps.length ? c.counts[i] - c.counts[i + 1] : 0,
      medianMs: c.medians[i],
    })),
    droppedPersons: c.dropped,
    reachedPersons: c.reached,
    truncated,
    unit: q.groupType ? 'group' : q.bySession ? 'session' : 'person',
    order,
    display,
    times: c.times,
    breakdown: q.breakdown ? c.breakdown : undefined,
    historical: c.historical ?? undefined,
  };
}

// ---------- Correlación ----------

const NOISE_EVENTS = ['$set', '$identify', '$groupidentify', '$create_alias', '$pageleave', '$feature_flag_called'];
const CORRELATION_PEOPLE = 5000;

/** Qué hicieron (o qué propiedades tienen) los que convirtieron y los que no. */
export async function runCorrelation(project: ProjectRow, q: CorrelationQuery, now = Date.now()): Promise<CorrelationResult> {
  const f = q.funnel;
  const range = resolveRange(f.dateRange, now, projectTz(project));
  const windowMs = funnelWindowMs(f);
  const { list, truncated, exclusions } = await funnelRows(project, { ...f, groupType: null, bySession: false, breakdown: null, order: f.order ?? 'ordered' }, range, now);
  const c = computeFunnel(list, f.steps.length, windowMs, range, { order: f.order ?? 'ordered', exclusions, droppedLimit: Number.MAX_SAFE_INTEGER });
  const dropped = new Set(c.dropped.flat());
  const converted = new Set(c.converted);
  const base = { kind: 'correlation' as const, convertedPeople: converted.size, droppedPeople: dropped.size };
  if (!converted.size && !dropped.size) return { ...base, positive: [], negative: [], truncated };
  if (q.source === 'events') {
    const skip = new Set([...NOISE_EVENTS, ...f.steps.map((s) => s.event)]);
    const rows = (await all(
      `SELECT DISTINCT ${PERSON_KEY} AS person, e.event AS name FROM analytics_events e ${personJoins(false)}
       WHERE e.project_id = ? AND e.ts >= ? AND e.ts <= ? LIMIT ?`,
      [project.id, range.from, range.to, ROW_CAP + 1],
    )) as Array<{ person: string; name: string }>;
    const r = correlate(rows.slice(0, ROW_CAP).filter((x) => !skip.has(String(x.name))).map((x) => ({ person: String(x.person), name: String(x.name) })), converted, dropped, 'event');
    return { ...base, ...r, truncated: truncated || rows.length > ROW_CAP };
  }
  // Propiedades: una muestra acotada de personas de cada lado.
  const ids = [...[...converted].slice(0, CORRELATION_PEOPLE), ...[...dropped].slice(0, CORRELATION_PEOPLE)];
  const props: Array<{ person: string; name: string }> = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = (await all(`SELECT id, properties FROM analytics_persons WHERE project_id = ? AND id IN (${chunk.map(() => '?').join(',')})`, [project.id, ...chunk])) as Array<{ id: string; properties: string }>;
    for (const r of rows) {
      for (const [k, v] of Object.entries(parseProps(r.properties))) {
        if (k.startsWith('$initial_') || (typeof v !== 'string' && typeof v !== 'boolean' && typeof v !== 'number')) continue;
        const text = String(v);
        // Valores largos o casi únicos (emails, ids) no dicen nada.
        if (text.length > 60 || k === 'email' || k === 'name') continue;
        props.push({ person: r.id, name: `${k} = ${text}` });
      }
    }
  }
  return { ...base, ...correlate(props, converted, dropped, 'property'), truncated: truncated || ids.length < converted.size + dropped.size };
}

// ---------- Stickiness ----------


export async function runStickiness(project: ProjectRow, q: StickinessQuery, now = Date.now()): Promise<StickinessResult> {
  const tz = projectTz(project);
  const range = resolveRange(q.dateRange, now, tz);
  const intervals = Math.max(bucketList(range.from, range.to, q.interval, tz).length, 1);
  const cohort = await cohortFrag(project, q.cohortId, now);
  const actions = await loadActions(project.id, q.series.map((s) => s.event));
  let truncated = false;
  const series: StickinessResult['series'] = [];
  for (const s of q.series) {
    const filters = [...internalFilters(project, q.excludeInternal), ...q.filters, ...s.filters];
    const where = whereFor(project, range, s.event, filters, cohort, actions);
    const rows = (await all(
      `SELECT ${PERSON_KEY} AS person, COUNT(DISTINCT ${bucketSql(q.interval, 'e.ts', shiftFor(project, range))}) AS n FROM analytics_events e ${personJoins(needsPerson(filters))}
       WHERE ${where.sql} GROUP BY 1 LIMIT ?`,
      [offAt(project, range.from), ...where.args, ROW_CAP + 1],
    )) as Array<{ person: string; n: number }>;
    truncated = truncated || rows.length > ROW_CAP;
    const data = stickinessHistogram(rows.slice(0, ROW_CAP).map((r) => Number(r.n)), intervals);
    series.push({ label: seriesLabel(s.event, { math: 'total', label: s.label }, actions), data, total: data.reduce((a, b) => a + b, 0) });
  }
  return { kind: 'stickiness', interval: q.interval, intervals, series, truncated };
}

// ---------- Ciclo de vida ----------

export async function runLifecycle(project: ProjectRow, q: LifecycleQuery, now = Date.now()): Promise<LifecycleResult> {
  const tz = projectTz(project);
  const range = resolveRange(q.dateRange, now, tz);
  // Una cubeta antes del rango, para saber quién venía del intervalo anterior.
  const before = bucketBefore(range.from, q.interval, tz);
  const off = offAt(project, before);
  const buckets = bucketList(before, range.to, q.interval, tz);
  const cohort = await cohortFrag(project, q.cohortId, now);
  const actions = await loadActions(project.id, [q.event]);
  const filters = [...internalFilters(project, q.excludeInternal), ...q.filters, ...q.eventFilters];
  const joins = personJoins(needsPerson(filters));
  const where = whereFor(project, { from: before, to: range.to }, q.event, filters, cohort, actions);
  const rows = (await all(`SELECT DISTINCT ${PERSON_KEY} AS person, ${bucketSql(q.interval, 'e.ts', shiftFor(project, { from: before, to: range.to }))} AS bucket FROM analytics_events e ${joins} WHERE ${where.sql} LIMIT ?`, [
    off,
    ...where.args,
    ROW_CAP + 1,
  ])) as Array<{ person: string; bucket: string }>;
  // Primer evento de siempre de cada persona (dentro de lo que se retiene).
  const whereFirst = whereFor(project, { from: 0, to: range.to }, q.event, filters, cohort, actions);
  const firsts = (await all(`SELECT ${PERSON_KEY} AS person, MIN(e.ts) AS first FROM analytics_events e ${joins} WHERE ${whereFirst.sql} GROUP BY 1 LIMIT ?`, [
    ...whereFirst.args,
    ROW_CAP + 1,
  ])) as Array<{ person: string; first: number }>;
  const firstSeen = new Map(firsts.map((r) => [String(r.person), bucketOf(Number(r.first), q.interval, tz)]));
  const c = computeLifecycle(rows.slice(0, ROW_CAP).map((r) => ({ person: String(r.person), bucket: String(r.bucket) })), firstSeen, buckets);
  return { kind: 'lifecycle', interval: q.interval, buckets: buckets.slice(1), ...c, truncated: rows.length > ROW_CAP || firsts.length > ROW_CAP };
}

// ---------- Retención ----------

export async function runRetention(project: ProjectRow, q: RetentionQuery, now = Date.now()): Promise<RetentionResult> {
  const tz = projectTz(project);
  const lastPeriod = periodOf(now, q.period, tz);
  const firstPeriod = lastPeriod - q.periods + 1;
  const from = fromLocal(periodStartLocal(firstPeriod, q.period), tz);
  const off = offAt(project, from);
  const shift = shiftFor(project, { from, to: now });
  const cohort = await cohortFrag(project, q.cohortId, now);
  const filters = [...internalFilters(project, q.excludeInternal), ...q.filters];
  const actions = await loadActions(project.id, [q.startEvent, q.returnEvent]);
  const withPerson = needsPerson(filters) || q.breakdown?.type === 'person';
  const key: Frag = q.groupType ? { sql: groupKeySql(), args: [`$."$groups"."${q.groupType}"`] } : { sql: PERSON_KEY, args: [] };
  const bd = q.breakdown ? propText(q.breakdown.key, q.breakdown.type) : null;
  const notNull = q.groupType ? ` AND ${key.sql} IS NOT NULL` : '';
  // CAST: Turso manda los números como REAL y la división tiene que ser entera.
  const periodExpr = periodSql(q.period, shift);
  const fetch = async (event: string) => {
    const where = whereFor(project, { from, to: now }, event, filters, cohort, actions);
    return (await all(
      `SELECT DISTINCT ${key.sql} AS person, ${periodExpr} AS period${bd ? `, ${bd.sql} AS value` : ''} FROM analytics_events e ${personJoins(withPerson)} WHERE ${where.sql}${notNull} LIMIT ?`,
      // La expresión de mes usa el desfase dos veces.
      [...key.args, ...(q.period === 'month' ? [off, off] : [off]), ...(bd?.args ?? []), ...where.args, ...(q.groupType ? key.args : []), ROW_CAP + 1],
    )) as Array<{ person: string; period: number; value?: string | null }>;
  };
  const [rawStarts, returns] = await Promise.all([fetch(q.startEvent), q.returnEvent === q.startEvent ? null : fetch(q.returnEvent)]);
  const rawReturns = returns ?? rawStarts;
  let truncated = rawStarts.length > ROW_CAP || rawReturns.length > ROW_CAP;
  const norm = (rows: typeof rawStarts) => rows.slice(0, ROW_CAP).map((r) => ({ person: String(r.person), period: Number(r.period), value: r.value == null ? null : String(r.value) }));
  let starts = norm(rawStarts);
  const rets = norm(rawReturns);
  // La primera de todas: quien ya lo había hecho antes del rango no entra en ninguna cohorte.
  if (q.type === 'first_ever') {
    const m = eventMatch(q.startEvent, actions);
    const firsts = (await all(
      `SELECT ${key.sql} AS person, MIN(e.ts) AS ts FROM analytics_events e ${personJoins(false)} WHERE e.project_id = ? AND e.ts >= 0 AND e.ts <= 8640000000000000 AND ${m.sql}${notNull} GROUP BY 1 LIMIT ?`,
      [...key.args, project.id, ...m.args, ...(q.groupType ? key.args : []), ROW_CAP + 1],
    )) as Array<{ person: string; ts: number }>;
    if (firsts.length > ROW_CAP) truncated = true;
    const firstPeriodOf = new Map(firsts.map((r) => [String(r.person), periodOf(Number(r.ts), q.period, tz)]));
    starts = starts.filter((r) => firstPeriodOf.get(r.person) === r.period);
  }
  const opts = { recurring: q.type === 'recurring', cumulative: q.cumulative };
  const label = (cs: ReturnType<typeof computeRetention>) => cs.map((c) => ({ start: periodLabel(c.period, q.period), size: c.size, values: c.values }));
  // Con apertura, el inicio y la vuelta tienen que tener el mismo valor.
  const values = bd ? [...new Set(starts.map((r) => r.value))] : [];
  const breakdown = bd
    ? values
        .map((value) => ({
          value,
          cohorts: label(computeRetention(starts.filter((r) => r.value === value), rets.filter((r) => r.value === value), firstPeriod, q.periods, opts)),
        }))
        .sort((a, b) => b.cohorts.reduce((n, c) => n + c.size, 0) - a.cohorts.reduce((n, c) => n + c.size, 0))
        .slice(0, 25)
    : undefined;
  let drillPersons: string[] | undefined;
  if (q.drill) {
    const v = q.drill.value;
    const inValue = <T extends { value: string | null }>(rows: T[]) => (bd && v !== undefined ? rows.filter((r) => r.value === v) : rows);
    drillPersons = retentionCellPeople(inValue(starts), inValue(rets), firstPeriod, q.periods, opts, q.drill.cohort, q.drill.k);
  }
  return {
    kind: 'retention',
    period: q.period,
    cohorts: label(computeRetention(starts, rets, firstPeriod, q.periods, opts)),
    truncated,
    options: { reference: q.reference, mean: q.mean, labelStart: q.labelStart, chart: q.chart, show: q.show },
    unit: q.groupType ? 'group' : 'person',
    breakdown,
    drillPersons,
  };
}

// ---------- Caminos ----------

export async function runPaths(project: ProjectRow, q: PathsQuery, now = Date.now()): Promise<PathsResult> {
  const range = resolveRange(q.dateRange, now, projectTz(project));
  // Con eventos propios: la página o el nombre del evento (sin el ruido de autocapture e identify).
  const source = q.source ?? 'pageviews';
  // Desde un paso de un embudo: solo esa gente y la parte de su actividad que importa.
  const f = q.funnel;
  let windows: Map<string, { from: number; to: number }> | null = null;
  let funnelTruncated = false;
  if (f) {
    const order = f.query.order ?? 'ordered';
    const fr = await funnelRows(project, { ...f.query, order, groupType: null, bySession: false, breakdown: null }, range, now);
    funnelTruncated = fr.truncated;
    const c = computeFunnel(fr.list, f.query.steps.length, funnelWindowMs(f.query), range, { order, exclusions: fr.exclusions, droppedLimit: 0, collectTimes: true });
    windows = new Map();
    for (const [person, times] of c.personTimes ?? []) {
      const w = pathWindow(f.mode, Math.min(f.step, f.query.steps.length - 1), times);
      if (w) windows.set(person, w);
    }
  }
  const owner = f ? `, ${PERSON_KEY} AS person` : '';
  const ownerJoin = f ? personJoins(false) : '';
  const rows = (await all(
    source === 'all'
      ? `SELECT e.session_id AS session, e.pathname AS path, e.event AS event, e.ts AS ts${owner} FROM analytics_events e ${ownerJoin}
         WHERE e.project_id = ? AND e.event NOT IN ('$autocapture', '$identify', '$set', '$groupidentify', '$create_alias', '$pageleave', '$feature_flag_called', '$web_vitals') AND e.ts >= ? AND e.ts <= ? AND e.session_id IS NOT NULL
         ORDER BY e.ts LIMIT ?`
      : `SELECT e.session_id AS session, e.pathname AS path, e.event AS event, e.ts AS ts${owner} FROM analytics_events e ${ownerJoin}
         WHERE e.project_id = ? AND e.event = '$pageview' AND e.ts >= ? AND e.ts <= ? AND e.session_id IS NOT NULL AND e.pathname IS NOT NULL
         ORDER BY e.ts LIMIT ?`,
    [project.id, range.from, range.to, ROW_CAP + 1],
  )) as Array<{ session: string; path: string | null; event: string; ts: number; person?: string }>;
  const truncated = rows.length > ROW_CAP || funnelTruncated;
  const kept = windows
    ? rows.slice(0, ROW_CAP).filter((x) => {
        const w = windows.get(String(x.person));
        return w !== undefined && Number(x.ts) >= w.from && Number(x.ts) <= w.to;
      })
    : rows.slice(0, ROW_CAP);
  const nodes = kept.map((x) => {
    const raw = String(x.event) === '$pageview' ? String(x.path ?? '') : String(x.event);
    return { session: String(x.session), path: q.collapseIds && String(x.event) === '$pageview' ? collapsePath(raw) : raw, ts: Number(x.ts) };
  });
  const r = computePaths(nodes.filter((n) => n.path), q.steps, q.startPath || null, 30, q.endPath || null);
  return { kind: 'paths', ...r, truncated };
}

// ---------- SQL ----------

let tableNames: { at: number; names: string[] } | null = null;

async function realTables(): Promise<string[]> {
  if (tableNames && Date.now() - tableNames.at < 300_000) return tableNames.names;
  const rows = (await all(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`, [])) as Array<{ name: string }>;
  tableNames = { at: Date.now(), names: rows.map((r) => String(r.name)) };
  return tableNames.names;
}

function cell(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.length > 2000) return `${v.slice(0, 2000)}…`;
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return '[blob]';
  return v;
}

/** Consultas SQL corriendo en esta instancia (procesos hijos o esperas a Turso). */
let sqlRunning = 0;
export const SQL_CONCURRENCY = Number(process.env.ANALYTICS_SQL_CONCURRENCY) || 4;

export async function runSql(project: ProjectRow, sql: string): Promise<SqlResult> {
  const check = checkSql(sql, await realTables());
  if (!check.ok) throw new QueryError(check.error, check.detail);
  const wrapped = wrapSql(check.sql, project.id);
  // Como mucho SQL_CONCURRENCY consultas SQL a la vez por instancia; el resto, 429.
  if (sqlRunning >= SQL_CONCURRENCY) throw new QueryError('sql_busy');
  sqlRunning++;
  const started = Date.now();
  try {
    // Tope duro de tiempo y solo lectura (ver lib/analytics/sql-run.ts).
    const res = await runReadOnly(wrapped.sql, wrapped.args, SQL_MAX_ROWS);
    const rows = res.rows.slice(0, SQL_MAX_ROWS).map((row) => row.map(cell));
    return { kind: 'sql', columns: res.columns, rows, truncated: res.rows.length > SQL_MAX_ROWS, ms: Date.now() - started };
  } catch (err) {
    if (err instanceof SqlRunError && err.code === 'timeout') throw new QueryError('sql_timeout');
    const msg = err instanceof SqlRunError ? err.detail : err instanceof Error ? err.message : undefined;
    throw new QueryError('sql_error', msg?.replace(/analytics_[a-z_]+/g, '…').slice(0, 300));
  } finally {
    sqlRunning--;
  }
}

// ---------- Despacho ----------

export async function runInsight(project: ProjectRow, q: InsightQuery, now = Date.now()): Promise<InsightResult> {
  switch (q.kind) {
    case 'trends':
      return runTrends(project, q, now);
    case 'funnel':
      return runFunnel(project, q, now);
    case 'retention':
      return runRetention(project, q, now);
    case 'paths':
      return runPaths(project, q, now);
    case 'sql':
      return runSql(project, q.sql);
    case 'stickiness':
      return runStickiness(project, q, now);
    case 'lifecycle':
      return runLifecycle(project, q, now);
  }
}

// ---------- Web ----------

type Top = Array<{ key: string; visitors: number; views: number }>;

export async function runWeb(project: ProjectRow, q: WebQuery, now = Date.now()): Promise<WebResult> {
  const tz = projectTz(project);
  const range = resolveRange(q.dateRange, now, tz);
  const off = offAt(project, range.from);
  const prev = previousAligned(range, range.to - range.from <= 2 * DAY ? 'hour' : 'day', tz);
  const interval = range.to - range.from <= 2 * DAY ? 'hour' : 'day';
  const buckets = bucketList(range.from, range.to, interval, tz);
  // Los filtros de fuente valen por visita: la fuente siempre es la de su primera página, aunque esté antes del rango.
  const isSource = (f: { key: string }) => f.key === 'referrer' || f.key === 'utm' || f.key === 'channel';
  const filter = webFiltersSql((q.filters ?? []).filter((f) => !isSource(f)));
  const sources = (q.filters ?? []).filter(isSource);
  const srcE = webFiltersSql(sources, 'e');
  const srcA = webFiltersSql(sources, 'a');
  const sourceSql = sources.length
    ? ` AND (CASE WHEN e.session_id IS NULL THEN (${srcE.sql}) ELSE e.session_id IN (
         SELECT a.session_id FROM analytics_events a JOIN (
           SELECT b.session_id AS sid, MIN(b.ts) AS t FROM analytics_events b WHERE b.project_id = ? AND b.event = '$pageview' AND b.session_id IN (
             SELECT c.session_id FROM analytics_events c WHERE c.project_id = ? AND c.event = '$pageview' AND c.ts >= ? AND c.ts <= ? AND c.session_id IS NOT NULL
           ) GROUP BY 1
         ) w ON a.session_id = w.sid AND a.ts = w.t
         WHERE a.project_id = ? AND a.event = '$pageview' AND ${srcA.sql}) END)`
    : '';
  const pv = `e.project_id = ? AND e.event = '$pageview' AND e.ts >= ? AND e.ts <= ?${filter.sql ? ` AND ${filter.sql}` : ''}${sourceSql}`;
  const pvArgs = (r: { from: number; to: number }): Arg[] => [
    project.id,
    r.from,
    r.to,
    ...filter.args,
    ...(sources.length ? [...srcE.args, project.id, project.id, r.from, r.to, project.id, ...srcA.args] : []),
  ];
  const join = personJoins(false);
  /** Con filtros, las sesiones son las que tuvieron un pageview que los cumple. */
  const sessionFilter = (r: { from: number; to: number }): Frag =>
    filter.sql || sources.length ? { sql: ` AND id IN (SELECT e.session_id FROM analytics_events e WHERE ${pv} AND e.session_id IS NOT NULL)`, args: pvArgs(r) } : { sql: '', args: [] };

  const stats = async (r: { from: number; to: number }) => {
    const [a, s] = await Promise.all([
      getDb()
        .prepare(`SELECT COUNT(DISTINCT ${PERSON_KEY}) AS visitors, COUNT(*) AS pageviews FROM analytics_events e ${join} WHERE ${pv}`)
        .get(...pvArgs(r)) as Promise<{ visitors: number; pageviews: number } | undefined>,
      getDb()
        .prepare(
          `SELECT COUNT(*) AS sessions, SUM(CASE WHEN pageviews <= 1 THEN 1 ELSE 0 END) AS bounces, AVG(ended_at - started_at) AS dur
           FROM analytics_sessions WHERE project_id = ? AND started_at >= ? AND started_at <= ? AND pageviews > 0${sessionFilter(r).sql}`,
        )
        .get(project.id, r.from, r.to, ...sessionFilter(r).args) as Promise<{ sessions: number; bounces: number | null; dur: number | null } | undefined>,
    ]);
    const sessions = Number(s?.sessions ?? 0);
    return {
      visitors: Number(a?.visitors ?? 0),
      pageviews: Number(a?.pageviews ?? 0),
      sessions,
      bounceRate: sessions ? Number(s?.bounces ?? 0) / sessions : 0,
      avgDurationSec: Math.round(Number(s?.dur ?? 0) / 1000),
    };
  };

  const top = (col: string): Promise<Top> =>
    all(
      `SELECT COALESCE(${col}, '(none)') AS key, COUNT(DISTINCT ${PERSON_KEY}) AS visitors, COUNT(*) AS views FROM analytics_events e ${join}
       WHERE ${pv} GROUP BY 1 ORDER BY visitors DESC, views DESC LIMIT 10`,
      pvArgs(range),
    ).then((rows) => rows.map((r) => ({ key: String(r.key), visitors: Number(r.visitors), views: Number(r.views) })));

  /**
   * De dónde vino cada visita: lo dice el primer pageview de la sesión. Lo que se navega adentro
   * del sitio no suma otra fuente. Los pageviews sin sesión (de un servidor) cuentan solos.
   */
  const topEntry = (col: string): Promise<Top> =>
    all(
      `WITH f AS (SELECT e.session_id AS sid, COUNT(*) AS views FROM analytics_events e WHERE ${pv} AND e.session_id IS NOT NULL GROUP BY 1),
       firsts AS (SELECT b.session_id AS sid, MIN(b.ts) AS t FROM analytics_events b WHERE b.project_id = ? AND b.event = '$pageview' AND b.session_id IN (SELECT sid FROM f) GROUP BY 1),
       rows AS (
         SELECT ${col} AS c, ${PERSON_KEY} AS person, f.views AS views FROM firsts JOIN f ON f.sid = firsts.sid
           JOIN analytics_events e ON e.project_id = ? AND e.session_id = firsts.sid AND e.ts = firsts.t AND e.event = '$pageview' ${join} GROUP BY firsts.sid
         UNION ALL
         SELECT ${col} AS c, ${PERSON_KEY} AS person, 1 AS views FROM analytics_events e ${join} WHERE ${pv} AND e.session_id IS NULL
       )
       SELECT COALESCE(c, '(none)') AS key, COUNT(DISTINCT person) AS visitors, SUM(views) AS views FROM rows GROUP BY 1 ORDER BY visitors DESC, views DESC LIMIT 10`,
      [...pvArgs(range), project.id, project.id, ...pvArgs(range)],
    ).then((rows) => rows.map((r) => ({ key: String(r.key), visitors: Number(r.visitors), views: Number(r.views) })));

  const [cur, before, chart, pages, entries, referrers, utmSources, countries, devices, browsers, os, hosts, channels] = await Promise.all([
    stats(range),
    q.compare ? stats(prev) : Promise.resolve(null),
    all(
      `SELECT ${bucketSql(interval, 'e.ts', shiftFor(project, range))} AS bucket, COUNT(DISTINCT ${PERSON_KEY}) AS visitors, COUNT(*) AS views FROM analytics_events e ${join}
       WHERE ${pv} GROUP BY 1`,
      [off, ...pvArgs(range)],
    ),
    top('e.pathname'),
    all(
      `SELECT COALESCE(entry_path, '(none)') AS key, COUNT(DISTINCT COALESCE((SELECT m.person_id FROM analytics_person_ids m WHERE m.project_id = analytics_sessions.project_id AND m.distinct_id = analytics_sessions.distinct_id), distinct_id)) AS visitors, COUNT(*) AS views FROM analytics_sessions
       WHERE project_id = ? AND started_at >= ? AND started_at <= ? AND pageviews > 0${sessionFilter(range).sql} GROUP BY 1 ORDER BY visitors DESC LIMIT 10`,
      [project.id, range.from, range.to, ...sessionFilter(range).args],
    ).then((rows) => rows.map((r) => ({ key: String(r.key), visitors: Number(r.visitors), views: Number(r.views) }))),
    topEntry(referrerSql('e')),
    topEntry('e.utm_source'),
    top('e.country'),
    top('e.device'),
    top('e.browser'),
    top('e.os'),
    top('e.host'),
    topEntry(channelSql('e')),
  ]);
  // Sin pageviews en el período: ¿el proyecto recibió alguno alguna vez? Cambia lo que se le dice a la persona.
  const hasPageviews =
    cur.pageviews > 0 ||
    !!(await getDb().prepare(`SELECT 1 AS ok FROM analytics_events WHERE project_id = ? AND event = '$pageview' LIMIT 1`).get(project.id));
  const stat = (k: keyof typeof cur) => ({ value: cur[k], previous: before ? before[k] : null });
  return {
    kind: 'web',
    buckets,
    visitors: alignSeries(chart.map((r) => ({ bucket: String(r.bucket), count: Number(r.visitors) })), buckets),
    pageviews: alignSeries(chart.map((r) => ({ bucket: String(r.bucket), count: Number(r.views) })), buckets),
    stats: {
      visitors: stat('visitors'),
      pageviews: stat('pageviews'),
      sessions: stat('sessions'),
      bounceRate: stat('bounceRate'),
      avgDurationSec: stat('avgDurationSec'),
    },
    pages,
    entries,
    referrers,
    utmSources: utmSources.filter((u) => u.key !== '(none)'),
    countries,
    devices,
    browsers,
    os,
    hosts,
    channels,
    hasPageviews,
  };
}

// ---------- Eventos en vivo ----------

function parseProps(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function toLiveEvent(r: Row): LiveEvent {
  return {
    id: Number(r.id),
    event: String(r.event),
    distinctId: String(r.distinct_id),
    ts: Number(r.ts),
    url: (r.url as string | null) ?? null,
    pathname: (r.pathname as string | null) ?? null,
    browser: (r.browser as string | null) ?? null,
    os: (r.os as string | null) ?? null,
    device: (r.device as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    properties: parseProps(r.properties),
  };
}

/** Últimos eventos (o los posteriores al cursor `after`), lo más nuevo primero. */
export async function liveEvents(
  project: ProjectRow,
  opts: { after?: number | null; before?: number | null; event?: string | null; distinctId?: string | null; limit?: number } = {},
): Promise<LiveEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const parts = ['project_id = ?'];
  const args: Arg[] = [project.id];
  if (opts.after) {
    parts.push('id > ?');
    args.push(opts.after);
  }
  if (opts.before) {
    parts.push('id < ?');
    args.push(opts.before);
  }
  if (opts.event) {
    parts.push('event = ?');
    args.push(opts.event);
  }
  if (opts.distinctId) {
    parts.push('distinct_id = ?');
    args.push(opts.distinctId);
  }
  const rows = await all(
    `SELECT id, event, distinct_id, ts, url, pathname, browser, os, device, country, properties FROM analytics_events
     WHERE ${parts.join(' AND ')} ORDER BY id DESC LIMIT ?`,
    [...args, limit],
  );
  return rows.map(toLiveEvent);
}

/** Nombres de eventos del proyecto (los más usados en los últimos 30 días), para los selectores. */
export async function eventNames(project: ProjectRow, now = Date.now()): Promise<Array<{ event: string; count: number }>> {
  const rows = await all(
    `SELECT event, COUNT(*) AS n FROM analytics_events WHERE project_id = ? AND ts >= ? GROUP BY event ORDER BY n DESC LIMIT 100`,
    [project.id, now - 30 * DAY],
  );
  return rows.map((r) => ({ event: String(r.event), count: Number(r.n) }));
}

/** Claves de propiedades vistas en los últimos eventos (muestra de 500), para los filtros. */
export async function propertyKeys(project: ProjectRow): Promise<{ event: string[]; person: string[] }> {
  const [ev, pe] = await Promise.all([
    all(`SELECT properties FROM analytics_events WHERE project_id = ? ORDER BY id DESC LIMIT 500`, [project.id]),
    all(`SELECT properties FROM analytics_persons WHERE project_id = ? ORDER BY last_seen DESC LIMIT 200`, [project.id]),
  ]);
  const keys = (rows: Row[]) => {
    const set = new Set<string>();
    for (const r of rows) for (const k of Object.keys(parseProps(r.properties))) if (k.length <= 200 && !/["\\]/.test(k)) set.add(k);
    return [...set].sort().slice(0, 300);
  };
  return { event: keys(ev), person: keys(pe) };
}

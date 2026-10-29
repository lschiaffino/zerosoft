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
  bucketSql,
  computeFunnel,
  computePaths,
  computeRetention,
  periodLabel,
  periodOf,
  previousRange,
  resolveRange,
  type FunnelRow,
} from './compute';
import { cohortSql, filtersSql, needsPerson, personJoins, PERSON_KEY, propText, type Arg, type Frag } from './sql-build';
import { checkSql, SQL_MAX_ROWS, wrapSql } from './sql-safe';
import { runReadOnly, SqlRunError } from './sql-run';
import { getCohort } from './records';
import type { ProjectRow } from './projects';
import type {
  FunnelQuery,
  FunnelResult,
  InsightQuery,
  InsightResult,
  LiveEvent,
  PathsQuery,
  PathsResult,
  PropertyFilter,
  RetentionQuery,
  RetentionResult,
  SqlResult,
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

const offMs = (p: ProjectRow) => Number(p.tz_offset_min) * 60_000;

async function cohortFrag(project: ProjectRow, cohortId: string | null | undefined, now: number): Promise<Frag | null> {
  if (!cohortId) return null;
  const c = await getCohort(project.id, cohortId);
  if (!c) throw new QueryError('cohort_not_found');
  const sub = cohortSql(project.id, c.definition, now);
  return { sql: `${PERSON_KEY} IN (${sub.sql})`, args: sub.args };
}

/** WHERE común: proyecto, rango, evento (salvo '*'), filtros y cohorte. */
function whereFor(
  project: ProjectRow,
  range: { from: number; to: number },
  event: string | null,
  filters: PropertyFilter[],
  cohort: Frag | null,
): Frag {
  const parts = ['e.project_id = ?', 'e.ts >= ?', 'e.ts <= ?'];
  const args: Arg[] = [project.id, range.from, range.to];
  if (event && event !== '*') {
    parts.push('e.event = ?');
    args.push(event);
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

// ---------- Tendencias ----------

function seriesLabel(event: string, math: 'total' | 'unique', label?: string): string {
  if (label) return label;
  const name = event === '*' ? 'All events' : event;
  return math === 'unique' ? `${name} (unique users)` : name;
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
  const off = offMs(project);
  // El rango tiene que arrancar a medianoche local para que los días cierren.
  if ((range.from + off) % DAY !== 0) return null;
  const fromDay = bucketOf(range.from, 'day', Number(project.tz_offset_min));
  const rolled = project.dirty_from && project.dirty_from <= project.rolled_through ? dayBefore(project.dirty_from) : project.rolled_through;
  if (rolled < fromDay) return null;
  const toDay = bucketOf(range.to, 'day', Number(project.tz_offset_min));
  const lastRolled = rolled < toDay ? rolled : toDay;
  const daily = (await all(`SELECT day, ${math === 'unique' ? 'uniques' : 'count'} AS n FROM analytics_daily WHERE project_id = ? AND event = ? AND day >= ? AND day <= ?`, [
    project.id,
    event,
    fromDay,
    lastRolled,
  ])) as Array<{ day: string; n: number }>;
  const rows: Array<{ bucket: string; count: number }> = daily.map((d) => ({
    bucket: interval === 'day' ? d.day : bucketOf(Date.parse(`${d.day}T00:00:00Z`) - off, interval, Number(project.tz_offset_min)),
    count: Number(d.n),
  }));
  if (lastRolled < toDay) {
    const rawFrom = Date.parse(`${dayAfter(lastRolled)}T00:00:00Z`) - off;
    const agg = math === 'unique' ? `COUNT(DISTINCT ${PERSON_KEY})` : 'COUNT(*)';
    const raw = (await all(
      `SELECT ${bucketSql(interval)} AS bucket, ${agg} AS count FROM analytics_events e ${math === 'unique' ? personJoins(false) : ''}
       WHERE e.project_id = ? AND e.event = ? AND e.ts >= ? AND e.ts <= ? GROUP BY 1`,
      [off, project.id, event, rawFrom, range.to],
    )) as Array<{ bucket: string; count: number }>;
    rows.push(...raw);
  }
  return alignSeries(rows, buckets);
}

function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
}

async function trendOnce(project: ProjectRow, q: TrendsQuery, range: { from: number; to: number }, now: number) {
  const off = offMs(project);
  const tz = Number(project.tz_offset_min);
  const buckets = bucketList(range.from, range.to, q.interval, tz);
  const cohort = await cohortFrag(project, q.cohortId, now);
  let usedRollup = false;
  const out: Array<{ label: string; breakdownValue: string | null; data: number[]; total: number }> = [];
  for (const s of q.series) {
    const filters = [...q.filters, ...s.filters];
    const label = seriesLabel(s.event, s.math, s.label);
    if (!filters.length && !q.breakdown && !cohort) {
      const data = await trendFromRollup(project, s.event, s.math, q.interval, range, buckets);
      if (data) {
        usedRollup = true;
        out.push({ label, breakdownValue: null, data, total: data.reduce((a, b) => a + b, 0) });
        continue;
      }
    }
    const withPerson = needsPerson(filters) || q.breakdown?.type === 'person';
    const joins = s.math === 'unique' || withPerson || cohort ? personJoins(withPerson) : '';
    const where = whereFor(project, range, s.event, filters, cohort);
    const agg = s.math === 'unique' ? `COUNT(DISTINCT ${PERSON_KEY})` : 'COUNT(*)';
    if (q.breakdown) {
      const value = propText(q.breakdown.key, q.breakdown.type);
      const rows = (await all(
        `SELECT ${bucketSql(q.interval)} AS bucket, ${value.sql} AS value, ${agg} AS count FROM analytics_events e ${joins}
         WHERE ${where.sql} GROUP BY 1, 2`,
        [off, ...value.args, ...where.args],
      )) as Array<{ bucket: string; value: string | null; count: number }>;
      for (const b of breakdownSeries(rows, buckets, 10, s.math === 'total')) {
        out.push({ label, breakdownValue: b.value, data: b.data, total: b.total });
      }
    } else {
      const rows = (await all(`SELECT ${bucketSql(q.interval)} AS bucket, ${agg} AS count FROM analytics_events e ${joins} WHERE ${where.sql} GROUP BY 1`, [
        off,
        ...where.args,
      ])) as Array<{ bucket: string; count: number }>;
      const data = alignSeries(rows, buckets);
      let total = data.reduce((a, b) => a + b, 0);
      if (s.math === 'unique') {
        // Únicos del rango entero (no la suma de cada cubeta).
        const t = (await getDb()
          .prepare(`SELECT COUNT(DISTINCT ${PERSON_KEY}) AS n FROM analytics_events e ${joins} WHERE ${where.sql}`)
          .get(...where.args)) as { n: number } | undefined;
        total = Number(t?.n ?? 0);
      }
      out.push({ label, breakdownValue: null, data, total });
    }
  }
  return { buckets, series: out, usedRollup };
}

export async function runTrends(project: ProjectRow, q: TrendsQuery, now = Date.now()): Promise<TrendsResult> {
  const range = resolveRange(q.dateRange, now, Number(project.tz_offset_min));
  const cur = await trendOnce(project, q, range, now);
  const series = cur.series.map((s) => ({ ...s }) as TrendsResult['series'][number]);
  if (q.compare) {
    const prev = await trendOnce(project, q, previousRange(range), now);
    for (const s of series) {
      const match = prev.series.find((p) => p.label === s.label && p.breakdownValue === s.breakdownValue);
      const data = match?.data ?? [];
      s.compare = s.data.map((_, i) => data[i] ?? 0);
      s.compareTotal = match?.total ?? 0;
    }
  }
  return { kind: 'trends', buckets: cur.buckets, series, usedRollup: cur.usedRollup };
}

// ---------- Embudos ----------

export async function runFunnel(project: ProjectRow, q: FunnelQuery, now = Date.now()): Promise<FunnelResult> {
  const range = resolveRange(q.dateRange, now, Number(project.tz_offset_min));
  const windowMs = q.windowDays * DAY;
  const cohort = await cohortFrag(project, q.cohortId, now);
  const withPerson = needsPerson(q.filters) || q.steps.some((s) => needsPerson(s.filters));
  const flags: Frag[] = q.steps.map((s) => {
    const f = filtersSql(s.filters);
    const parts = [s.event === '*' ? '1' : 'e.event = ?', f.sql].filter(Boolean);
    return { sql: `(${parts.join(' AND ')})`, args: [...(s.event === '*' ? [] : [s.event]), ...f.args] };
  });
  const events = [...new Set(q.steps.map((s) => s.event))];
  const anyEvent = events.includes('*');
  const where = whereFor(project, { from: range.from, to: range.to + windowMs }, null, q.filters, cohort);
  const rows = (await all(
    `SELECT ${PERSON_KEY} AS person, e.ts AS ts, ${flags.map((f, i) => `${f.sql} AS s${i}`).join(', ')}
     FROM analytics_events e ${personJoins(withPerson)}
     WHERE ${where.sql}${anyEvent ? '' : ` AND e.event IN (${events.map(() => '?').join(',')})`}
     ORDER BY person, e.ts LIMIT ?`,
    [...flags.flatMap((f) => f.args), ...where.args, ...(anyEvent ? [] : events), ROW_CAP + 1],
  )) as Row[];
  const truncated = rows.length > ROW_CAP;
  const list: FunnelRow[] = rows.slice(0, ROW_CAP).map((r) => ({
    person: String(r.person),
    ts: Number(r.ts),
    steps: q.steps.map((_, i) => i).filter((i) => Number(r[`s${i}`]) === 1),
  }));
  const c = computeFunnel(list, q.steps.length, windowMs, range);
  const first = c.counts[0] || 0;
  return {
    kind: 'funnel',
    steps: q.steps.map((s, i) => ({
      label: s.label || s.event,
      event: s.event,
      count: c.counts[i],
      conversion: first ? c.counts[i] / first : 0,
      stepConversion: i === 0 ? 1 : c.counts[i - 1] ? c.counts[i] / c.counts[i - 1] : 0,
      dropped: i + 1 < q.steps.length ? c.counts[i] - c.counts[i + 1] : 0,
      medianMs: c.medians[i],
    })),
    droppedPersons: c.dropped,
    truncated,
  };
}

// ---------- Retención ----------

export async function runRetention(project: ProjectRow, q: RetentionQuery, now = Date.now()): Promise<RetentionResult> {
  const tz = Number(project.tz_offset_min);
  const off = offMs(project);
  const lastPeriod = periodOf(now, q.period, tz);
  const firstPeriod = lastPeriod - q.periods + 1;
  const firstDay = q.period === 'day' ? firstPeriod : firstPeriod * 7 - 3;
  const from = firstDay * DAY - off;
  const cohort = await cohortFrag(project, q.cohortId, now);
  const withPerson = needsPerson(q.filters);
  // CAST: Turso manda los números como REAL y la división tiene que ser entera.
  const periodSql = q.period === 'day' ? '((e.ts + CAST(? AS INTEGER)) / 86400000)' : '((((e.ts + CAST(? AS INTEGER)) / 86400000) + 3) / 7)';
  const fetch = async (event: string) => {
    const where = whereFor(project, { from, to: now }, event, q.filters, cohort);
    return (await all(
      `SELECT DISTINCT ${PERSON_KEY} AS person, ${periodSql} AS period FROM analytics_events e ${personJoins(withPerson)} WHERE ${where.sql} LIMIT ?`,
      [off, ...where.args, ROW_CAP + 1],
    )) as Array<{ person: string; period: number }>;
  };
  const [starts, returns] = await Promise.all([fetch(q.startEvent), q.returnEvent === q.startEvent ? null : fetch(q.returnEvent)]);
  const ret = returns ?? starts;
  const truncated = starts.length > ROW_CAP || ret.length > ROW_CAP;
  const cohorts = computeRetention(
    starts.map((r) => ({ person: String(r.person), period: Number(r.period) })),
    ret.map((r) => ({ person: String(r.person), period: Number(r.period) })),
    firstPeriod,
    q.periods,
  );
  return {
    kind: 'retention',
    period: q.period,
    cohorts: cohorts.map((c) => ({ start: periodLabel(c.period, q.period), size: c.size, values: c.values })),
    truncated,
  };
}

// ---------- Caminos ----------

export async function runPaths(project: ProjectRow, q: PathsQuery, now = Date.now()): Promise<PathsResult> {
  const range = resolveRange(q.dateRange, now, Number(project.tz_offset_min));
  const rows = (await all(
    `SELECT e.session_id AS session, e.pathname AS path, e.ts AS ts FROM analytics_events e
     WHERE e.project_id = ? AND e.event = '$pageview' AND e.ts >= ? AND e.ts <= ? AND e.session_id IS NOT NULL AND e.pathname IS NOT NULL
     ORDER BY e.ts LIMIT ?`,
    [project.id, range.from, range.to, ROW_CAP + 1],
  )) as Array<{ session: string; path: string; ts: number }>;
  const truncated = rows.length > ROW_CAP;
  const r = computePaths(rows.slice(0, ROW_CAP).map((x) => ({ session: String(x.session), path: String(x.path), ts: Number(x.ts) })), q.steps, q.startPath || null);
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

export async function runSql(project: ProjectRow, sql: string): Promise<SqlResult> {
  const check = checkSql(sql, await realTables());
  if (!check.ok) throw new QueryError(check.error, check.detail);
  const wrapped = wrapSql(check.sql, project.id);
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
  }
}

// ---------- Web ----------

type Top = Array<{ key: string; visitors: number; views: number }>;

export async function runWeb(project: ProjectRow, q: WebQuery, now = Date.now()): Promise<WebResult> {
  const tz = Number(project.tz_offset_min);
  const off = offMs(project);
  const range = resolveRange(q.dateRange, now, tz);
  const prev = previousRange(range);
  const interval = range.to - range.from <= 2 * DAY ? 'hour' : 'day';
  const buckets = bucketList(range.from, range.to, interval, tz);
  const pv = `e.project_id = ? AND e.event = '$pageview' AND e.ts >= ? AND e.ts <= ?`;
  const join = personJoins(false);

  const stats = async (r: { from: number; to: number }) => {
    const [a, s] = await Promise.all([
      getDb()
        .prepare(`SELECT COUNT(DISTINCT ${PERSON_KEY}) AS visitors, COUNT(*) AS pageviews FROM analytics_events e ${join} WHERE ${pv}`)
        .get(project.id, r.from, r.to) as Promise<{ visitors: number; pageviews: number } | undefined>,
      getDb()
        .prepare(
          `SELECT COUNT(*) AS sessions, SUM(CASE WHEN pageviews <= 1 THEN 1 ELSE 0 END) AS bounces, AVG(ended_at - started_at) AS dur
           FROM analytics_sessions WHERE project_id = ? AND started_at >= ? AND started_at <= ? AND pageviews > 0`,
        )
        .get(project.id, r.from, r.to) as Promise<{ sessions: number; bounces: number | null; dur: number | null } | undefined>,
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
      [project.id, range.from, range.to],
    ).then((rows) => rows.map((r) => ({ key: String(r.key), visitors: Number(r.visitors), views: Number(r.views) })));

  const [cur, before, chart, pages, entries, referrers, utmSources, countries, devices, browsers, os] = await Promise.all([
    stats(range),
    q.compare ? stats(prev) : Promise.resolve(null),
    all(
      `SELECT ${bucketSql(interval)} AS bucket, COUNT(DISTINCT ${PERSON_KEY}) AS visitors, COUNT(*) AS views FROM analytics_events e ${join}
       WHERE ${pv} GROUP BY 1`,
      [off, project.id, range.from, range.to],
    ),
    top('e.pathname'),
    all(
      `SELECT COALESCE(entry_path, '(none)') AS key, COUNT(DISTINCT distinct_id) AS visitors, COUNT(*) AS views FROM analytics_sessions
       WHERE project_id = ? AND started_at >= ? AND started_at <= ? AND pageviews > 0 GROUP BY 1 ORDER BY visitors DESC LIMIT 10`,
      [project.id, range.from, range.to],
    ).then((rows) => rows.map((r) => ({ key: String(r.key), visitors: Number(r.visitors), views: Number(r.views) }))),
    top('e.referring_domain'),
    top('e.utm_source'),
    top('e.country'),
    top('e.device'),
    top('e.browser'),
    top('e.os'),
  ]);
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

/**
 * CRM Dashboards — cálculo de los reportes de la biblioteca
 * (lib/crm-dashboard-library.ts) y su drill-down. Server-only.
 *
 * Privacidad: cada consulta agrega en SQL solo los registros que quien mira
 * ve (scope de lib/crm-visibility.ts: deals y contactos por owner, las
 * actividades con activityScopeSql) y además el filtro de owner/equipo del
 * dashboard. Los reportes de la biblioteca usan solo campos nativos (monto,
 * etapa, owner, fechas, fuente, ciclo de vida); los campos propios, que son
 * los que se pueden ocultar (lib/crm-field-perms.ts), no entran en ningún
 * total, agrupación ni filtro. Un dashboard compartido corre con la persona
 * que lo mira, nunca con quien lo creó.
 */
import { getDb, type Db } from './db';
import { baseAmountSql } from './crm-currency';
import { privateChatMarker } from './crm-chat-privacy';
import { FORECAST_DEFAULTS } from './crm-forecast';
import { funnelConversion } from './crm-reports';
import { activityScopeSql, ownerScopeSql, type OwnerScope } from './crm-visibility';
import {
  bucketBounds,
  bucketKeys,
  libraryReport,
  resolveRange,
  type DrillResult,
  type DrillRow,
  type DrillSegment,
  type ResolvedRange,
  type TileResult,
  type TileSeries,
  type Bucket,
} from './crm-dashboard-library';

export interface ReportContext {
  workspaceId: string;
  /** Visibilidad de quien mira (null/undefined = ve todo). */
  scope: OwnerScope | undefined;
  /** Filtro de owner/equipo del dashboard (null = todos). */
  ownerIds: string[] | null;
  pipelineId: string | null;
  /** Pipeline que usan los reportes por etapa cuando no hay filtro. */
  defaultPipelineId: string | null;
  range: ResolvedRange;
  /** Nombres de las personas del workspace. */
  people: Map<string, string>;
  locale: string;
  now?: Date;
  db?: Db;
}

type Args = Array<string | number>;
interface Cond {
  sql: string;
  args: Args;
}

const AMT = baseAmountSql('d');
const DRILL_LIMIT = 200;

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Columna de fecha entre dos días (incluidos), comparando texto (usa índices). */
function between(col: string, from: string, to: string): Cond {
  return { sql: ` AND ${col} >= ? AND ${col} < ?`, args: [from, nextDay(to)] };
}

function join(...conds: Cond[]): Cond {
  return { sql: conds.map((c) => c.sql).join(''), args: conds.flatMap((c) => c.args) };
}

function ownerList(alias: string, ids: string[] | null): Cond {
  if (!ids) return { sql: '', args: [] };
  if (!ids.length) return { sql: ' AND 0', args: [] };
  return { sql: ` AND COALESCE(${alias}.owner_id, ${alias}.user_id) IN (${ids.map(() => '?').join(',')})`, args: [...ids] };
}

function scoped(alias: string, scope: OwnerScope | undefined): Cond {
  const c = ownerScopeSql(alias, scope);
  return c.sql ? { sql: ` AND ${c.sql}`, args: c.args } : { sql: '', args: [] };
}

/** Deals del workspace que la persona ve, con el filtro de owner y (si aplica) el de pipeline. */
function dealBase(ctx: ReportContext, pipeline: boolean): Cond {
  return join(
    { sql: 'd.user_id = ?', args: [ctx.workspaceId] },
    scoped('d', ctx.scope),
    ownerList('d', ctx.ownerIds),
    pipeline && ctx.pipelineId ? { sql: ' AND d.pipeline_id = ?', args: [ctx.pipelineId] } : { sql: '', args: [] },
  );
}

function contactBase(ctx: ReportContext): Cond {
  return join({ sql: 'c.user_id = ?', args: [ctx.workspaceId] }, scoped('c', ctx.scope), ownerList('c', ctx.ownerIds));
}

function activityBase(ctx: ReportContext): Cond {
  const vis = activityScopeSql('a', ctx.scope);
  return join(
    { sql: 'a.user_id = ?', args: [ctx.workspaceId] },
    vis.sql ? { sql: ` AND ${vis.sql}`, args: vis.args } : { sql: '', args: [] },
    ownerList('a', ctx.ownerIds),
  );
}

/** Actividades que cuentan como trabajo de ventas: llamadas, emails y reuniones registradas, y tareas completadas en el rango. */
function activityWork(from: string, to: string): Cond {
  return {
    sql: ` AND ((a.type IN ('call', 'email', 'meeting') AND a.created_at >= ? AND a.created_at < ?)
      OR (a.type = 'task' AND a.done = 1 AND COALESCE(a.done_at, a.created_at) >= ? AND COALESCE(a.done_at, a.created_at) < ?))`,
    args: [from, nextDay(to), from, nextDay(to)],
  };
}

function bucketSql(col: string, bucket: Bucket): string {
  if (bucket === 'day') return `strftime('%Y-%m-%d', ${col})`;
  if (bucket === 'week') return `strftime('%Y-W%W', ${col})`;
  if (bucket === 'month') return `strftime('%Y-%m', ${col})`;
  return `(strftime('%Y', ${col}) || '-Q' || ((CAST(strftime('%m', ${col}) AS INTEGER) + 2) / 3))`;
}

const FORECAST_CATEGORY_SQL = `(CASE WHEN s.is_won = 1 THEN 'closed_won'
  WHEN d.forecast_category != '' THEN d.forecast_category
  WHEN s.probability >= ${FORECAST_DEFAULTS.commit} THEN 'commit'
  WHEN s.probability >= ${FORECAST_DEFAULTS.best_case} THEN 'best_case' ELSE 'pipeline' END)`;
const FORECAST_ORDER = ['closed_won', 'commit', 'best_case', 'pipeline'];

const ACTIVITY_SERIES = ['call', 'email', 'meeting', 'task'];

async function one<T>(db: Db, sql: string, args: Args): Promise<T> {
  return (await db.prepare(sql).get(...args)) as T;
}

async function all<T>(db: Db, sql: string, args: Args): Promise<T[]> {
  return (await db.prepare(sql).all(...args)) as T[];
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** El rango que usa el reporte: el del dashboard, o el mes en curso. */
export function reportRange(key: string, ctx: Pick<ReportContext, 'range' | 'now'>): ResolvedRange {
  const def = libraryReport(key);
  if (def?.rangeMode === 'this_month') return resolveRange({ range: 'this_month' }, ctx.now ?? new Date());
  return ctx.range;
}

function stagePipeline(ctx: ReportContext): string | null {
  return ctx.pipelineId ?? ctx.defaultPipelineId;
}

// ============================================================
// CÁLCULO
// ============================================================

async function wonAmount(db: Db, ctx: ReportContext, from: string, to: string): Promise<{ s: number; c: number }> {
  const w = join(dealBase(ctx, true), between('d.closed_at', from, to));
  const r = await one<{ s: number; c: number }>(
    db,
    `SELECT COALESCE(SUM(${AMT}), 0) AS s, COUNT(*) AS c FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
     WHERE ${w.sql} AND s.is_won = 1`,
    w.args,
  );
  return { s: num(r.s), c: num(r.c) };
}

async function wonLost(db: Db, ctx: ReportContext, from: string, to: string) {
  const w = join(dealBase(ctx, true), between('d.closed_at', from, to));
  const r = await one<{ won: number; lost: number; wonAmt: number; cycle: number | null }>(
    db,
    `SELECT COALESCE(SUM(s.is_won = 1), 0) AS won, COALESCE(SUM(s.is_lost = 1), 0) AS lost,
       COALESCE(SUM(CASE WHEN s.is_won = 1 THEN ${AMT} END), 0) AS wonAmt,
       AVG(CASE WHEN s.is_won = 1 THEN MAX(julianday(d.closed_at) - julianday(d.created_at), 1) END) AS cycle
     FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE ${w.sql}`,
    w.args,
  );
  return { won: num(r.won), lost: num(r.lost), wonAmt: num(r.wonAmt), cycle: r.cycle === null ? null : num(r.cycle) };
}

async function countCreated(db: Db, table: 'deals' | 'contacts', ctx: ReportContext, from: string, to: string): Promise<number> {
  if (table === 'deals') {
    const w = join(dealBase(ctx, true), between('d.created_at', from, to));
    return num((await one<{ c: number }>(db, `SELECT COUNT(*) AS c FROM crm_deals d WHERE ${w.sql}`, w.args)).c);
  }
  const w = join(contactBase(ctx), between('c.created_at', from, to));
  return num((await one<{ c: number }>(db, `SELECT COUNT(*) AS c FROM crm_contacts c WHERE ${w.sql}`, w.args)).c);
}

async function countActivities(db: Db, ctx: ReportContext, from: string, to: string): Promise<number> {
  const w = join(activityBase(ctx), activityWork(from, to));
  return num((await one<{ c: number }>(db, `SELECT COUNT(*) AS c FROM crm_activities a WHERE ${w.sql}`, w.args)).c);
}

function timeChart(
  keys: string[],
  rows: Array<{ b: string; v: number; k?: string }>,
  seriesKeys: string[] | null,
  format: 'number' | 'money',
): TileResult {
  const series: TileSeries[] = (seriesKeys ?? ['value']).map((sk) => ({
    key: sk,
    label: null,
    values: keys.map((k) => num(rows.find((r) => r.b === k && (seriesKeys ? r.k === sk : true))?.v)),
  }));
  const total = series.reduce((acc, s) => acc + s.values.reduce((a, b) => a + b, 0), 0);
  return {
    kind: 'chart',
    format,
    categories: keys.map((k) => ({ key: k, label: null })),
    categoryKind: 'bucket',
    series,
    seriesKind: seriesKeys ? 'outcome' : null,
    total: round2(total),
    drill: true,
  };
}

function personLabel(ctx: ReportContext, id: string): string | null {
  return ctx.people.get(id) ?? null;
}

/** Calcula un reporte de la biblioteca para quien mira. */
export async function computeLibraryReport(key: string, ctx: ReportContext): Promise<TileResult> {
  const db = ctx.db ?? getDb();
  const range = reportRange(key, ctx);
  const { from, to, prevFrom, prevTo } = range;

  switch (key) {
    case 'revenue_won_kpi': {
      const now = await wonAmount(db, ctx, from, to);
      const prev = await wonAmount(db, ctx, prevFrom, prevTo);
      return { kind: 'kpi', value: round2(now.s), prev: round2(prev.s), format: 'money', detail: { count: now.c }, drill: true };
    }
    case 'deals_created_kpi': {
      return {
        kind: 'kpi',
        value: await countCreated(db, 'deals', ctx, from, to),
        prev: await countCreated(db, 'deals', ctx, prevFrom, prevTo),
        format: 'number',
        drill: true,
      };
    }
    case 'new_contacts_kpi': {
      return {
        kind: 'kpi',
        value: await countCreated(db, 'contacts', ctx, from, to),
        prev: await countCreated(db, 'contacts', ctx, prevFrom, prevTo),
        format: 'number',
        drill: true,
      };
    }
    case 'activities_kpi': {
      return {
        kind: 'kpi',
        value: await countActivities(db, ctx, from, to),
        prev: await countActivities(db, ctx, prevFrom, prevTo),
        format: 'number',
        drill: true,
      };
    }
    case 'win_rate_kpi': {
      const now = await wonLost(db, ctx, from, to);
      const prev = await wonLost(db, ctx, prevFrom, prevTo);
      const rate = (x: { won: number; lost: number }) => (x.won + x.lost > 0 ? round2((x.won / (x.won + x.lost)) * 100) : 0);
      return {
        kind: 'kpi',
        value: rate(now),
        prev: prev.won + prev.lost > 0 ? rate(prev) : null,
        format: 'percent',
        detail: { won: now.won, closed: now.won + now.lost },
        drill: true,
      };
    }
    case 'avg_deal_size_kpi': {
      const now = await wonLost(db, ctx, from, to);
      const prev = await wonLost(db, ctx, prevFrom, prevTo);
      return {
        kind: 'kpi',
        value: now.won ? round2(now.wonAmt / now.won) : 0,
        prev: prev.won ? round2(prev.wonAmt / prev.won) : null,
        format: 'money',
        detail: { count: now.won },
        drill: true,
      };
    }
    case 'sales_velocity': {
      // (deals abiertos × tasa de cierre × ticket promedio) / ciclo promedio en días.
      const velocity = async (f: string, t: string) => {
        const wl = await wonLost(db, ctx, f, t);
        const base = dealBase(ctx, true);
        const open = num(
          (
            await one<{ c: number }>(
              db,
              `SELECT COUNT(*) AS c FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
               WHERE ${base.sql} AND d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0`,
              base.args,
            )
          ).c,
        );
        if (!wl.won || !wl.cycle) return { v: 0, ok: wl.won + wl.lost > 0, open };
        const winRate = wl.won / (wl.won + wl.lost);
        return { v: round2((open * winRate * (wl.wonAmt / wl.won)) / wl.cycle), ok: true, open };
      };
      const now = await velocity(from, to);
      const prev = await velocity(prevFrom, prevTo);
      return { kind: 'kpi', value: now.v, prev: prev.ok ? prev.v : null, format: 'moneyPerDay', detail: { count: now.open }, drill: true };
    }
    case 'deals_created': {
      const w = join(dealBase(ctx, true), between('d.created_at', from, to));
      const rows = await all<{ b: string; v: number }>(
        db,
        `SELECT ${bucketSql('d.created_at', range.bucket)} AS b, COUNT(*) AS v FROM crm_deals d WHERE ${w.sql} GROUP BY b`,
        w.args,
      );
      return timeChart(bucketKeys(range), rows, null, 'number');
    }
    case 'revenue_won_over_time': {
      const w = join(dealBase(ctx, true), between('d.closed_at', from, to));
      const rows = await all<{ b: string; v: number }>(
        db,
        `SELECT ${bucketSql('d.closed_at', range.bucket)} AS b, COALESCE(SUM(${AMT}), 0) AS v
         FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE ${w.sql} AND s.is_won = 1 GROUP BY b`,
        w.args,
      );
      return timeChart(bucketKeys(range), rows, null, 'money');
    }
    case 'won_lost_over_time': {
      const w = join(dealBase(ctx, true), between('d.closed_at', from, to));
      const rows = await all<{ b: string; k: string; v: number }>(
        db,
        `SELECT ${bucketSql('d.closed_at', range.bucket)} AS b, CASE WHEN s.is_won = 1 THEN 'won' ELSE 'lost' END AS k, COUNT(*) AS v
         FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE ${w.sql} AND (s.is_won = 1 OR s.is_lost = 1) GROUP BY b, k`,
        w.args,
      );
      return timeChart(bucketKeys(range), rows, ['won', 'lost'], 'number');
    }
    case 'deals_won_lost_by_owner': {
      const w = join(dealBase(ctx, true), between('d.closed_at', from, to));
      const rows = await all<{ o: string; won: number; lost: number }>(
        db,
        `SELECT COALESCE(d.owner_id, d.user_id) AS o, COALESCE(SUM(s.is_won = 1), 0) AS won, COALESCE(SUM(s.is_lost = 1), 0) AS lost
         FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id WHERE ${w.sql} AND (s.is_won = 1 OR s.is_lost = 1)
         GROUP BY o ORDER BY won DESC, lost DESC LIMIT 20`,
        w.args,
      );
      return {
        kind: 'chart',
        format: 'number',
        categories: rows.map((r) => ({ key: r.o, label: personLabel(ctx, r.o) })),
        categoryKind: null,
        series: [
          { key: 'won', label: null, values: rows.map((r) => num(r.won)) },
          { key: 'lost', label: null, values: rows.map((r) => num(r.lost)) },
        ],
        seriesKind: 'outcome',
        total: rows.reduce((a, r) => a + num(r.won) + num(r.lost), 0),
        drill: true,
      };
    }
    case 'pipeline_by_stage': {
      const pid = stagePipeline(ctx);
      if (!pid) return emptyChart('money');
      const w = join(dealBase(ctx, false), { sql: ' AND d.pipeline_id = ? AND d.closed_at IS NULL', args: [pid] });
      const rows = await all<{ id: string; name: string; c: number; a: number }>(
        db,
        `SELECT s.id, s.name, COUNT(d.id) AS c, COALESCE(SUM(${AMT}), 0) AS a
         FROM crm_stages s LEFT JOIN crm_deals d ON d.stage_id = s.id AND ${w.sql}
         WHERE s.pipeline_id = ? AND s.is_won = 0 AND s.is_lost = 0
         GROUP BY s.id ORDER BY s.position`,
        [...w.args, pid],
      );
      return {
        kind: 'chart',
        format: 'money',
        categories: rows.map((r) => ({ key: r.id, label: r.name })),
        categoryKind: null,
        series: [{ key: 'amount', label: null, values: rows.map((r) => round2(num(r.a))) }],
        seriesKind: null,
        extra: { label: 'count', values: rows.map((r) => num(r.c)) },
        total: round2(rows.reduce((a, r) => a + num(r.a), 0)),
        drill: true,
      };
    }
    case 'conversion_funnel': {
      const pid = stagePipeline(ctx);
      if (!pid) return emptyChart('number');
      const w = join(dealBase(ctx, false), { sql: ' AND d.pipeline_id = ?', args: [pid] }, between('d.created_at', from, to));
      const rows = await all<{ id: string; name: string; is_won: number; is_lost: number; count: number }>(
        db,
        `SELECT s.id, s.name, s.is_won, s.is_lost, COUNT(d.id) AS count
         FROM crm_stages s LEFT JOIN crm_deals d ON d.stage_id = s.id AND ${w.sql}
         WHERE s.pipeline_id = ? GROUP BY s.id ORDER BY s.position`,
        [...w.args, pid],
      );
      const conv = funnelConversion(rows.map((r) => ({ ...r, count: num(r.count) })));
      // Cuántos llegaron a cada etapa: los que están ahí o más adelante (los ganados pasaron por todas).
      const flow = conv.filter((r) => !r.is_lost);
      const reached: number[] = [];
      let tail = flow.filter((r) => r.is_won).reduce((a, r) => a + r.count, 0);
      for (let i = flow.length - 1; i >= 0; i--) {
        if (!flow[i].is_won) tail += flow[i].count;
        reached[i] = flow[i].is_won ? flow[i].count : tail;
      }
      return {
        kind: 'chart',
        format: 'number',
        categories: flow.map((r) => ({ key: r.id, label: r.name })),
        categoryKind: null,
        series: [{ key: 'reached', label: null, values: reached }],
        seriesKind: null,
        extra: { label: 'conversion', values: flow.map((r) => r.conversionRate) },
        total: reached[0] ?? 0,
        drill: true,
      };
    }
    case 'avg_time_in_stage': {
      const pid = stagePipeline(ctx);
      if (!pid) return emptyChart('days');
      const rows = await all<{ id: string; name: string; days: number | null; c: number }>(
        db,
        `SELECT s.id, s.name, AVG(MAX(julianday(COALESCE(h.exited_at, ?)) - julianday(h.entered_at), 0)) AS days, COUNT(h.id) AS c
         FROM crm_stages s
         LEFT JOIN crm_deal_stage_history h ON h.stage_id = s.id AND h.user_id = ?
           AND h.deal_id IN (SELECT d.id FROM crm_deals d WHERE ${dealBase(ctx, false).sql})
           ${between('h.entered_at', from, to).sql}
         WHERE s.pipeline_id = ? AND s.is_won = 0 AND s.is_lost = 0
         GROUP BY s.id ORDER BY s.position`,
        [(ctx.now ?? new Date()).toISOString().slice(0, 19).replace('T', ' '), ctx.workspaceId, ...dealBase(ctx, false).args, ...between('h.entered_at', from, to).args, pid],
      );
      return {
        kind: 'chart',
        format: 'days',
        categories: rows.map((r) => ({ key: r.id, label: r.name })),
        categoryKind: null,
        series: [{ key: 'days', label: null, values: rows.map((r) => round2(num(r.days))) }],
        seriesKind: null,
        extra: { label: 'count', values: rows.map((r) => num(r.c)) },
        total: null,
        drill: true,
      };
    }
    case 'deal_forecast': {
      const w = join(dealBase(ctx, true), between('d.close_date', from, to));
      const rows = await all<{ k: string; a: number; c: number }>(
        db,
        `SELECT ${FORECAST_CATEGORY_SQL} AS k, COALESCE(SUM(${AMT}), 0) AS a, COUNT(*) AS c
         FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
         WHERE ${w.sql} AND s.is_lost = 0 AND (d.forecast_category IS NULL OR d.forecast_category != 'omit')
         GROUP BY k`,
        w.args,
      );
      const keys = FORECAST_ORDER;
      return {
        kind: 'chart',
        format: 'money',
        categories: keys.map((k) => ({ key: k, label: null })),
        categoryKind: 'forecastCategory',
        series: [{ key: 'amount', label: null, values: keys.map((k) => round2(num(rows.find((r) => r.k === k)?.a))) }],
        seriesKind: null,
        extra: { label: 'count', values: keys.map((k) => num(rows.find((r) => r.k === k)?.c)) },
        total: round2(rows.filter((r) => keys.includes(r.k)).reduce((a, r) => a + num(r.a), 0)),
        drill: true,
      };
    }
    case 'activities_by_rep': {
      const w = join(activityBase(ctx), activityWork(from, to));
      const rows = await all<{ o: string; t: string; v: number }>(
        db,
        `SELECT COALESCE(a.owner_id, a.user_id) AS o, a.type AS t, COUNT(*) AS v FROM crm_activities a WHERE ${w.sql} GROUP BY o, t`,
        w.args,
      );
      const owners = [...new Set(rows.map((r) => r.o))];
      const totals = new Map(owners.map((o) => [o, rows.filter((r) => r.o === o).reduce((a, r) => a + num(r.v), 0)]));
      owners.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
      const top = owners.slice(0, 20);
      return {
        kind: 'chart',
        format: 'number',
        categories: top.map((o) => ({ key: o, label: personLabel(ctx, o) })),
        categoryKind: null,
        series: ACTIVITY_SERIES.map((t) => ({
          key: t,
          label: null,
          values: top.map((o) => num(rows.find((r) => r.o === o && r.t === t)?.v)),
        })),
        seriesKind: 'activityType',
        total: rows.filter((r) => top.includes(r.o)).reduce((a, r) => a + num(r.v), 0),
        drill: true,
      };
    }
    case 'new_contacts_by_source': {
      const w = join(contactBase(ctx), between('c.created_at', from, to));
      const rows = await all<{ k: string; v: number }>(
        db,
        `SELECT COALESCE(NULLIF(c.source, ''), 'other') AS k, COUNT(*) AS v FROM crm_contacts c WHERE ${w.sql} GROUP BY k ORDER BY v DESC`,
        w.args,
      );
      return {
        kind: 'chart',
        format: 'number',
        categories: rows.map((r) => ({ key: r.k, label: null })),
        categoryKind: 'source',
        series: [{ key: 'count', label: null, values: rows.map((r) => num(r.v)) }],
        seriesKind: null,
        total: rows.reduce((a, r) => a + num(r.v), 0),
        drill: true,
      };
    }
    case 'lifecycle_stage_changes': {
      const w = join(contactBase(ctx), between('e.created_at', from, to));
      const rows = await all<{ k: string; v: number }>(
        db,
        `SELECT e.new_value AS k, COUNT(DISTINCT e.entity_id) AS v
         FROM crm_property_events e JOIN crm_contacts c ON c.id = e.entity_id AND c.user_id = e.user_id
         WHERE ${w.sql} AND e.entity = 'contact' AND e.field = 'lifecycle_stage' AND e.new_value != ''
         GROUP BY k ORDER BY v DESC`,
        w.args,
      );
      return {
        kind: 'chart',
        format: 'number',
        categories: rows.map((r) => ({ key: r.k, label: null })),
        categoryKind: 'lifecycle',
        series: [{ key: 'count', label: null, values: rows.map((r) => num(r.v)) }],
        seriesKind: null,
        // Un contacto que pasó por dos etapas cuenta en las dos: no hay un total que sume.
        total: null,
        drill: true,
      };
    }
    case 'deals_closing_this_month': {
      const d = await drillLibraryReport(key, ctx, {});
      return { kind: 'records', object: 'deal', rows: d.rows.slice(0, 50), total: d.total, sum: d.sum };
    }
    case 'upcoming_tasks': {
      const d = await drillLibraryReport(key, ctx, {});
      return { kind: 'records', object: 'activity', rows: d.rows.slice(0, 50), total: d.total, sum: null };
    }
    default:
      throw new Error('unknown_report');
  }
}

function emptyChart(format: 'number' | 'money' | 'days'): TileResult {
  return { kind: 'chart', format, categories: [], categoryKind: null, series: [], seriesKind: null, total: null, drill: false };
}

// ============================================================
// DRILL-DOWN
// ============================================================

async function dealRows(db: Db, ctx: ReportContext, w: Cond, dateCol: string, order = `${AMT} DESC`): Promise<DrillResult> {
  const from = `FROM crm_deals d LEFT JOIN crm_stages s ON s.id = d.stage_id WHERE ${w.sql}`;
  const agg = await one<{ n: number; s: number }>(db, `SELECT COUNT(*) AS n, COALESCE(SUM(${AMT}), 0) AS s ${from}`, w.args);
  const rows = await all<{ id: string; name: string; a: number; st: string | null; o: string; dt: string | null }>(
    db,
    `SELECT d.id, d.name, ${AMT} AS a, s.name AS st, COALESCE(d.owner_id, d.user_id) AS o, ${dateCol} AS dt ${from}
     ORDER BY ${order}, d.id LIMIT ${DRILL_LIMIT}`,
    w.args,
  );
  return {
    object: 'deal',
    total: num(agg.n),
    sum: round2(num(agg.s)),
    truncated: num(agg.n) > rows.length,
    rows: rows.map(
      (r): DrillRow => ({
        id: r.id,
        previewType: 'deal',
        previewId: r.id,
        href: `/app/crm/deals/${r.id}`,
        name: r.name,
        amount: round2(num(r.a)),
        status: r.st,
        statusKind: 'stage',
        owner: personLabel(ctx, r.o),
        date: r.dt,
      }),
    ),
  };
}

async function contactRows(db: Db, ctx: ReportContext, w: Cond, extraFrom = '', statusCol = 'c.lifecycle_stage', statusKind: DrillRow['statusKind'] = 'lifecycle'): Promise<DrillResult> {
  const from = `FROM crm_contacts c ${extraFrom} WHERE ${w.sql}`;
  const n = num((await one<{ n: number }>(db, `SELECT COUNT(DISTINCT c.id) AS n ${from}`, w.args)).n);
  const rows = await all<{ id: string; name: string; email: string; st: string; o: string; dt: string }>(
    db,
    `SELECT DISTINCT c.id, TRIM(c.first_name || ' ' || c.last_name) AS name, c.email, ${statusCol} AS st,
       COALESCE(c.owner_id, c.user_id) AS o, c.created_at AS dt ${from}
     ORDER BY c.created_at DESC, c.id LIMIT ${DRILL_LIMIT}`,
    w.args,
  );
  return {
    object: 'contact',
    total: n,
    sum: null,
    truncated: n > rows.length,
    rows: rows.map(
      (r): DrillRow => ({
        id: r.id,
        previewType: 'contact',
        previewId: r.id,
        href: `/app/crm/contacts/${r.id}`,
        name: r.name || r.email || '',
        amount: null,
        status: r.st || null,
        statusKind,
        owner: personLabel(ctx, r.o),
        date: r.dt,
      }),
    ),
  };
}

async function activityRows(db: Db, ctx: ReportContext, w: Cond, dateExpr: string, order: string): Promise<DrillResult> {
  const from = `FROM crm_activities a WHERE ${w.sql}`;
  const n = num((await one<{ n: number }>(db, `SELECT COUNT(*) AS n ${from}`, w.args)).n);
  // Una tarea de un chat de Lines sale con el marcador, no con su título (la ven personas que no ven el chat).
  const marker = privateChatMarker(ctx.locale).replace(/'/g, "''");
  const rows = await all<{ id: string; t: string; subj: string; o: string; dt: string | null; deal_id: string | null; contact_id: string | null; company_id: string | null }>(
    db,
    `SELECT a.id, a.type AS t,
       CASE WHEN EXISTS (SELECT 1 FROM groups_tasks zrt WHERE zrt.activity_id = a.id) THEN '${marker}' ELSE a.subject END AS subj,
       COALESCE(a.owner_id, a.user_id) AS o, ${dateExpr} AS dt, a.deal_id, a.contact_id, a.company_id ${from}
     ORDER BY ${order}, a.id LIMIT ${DRILL_LIMIT}`,
    w.args,
  );
  return {
    object: 'activity',
    total: n,
    sum: null,
    truncated: n > rows.length,
    rows: rows.map((r): DrillRow => {
      // activityScopeSql ya exige que quien mira vea todos los registros vinculados.
      const previewType = r.deal_id ? 'deal' : r.contact_id ? 'contact' : r.company_id ? 'company' : null;
      const previewId = r.deal_id ?? r.contact_id ?? r.company_id ?? null;
      return {
        id: r.id,
        previewType,
        previewId,
        href: r.t === 'task' ? `/app/crm/tasks/${r.id}` : null,
        name: r.subj || '',
        amount: null,
        status: r.t,
        statusKind: 'activityType',
        owner: personLabel(ctx, r.o),
        date: r.dt,
      };
    }),
  };
}

/** El período de una categoría de tiempo (o todo el rango si no vino). */
function bucketRange(segment: DrillSegment, range: ResolvedRange): { from: string; to: string } | null {
  if (!segment.category) return { from: range.from, to: range.to };
  return bucketBounds(segment.category, range);
}

const EMPTY = (object: DrillResult['object']): DrillResult => ({ object, rows: [], total: 0, sum: null, truncated: false });

/** Registros detrás de un número, barra o segmento de un reporte de la biblioteca. */
export async function drillLibraryReport(key: string, ctx: ReportContext, segment: DrillSegment): Promise<DrillResult> {
  const db = ctx.db ?? getDb();
  const range = reportRange(key, ctx);
  const { from, to } = range;
  const cat = segment.category ?? null;
  const ser = segment.series ?? null;

  switch (key) {
    case 'revenue_won_kpi':
    case 'avg_deal_size_kpi':
      return dealRows(
        db,
        ctx,
        join(dealBase(ctx, true), between('d.closed_at', from, to), { sql: ' AND s.is_won = 1', args: [] }),
        'd.closed_at',
      );
    case 'win_rate_kpi':
      return dealRows(
        db,
        ctx,
        join(dealBase(ctx, true), between('d.closed_at', from, to), { sql: ' AND (s.is_won = 1 OR s.is_lost = 1)', args: [] }),
        'd.closed_at',
      );
    case 'sales_velocity':
      return dealRows(
        db,
        ctx,
        join(dealBase(ctx, true), { sql: ' AND d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0', args: [] }),
        'd.close_date',
      );
    case 'deals_created_kpi':
    case 'deals_created': {
      const b = bucketRange(segment, range);
      if (!b) return EMPTY('deal');
      return dealRows(db, ctx, join(dealBase(ctx, true), between('d.created_at', b.from, b.to)), 'd.created_at', 'd.created_at DESC');
    }
    case 'revenue_won_over_time': {
      const b = bucketRange(segment, range);
      if (!b) return EMPTY('deal');
      return dealRows(db, ctx, join(dealBase(ctx, true), between('d.closed_at', b.from, b.to), { sql: ' AND s.is_won = 1', args: [] }), 'd.closed_at');
    }
    case 'won_lost_over_time': {
      const b = bucketRange(segment, range);
      if (!b) return EMPTY('deal');
      const outcome = ser === 'won' ? ' AND s.is_won = 1' : ser === 'lost' ? ' AND s.is_lost = 1' : ' AND (s.is_won = 1 OR s.is_lost = 1)';
      return dealRows(db, ctx, join(dealBase(ctx, true), between('d.closed_at', b.from, b.to), { sql: outcome, args: [] }), 'd.closed_at');
    }
    case 'deals_won_lost_by_owner': {
      const outcome = ser === 'won' ? ' AND s.is_won = 1' : ser === 'lost' ? ' AND s.is_lost = 1' : ' AND (s.is_won = 1 OR s.is_lost = 1)';
      const owner = cat ? ownerList('d', [cat]) : { sql: '', args: [] };
      return dealRows(db, ctx, join(dealBase(ctx, true), between('d.closed_at', from, to), owner, { sql: outcome, args: [] }), 'd.closed_at');
    }
    case 'pipeline_by_stage': {
      const pid = stagePipeline(ctx);
      if (!pid) return EMPTY('deal');
      const stage = cat ? { sql: ' AND d.stage_id = ?', args: [cat] } : { sql: '', args: [] };
      return dealRows(
        db,
        ctx,
        join(dealBase(ctx, false), { sql: ' AND d.pipeline_id = ? AND d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0', args: [pid] }, stage),
        'd.close_date',
      );
    }
    case 'conversion_funnel': {
      const pid = stagePipeline(ctx);
      if (!pid) return EMPTY('deal');
      // Los que llegaron a la etapa: están en ella o en una posterior que no sea perdida (los ganados pasaron por todas).
      let reached: Cond = { sql: '', args: [] };
      if (cat) {
        const st = await one<{ position: number; is_won: number; is_lost: number } | undefined>(
          db,
          'SELECT position, is_won, is_lost FROM crm_stages WHERE id = ? AND pipeline_id = ?',
          [cat, pid],
        );
        if (!st || st.is_lost) return EMPTY('deal');
        reached = st.is_won
          ? { sql: ' AND d.stage_id = ?', args: [cat] }
          : { sql: ' AND s.is_lost = 0 AND (s.is_won = 1 OR s.position >= ?)', args: [num(st.position)] };
      }
      return dealRows(
        db,
        ctx,
        join(dealBase(ctx, false), { sql: ' AND d.pipeline_id = ?', args: [pid] }, between('d.created_at', from, to), reached),
        'd.created_at',
      );
    }
    case 'avg_time_in_stage': {
      const pid = stagePipeline(ctx);
      if (!pid || !cat) return EMPTY('deal');
      const inStage = {
        sql: ` AND d.pipeline_id = ? AND d.id IN (SELECT h.deal_id FROM crm_deal_stage_history h WHERE h.user_id = ? AND h.stage_id = ?${between('h.entered_at', from, to).sql})`,
        args: [pid, ctx.workspaceId, cat, ...between('h.entered_at', from, to).args],
      };
      return dealRows(db, ctx, join(dealBase(ctx, false), inStage), 'd.created_at');
    }
    case 'deal_forecast': {
      const catCond = cat ? { sql: ` AND ${FORECAST_CATEGORY_SQL} = ?`, args: [cat] } : { sql: '', args: [] };
      return dealRows(
        db,
        ctx,
        join(
          dealBase(ctx, true),
          between('d.close_date', from, to),
          { sql: " AND s.is_lost = 0 AND (d.forecast_category IS NULL OR d.forecast_category != 'omit')", args: [] },
          catCond,
        ),
        'd.close_date',
      );
    }
    case 'deals_closing_this_month':
      return dealRows(
        db,
        ctx,
        join(dealBase(ctx, true), between('d.close_date', from, to), { sql: ' AND d.closed_at IS NULL AND s.is_won = 0 AND s.is_lost = 0', args: [] }),
        'd.close_date',
      );
    case 'activities_kpi':
    case 'activities_by_rep': {
      const owner = cat ? ownerList('a', [cat]) : { sql: '', args: [] };
      const type = ser && ACTIVITY_SERIES.includes(ser) ? { sql: ' AND a.type = ?', args: [ser] } : { sql: '', args: [] };
      return activityRows(
        db,
        ctx,
        join(activityBase(ctx), activityWork(from, to), owner, type),
        "CASE WHEN a.type = 'task' THEN COALESCE(a.done_at, a.created_at) ELSE a.created_at END",
        'dt DESC',
      );
    }
    case 'upcoming_tasks':
      return activityRows(
        db,
        ctx,
        join(activityBase(ctx), { sql: " AND a.type = 'task' AND a.done = 0", args: [] }),
        'a.due_at',
        'a.due_at IS NULL, a.due_at ASC',
      );
    case 'new_contacts_kpi':
      return contactRows(db, ctx, join(contactBase(ctx), between('c.created_at', from, to)));
    case 'new_contacts_by_source': {
      const src = cat
        ? cat === 'other'
          ? { sql: " AND (c.source IS NULL OR c.source = '' OR c.source = 'other')", args: [] }
          : { sql: ' AND c.source = ?', args: [cat] }
        : { sql: '', args: [] };
      return contactRows(db, ctx, join(contactBase(ctx), between('c.created_at', from, to), src), '', "COALESCE(NULLIF(c.source, ''), 'other')", 'source');
    }
    case 'lifecycle_stage_changes': {
      const ev = {
        sql: ` AND c.id IN (SELECT e.entity_id FROM crm_property_events e WHERE e.user_id = ? AND e.entity = 'contact' AND e.field = 'lifecycle_stage'${
          cat ? ' AND e.new_value = ?' : " AND e.new_value != ''"
        }${between('e.created_at', from, to).sql})`,
        args: [ctx.workspaceId, ...(cat ? [cat] : []), ...between('e.created_at', from, to).args],
      };
      return contactRows(db, ctx, join(contactBase(ctx), ev));
    }
    default:
      return EMPTY('deal');
  }
}

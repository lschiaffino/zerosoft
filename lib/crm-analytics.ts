/**
 * CRM, analítica: deals creados, ganados y perdidos, lo ganado, la tasa de
 * cierre, el pipeline abierto por etapa, el ciclo de venta y la actividad, en
 * un período contra el anterior (días en la zona de quien mira).
 *
 * Quién ve qué: el alcance por owner del CRM (lib/crm-visibility.ts). Un
 * member con visibilidad "mine" o "team" solo cuenta los deals y actividades
 * de los owners que puede ver; admins y owner, todo. Los montos se pasan a la
 * moneda base del workspace (baseAmountSql). Las fechas del CRM se guardan
 * como datetime('now') ('YYYY-MM-DD HH:MM:SS'): el rango se compara en ese
 * formato para usar los índices (idx_crm_deals_user, idx_crm_deals_closed,
 * idx_crm_activities_user).
 */
import { getDb } from './db';
import { baseAmountSql, getCrmSettings } from './crm-currency';
import { ownerScopeSql, type OwnerScope } from './crm-visibility';
import {
  analyticsRange,
  dayIndexSql,
  daySeries,
  idxDay,
  median,
  num,
  rangeInfo,
  rangeSegments,
  sqlStamp,
  sumOf,
  type AnalyticsRange,
  type Kpi,
  type RangeInfo,
  type RangeInput,
} from './analytics-kit/period';
import { shortCache } from './analytics-kit/cache';

export const CRM_ACTIVITY_TYPES = ['call', 'meeting', 'email', 'task', 'note'] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];

export interface CrmDay {
  day: string;
  created: number;
  won: number;
  lost: number;
  wonAmount: number;
  activities: number;
}

export interface CrmStageStat {
  id: string;
  name: string;
  pipelineId: string;
  pipelineName: string;
  deals: number;
  amount: number;
  /** Monto por la probabilidad de la etapa. */
  weighted: number;
}

export interface CrmOwnerStat {
  id: string;
  name: string | null;
  created: number;
  won: number;
  lost: number;
  wonAmount: number;
  activities: number;
}

export interface CrmAnalytics {
  range: RangeInfo;
  currency: string;
  kpis: {
    created: Kpi;
    won: Kpi;
    lost: Kpi;
    wonAmount: Kpi;
    /** Ganados sobre cerrados (ganados + perdidos) en el período, 0..1. */
    winRate: Kpi;
    /** Mediana de días de creado a ganado, de los ganados en el período. */
    cycleDays: Kpi;
    activities: Kpi;
    /** Monto abierto ahora. */
    openAmount: Kpi;
    /** Monto abierto por probabilidad, ahora. */
    weighted: Kpi;
    openDeals: Kpi;
  };
  perDay: CrmDay[];
  prevPerDay: CrmDay[];
  stages: CrmStageStat[];
  activityTypes: Array<{ key: CrmActivityType; value: number; prev: number }>;
  lostReasons: Array<{ reason: string; deals: number }>;
  owners: CrmOwnerStat[];
}

export interface CrmAnalyticsFilters {
  pipelineId?: string;
}

type Arg = string | number;

const AMT = baseAmountSql('d');

/** Alcance (alias): el workspace y los owners visibles. */
function scoped(alias: string, scope: OwnerScope): { sql: string; args: Arg[] } {
  const s = ownerScopeSql(alias, scope);
  return s.sql ? { sql: ` AND ${s.sql}`, args: s.args } : { sql: '', args: [] };
}

function pipelineCond(alias: string, f: CrmAnalyticsFilters): { sql: string; args: Arg[] } {
  return f.pipelineId ? { sql: ` AND ${alias}.pipeline_id = ?`, args: [f.pipelineId] } : { sql: '', args: [] };
}

const secs = (col: string) => `CAST(strftime('%s', ${col}) AS INTEGER)`;

/**
 * Los SQL del tablero (exportados para revisar el plan en los tests): deals
 * creados, deals cerrados y actividades por día, con el período (cur).
 */
export function crmFactsSql(ws: string, range: AnalyticsRange, scope: OwnerScope, f: CrmAnalyticsFilters = {}) {
  const seg = rangeSegments(range);
  const since = sqlStamp(range.since);
  const prevSince = sqlStamp(range.prevSince);
  const until = sqlStamp(range.until);
  const ds = scoped('d', scope);
  const dp = pipelineCond('d', f);
  const as = scoped('a', scope);
  return {
    created: {
      sql: `SELECT ${dayIndexSql(seg, secs('d.created_at'))} AS day, COALESCE(d.owner_id, d.user_id) AS owner, COUNT(*) AS n
            FROM crm_deals d WHERE d.user_id = ? AND d.created_at >= ? AND d.created_at < ?${dp.sql}${ds.sql} GROUP BY day, owner`,
      args: [ws, prevSince, until, ...dp.args, ...ds.args] as Arg[],
    },
    closed: {
      sql: `SELECT ${dayIndexSql(seg, secs('d.closed_at'))} AS day, COALESCE(d.owner_id, d.user_id) AS owner, s.is_won AS won, d.lost_reason AS reason,
              ${AMT} AS amount, (julianday(d.closed_at) - julianday(d.created_at)) AS cycle
            FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
            WHERE d.user_id = ? AND d.closed_at >= ? AND d.closed_at < ? AND (s.is_won = 1 OR s.is_lost = 1)${dp.sql}${ds.sql}`,
      args: [ws, prevSince, until, ...dp.args, ...ds.args] as Arg[],
    },
    activities: {
      sql: `SELECT ${dayIndexSql(seg, secs('a.created_at'))} AS day, COALESCE(a.owner_id, a.user_id) AS owner, a.type AS type, COUNT(*) AS n
            FROM crm_activities a WHERE a.user_id = ? AND a.created_at >= ? AND a.created_at < ?${as.sql} GROUP BY day, owner, type`,
      args: [ws, prevSince, until, ...as.args] as Arg[],
    },
    open: {
      sql: `SELECT s.id, s.name, s.probability, s.position, p.id AS pipeline_id, p.name AS pipeline_name, p.position AS pipeline_position,
              COUNT(d.id) AS deals, COALESCE(SUM(${AMT}), 0) AS amount
            FROM crm_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id
            LEFT JOIN crm_deals d ON d.stage_id = s.id AND d.user_id = p.user_id${ds.sql}
            WHERE p.user_id = ? AND s.is_won = 0 AND s.is_lost = 0${f.pipelineId ? ' AND p.id = ?' : ''}
            GROUP BY s.id ORDER BY p.position, p.created_at, s.position`,
      args: [...ds.args, ws, ...(f.pipelineId ? [f.pipelineId] : [])] as Arg[],
    },
    since,
  };
}

interface Rows {
  created: Array<{ day: number; owner: string; n: number }>;
  closed: Array<{ day: number; owner: string; won: number; reason: string | null; amount: number; cycle: number | null }>;
  activities: Array<{ day: number; owner: string; type: string; n: number }>;
  open: Array<{ id: string; name: string; probability: number; pipeline_id: string; pipeline_name: string; deals: number; amount: number }>;
}

/** Agrega las filas leídas (puro: lo prueban los tests). */
export function aggregateCrm(range: AnalyticsRange, rows: Rows, names: Map<string, string | null>, currency: string): CrmAnalytics {
  const curDays = new Set(daySeries(range, new Map(), () => ({})).cur.map((p) => p.day));
  const isCur = (dayIdx: number) => curDays.has(idxDay(dayIdx));
  const empty = (): Omit<CrmDay, 'day'> => ({ created: 0, won: 0, lost: 0, wonAmount: 0, activities: 0 });
  const byDay = new Map<string, Omit<CrmDay, 'day'>>();
  const at = (idx: number) => {
    const d = idxDay(idx);
    let v = byDay.get(d);
    if (!v) byDay.set(d, (v = empty()));
    return v;
  };
  const owners = new Map<string, CrmOwnerStat>();
  const owner = (id: string) => {
    let o = owners.get(id);
    if (!o) owners.set(id, (o = { id, name: names.get(id) ?? null, created: 0, won: 0, lost: 0, wonAmount: 0, activities: 0 }));
    return o;
  };
  for (const r of rows.created) {
    at(num(r.day)).created += num(r.n);
    if (isCur(num(r.day))) owner(r.owner).created += num(r.n);
  }
  const cycles: number[] = [];
  const prevCycles: number[] = [];
  const reasons = new Map<string, number>();
  for (const r of rows.closed) {
    const v = at(num(r.day));
    const cur = isCur(num(r.day));
    if (num(r.won) === 1) {
      v.won += 1;
      v.wonAmount += num(r.amount);
      if (r.cycle != null && Number.isFinite(Number(r.cycle))) (cur ? cycles : prevCycles).push(Math.max(0, Math.round(Number(r.cycle))));
      if (cur) {
        owner(r.owner).won += 1;
        owner(r.owner).wonAmount += num(r.amount);
      }
    } else {
      v.lost += 1;
      if (cur) {
        owner(r.owner).lost += 1;
        const reason = (r.reason ?? '').trim();
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }
  }
  const types = new Map<string, { value: number; prev: number }>();
  for (const r of rows.activities) {
    at(num(r.day)).activities += num(r.n);
    const cur = isCur(num(r.day));
    const t = types.get(r.type) ?? { value: 0, prev: 0 };
    if (cur) t.value += num(r.n);
    else t.prev += num(r.n);
    types.set(r.type, t);
    if (cur) owner(r.owner).activities += num(r.n);
  }
  const { cur: perDay, prev: prevPerDay } = daySeries(range, byDay, empty);
  const total = (list: CrmDay[], k: keyof Omit<CrmDay, 'day'>) => sumOf(list, (p) => p[k]);
  const rate = (list: CrmDay[]) => {
    const won = total(list, 'won');
    const closed = won + total(list, 'lost');
    return closed ? won / closed : null;
  };
  const stages: CrmStageStat[] = rows.open.map((s) => ({
    id: s.id,
    name: s.name,
    pipelineId: s.pipeline_id,
    pipelineName: s.pipeline_name,
    deals: num(s.deals),
    amount: num(s.amount),
    weighted: (num(s.amount) * Math.min(100, Math.max(0, num(s.probability)))) / 100,
  }));
  return {
    range: rangeInfo(range),
    currency,
    kpis: {
      created: { value: total(perDay, 'created'), prev: total(prevPerDay, 'created') },
      won: { value: total(perDay, 'won'), prev: total(prevPerDay, 'won') },
      lost: { value: total(perDay, 'lost'), prev: total(prevPerDay, 'lost') },
      wonAmount: { value: total(perDay, 'wonAmount'), prev: total(prevPerDay, 'wonAmount') },
      winRate: { value: rate(perDay), prev: rate(prevPerDay) },
      cycleDays: { value: median(cycles), prev: median(prevCycles) },
      activities: { value: total(perDay, 'activities'), prev: total(prevPerDay, 'activities') },
      openAmount: { value: sumOf(stages, (s) => s.amount) },
      weighted: { value: Math.round(sumOf(stages, (s) => s.weighted)) },
      openDeals: { value: sumOf(stages, (s) => s.deals) },
    },
    perDay,
    prevPerDay,
    stages,
    activityTypes: CRM_ACTIVITY_TYPES.map((key) => ({ key, ...(types.get(key) ?? { value: 0, prev: 0 }) })),
    lostReasons: [...reasons.entries()].map(([reason, deals]) => ({ reason, deals })).sort((a, b) => b.deals - a.deals || a.reason.localeCompare(b.reason)).slice(0, 8),
    owners: [...owners.values()]
      .filter((o) => o.created || o.won || o.lost || o.activities)
      .sort((a, b) => b.wonAmount - a.wonAmount || b.won - a.won || b.created - a.created || (a.name ?? '').localeCompare(b.name ?? '')),
  };
}

/** La analítica del CRM que ve esta persona (scope de sessionScope). */
export async function crmAnalytics(ws: string, scope: OwnerScope, query: RangeInput & CrmAnalyticsFilters = {}, opts: { now?: Date } = {}): Promise<CrmAnalytics> {
  const range = analyticsRange(query, opts.now ?? new Date());
  const q = crmFactsSql(ws, range, scope, { pipelineId: query.pipelineId });
  const db = getDb();
  const [created, closed, activities, open, settings] = await Promise.all([
    db.prepare(q.created.sql).all(...q.created.args) as Promise<Rows['created']>,
    db.prepare(q.closed.sql).all(...q.closed.args) as Promise<Rows['closed']>,
    db.prepare(q.activities.sql).all(...q.activities.args) as Promise<Rows['activities']>,
    db.prepare(q.open.sql).all(...q.open.args) as Promise<Rows['open']>,
    getCrmSettings(ws),
  ]);
  const ids = [...new Set([...created, ...closed, ...activities].map((r) => r.owner))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const people = (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)) as Array<{ id: string; name: string | null; email: string }>;
    for (const p of people) names.set(p.id, p.name || p.email);
  }
  return aggregateCrm(range, { created, closed, activities, open }, names, settings.baseCurrency);
}

export function isCrmAnalyticsEmpty(d: CrmAnalytics): boolean {
  const k = d.kpis;
  return !k.created.value && !k.won.value && !k.lost.value && !k.activities.value && !k.openDeals.value;
}

const cache = shortCache<CrmAnalytics>();

/** Con la caché corta del kit. La clave lleva quién mira y qué owners ve. */
export function cachedCrmAnalytics(ws: string, viewerId: string, scope: OwnerScope, query: RangeInput & CrmAnalyticsFilters = {}): Promise<CrmAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([ws, viewerId, scope, query.pipelineId ?? '', r.since, r.until, r.tz]), () => crmAnalytics(ws, scope, query, { now }));
}

export function clearCrmAnalyticsCache(): void {
  cache.clear();
}

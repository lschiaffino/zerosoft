/**
 * CRM — forecast de ventas (como Sales › Forecast de HubSpot).
 *
 * Por período (mes o trimestre) y por persona o equipo de ventas:
 * - meta: la cuota de valor ganado de ese período (lib/crm-quotas.ts);
 * - ganado: deals ganados con closed_at en el período;
 * - commit / best case / pipeline: deals abiertos con fecha de cierre en el
 *   período, según su categoría de forecast. La categoría la elige cada deal
 *   (crm_deals.forecast_category); vacía = la que corresponde a la
 *   probabilidad de su etapa (FORECAST_DEFAULTS). 'omit' lo saca del forecast;
 * - ponderado: ganado + monto abierto × probabilidad de la etapa;
 * - envío: el número que la persona envía para el período. Se guarda cada
 *   envío (historial); vale el último.
 * Server-only (forecastMath y categoryFor son puras y se testean solas).
 */
import { getDb, type Db } from './db';
import { baseAmountSql } from './crm-currency';
import { periodRange, type PeriodRange, type QuotaPeriod } from './crm-quotas';
import { listSalesTeams, type OwnerScope } from './crm-visibility';
import { isWorkspacePerson } from './crm-refs';

export const FORECAST_CATEGORIES = ['pipeline', 'best_case', 'commit', 'omit'] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];
/** Lo que muestra el forecast por deal (closed_won es solo para ganados). */
export type EffectiveCategory = ForecastCategory | 'closed_won';

/** Probabilidad mínima de la etapa para cada categoría cuando el deal no eligió una. */
export const FORECAST_DEFAULTS = { commit: 70, best_case: 40 } as const;

export function isForecastCategory(v: unknown): v is ForecastCategory {
  return typeof v === 'string' && (FORECAST_CATEGORIES as readonly string[]).includes(v);
}

/** Categoría efectiva de un deal. Los perdidos no entran (null). */
export function categoryFor(deal: { forecast_category: string; probability: number; is_won: number; is_lost: number }): EffectiveCategory | null {
  if (deal.is_lost) return null;
  if (deal.is_won) return 'closed_won';
  if (isForecastCategory(deal.forecast_category)) return deal.forecast_category;
  if (deal.probability >= FORECAST_DEFAULTS.commit) return 'commit';
  if (deal.probability >= FORECAST_DEFAULTS.best_case) return 'best_case';
  return 'pipeline';
}

/** Período desplazado `offset` meses/trimestres desde el actual. */
export function forecastPeriod(period: QuotaPeriod, offset = 0, now: Date = new Date()): PeriodRange {
  const step = period === 'month' ? 1 : 3;
  const shifted = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset * step, 1, 12));
  const r = periodRange(period, shifted);
  // elapsed vale para el período actual; los pasados quedan en 1 y los futuros en 0.
  if (offset !== 0) return { ...r, elapsed: offset < 0 ? 1 : 0 };
  return periodRange(period, now);
}

export interface ForecastDeal {
  id: string;
  name: string;
  owner_id: string;
  amount: number;
  probability: number;
  stage_name: string;
  close_date: string | null;
  closed_at: string | null;
  forecast_category: string;
  is_won: number;
  is_lost: number;
}

export interface ForecastTotals {
  goal: number | null;
  closedWon: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  weighted: number;
  /** Ganado + commit: lo más probable. */
  mostLikely: number;
  deals: number;
}

export interface ForecastSubmission {
  id: string;
  person_id: string;
  period: QuotaPeriod;
  period_label: string;
  amount: number;
  note: string;
  submitted_by: string;
  created_at: string;
}

export interface ForecastRow extends ForecastTotals {
  personId: string;
  name: string;
  submission: ForecastSubmission | null;
  /** % de la meta ya ganado. */
  attainment: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Suma los deals (ya en moneda base) por categoría. */
export function forecastMath(deals: ForecastDeal[], goal: number | null): ForecastTotals {
  const t: ForecastTotals = { goal, closedWon: 0, commit: 0, bestCase: 0, pipeline: 0, weighted: 0, mostLikely: 0, deals: 0 };
  for (const d of deals) {
    const cat = categoryFor(d);
    if (!cat || cat === 'omit') continue;
    t.deals += 1;
    if (cat === 'closed_won') {
      t.closedWon += d.amount;
      t.weighted += d.amount;
      continue;
    }
    if (cat === 'commit') t.commit += d.amount;
    else if (cat === 'best_case') t.bestCase += d.amount;
    else t.pipeline += d.amount;
    t.weighted += (d.amount * d.probability) / 100;
  }
  t.closedWon = r2(t.closedWon);
  t.commit = r2(t.commit);
  t.bestCase = r2(t.bestCase);
  t.pipeline = r2(t.pipeline);
  t.weighted = r2(t.weighted);
  t.mostLikely = r2(t.closedWon + t.commit);
  return t;
}

/**
 * La parte de cada deal que les toca a `owners`: con splits, la suma de sus
 * porcentajes; sin splits, todo si el dueño está entre ellos. Saca los deals en 0.
 */
export function applySplits(
  deals: ForecastDeal[],
  splits: Map<string, Array<{ owner_id: string; percent: number }>>,
  owners: Set<string>,
): ForecastDeal[] {
  const out: ForecastDeal[] = [];
  for (const d of deals) {
    const s = splits.get(d.id);
    const share = s?.length ? s.reduce((acc, x) => acc + (owners.has(x.owner_id) ? x.percent : 0), 0) / 100 : owners.has(d.owner_id) ? 1 : 0;
    if (share <= 0) continue;
    out.push(share === 1 ? d : { ...d, amount: d.amount * share });
  }
  return out;
}

export interface ForecastPerson {
  id: string;
  name: string;
}

export interface ForecastView {
  period: QuotaPeriod;
  periodLabel: string;
  start: string;
  end: string;
  offset: number;
  elapsed: number;
  rows: ForecastRow[];
  total: ForecastTotals & { submitted: number };
  deals: ForecastDeal[];
  /** Deals abiertos sin fecha de cierre (no entran en ningún período). */
  undated: number;
  teams: Array<{ id: string; name: string; members: string[] }>;
}

/** Forecast del período para las personas visibles (o las de un equipo). */
export async function getForecast(
  workspaceId: string,
  opts: {
    period: QuotaPeriod;
    offset?: number;
    people: ForecastPerson[];
    teamId?: string | null;
    pipelineId?: string | null;
    scope?: OwnerScope;
    now?: Date;
  },
  db: Db = getDb(),
): Promise<ForecastView> {
  const offset = Math.max(-24, Math.min(24, Math.trunc(opts.offset ?? 0)));
  const range = forecastPeriod(opts.period, offset, opts.now);
  const teams = await listSalesTeams(workspaceId, db);
  let people = opts.people.filter((p) => !opts.scope || opts.scope.includes(p.id));
  const team = opts.teamId ? teams.find((t) => t.id === opts.teamId) : null;
  if (team) people = people.filter((p) => team.members.includes(p.id));
  const ids = people.map((p) => p.id);

  const startDay = range.start.slice(0, 10);
  const endDay = range.end.slice(0, 10);
  const amt = baseAmountSql('d');
  const ph = ids.map(() => '?').join(',');
  const pipeSql = opts.pipelineId ? ' AND d.pipeline_id = ?' : '';
  const pipeArgs = opts.pipelineId ? [opts.pipelineId] : [];

  const deals = ids.length
    ? ((await db
        .prepare(
          `SELECT d.id, d.name, COALESCE(d.owner_id, d.user_id) AS owner_id, ${amt} AS amount, s.probability, s.name AS stage_name,
             d.close_date, d.closed_at, d.forecast_category, s.is_won, s.is_lost
           FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
           WHERE d.user_id = ? AND (COALESCE(d.owner_id, d.user_id) IN (${ph}) OR EXISTS (SELECT 1 FROM crm_deal_splits xs WHERE xs.deal_id = d.id AND xs.owner_id IN (${ph})))${pipeSql}
             AND s.is_lost = 0
             AND ((s.is_won = 1 AND d.closed_at >= ? AND d.closed_at < ?)
               OR (s.is_won = 0 AND d.close_date >= ? AND d.close_date < ?))
           ORDER BY s.is_won DESC, d.close_date ASC, amount DESC`,
        )
        .all(workspaceId, ...ids, ...ids, ...pipeArgs, range.start, range.end, startDay, endDay)) as ForecastDeal[])
    : [];

  const undated = ids.length
    ? Number(
        ((await db
          .prepare(
            `SELECT COUNT(*) AS c FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
             WHERE d.user_id = ? AND (COALESCE(d.owner_id, d.user_id) IN (${ph}) OR EXISTS (SELECT 1 FROM crm_deal_splits xs WHERE xs.deal_id = d.id AND xs.owner_id IN (${ph})))${pipeSql}
               AND s.is_won = 0 AND s.is_lost = 0 AND (d.close_date IS NULL OR d.close_date = '')`,
          )
          .get(workspaceId, ...ids, ...ids, ...pipeArgs)) as { c: number }).c,
      )
    : 0;

  const goals = new Map<string, number>();
  for (const q of (await db
    .prepare("SELECT person_id, target FROM crm_quotas WHERE user_id = ? AND metric = 'won_value' AND period = ?")
    .all(workspaceId, opts.period)) as Array<{ person_id: string; target: number }>) {
    goals.set(q.person_id, Number(q.target));
  }

  const latest = await latestSubmissions(workspaceId, opts.period, range.label, db);

  // Splits (lib/crm-splits.ts): con splits, a cada persona le toca su porcentaje
  // del monto; sin splits, el deal entero es del dueño.
  const splits = new Map<string, Array<{ owner_id: string; percent: number }>>();
  if (deals.length) {
    for (const r of (await db
      .prepare('SELECT deal_id, owner_id, percent FROM crm_deal_splits WHERE user_id = ?')
      .all(workspaceId)) as Array<{ deal_id: string; owner_id: string; percent: number }>) {
      const list = splits.get(r.deal_id) ?? [];
      list.push({ owner_id: r.owner_id, percent: Number(r.percent) });
      splits.set(r.deal_id, list);
    }
  }
  const sharedFor = (owners: Set<string>) => applySplits(deals, splits, owners);

  const rows: ForecastRow[] = people.map((p) => {
    const mine = sharedFor(new Set([p.id]));
    const goal = goals.has(p.id) ? goals.get(p.id)! : null;
    const t = forecastMath(mine, goal);
    return {
      ...t,
      personId: p.id,
      name: p.name,
      submission: latest.get(p.id) ?? null,
      attainment: goal && goal > 0 ? Math.round((t.closedWon / goal) * 1000) / 10 : null,
    };
  });

  const goalSum = rows.reduce<number | null>((acc, r) => (r.goal === null ? acc : (acc ?? 0) + r.goal), null);
  const total = forecastMath(sharedFor(new Set(ids)), goalSum);
  const submitted = r2(rows.reduce((acc, r) => acc + (r.submission?.amount ?? 0), 0));

  return {
    period: opts.period,
    periodLabel: range.label,
    start: range.start,
    end: range.end,
    offset,
    elapsed: range.elapsed,
    rows,
    total: { ...total, submitted },
    deals,
    undated,
    teams: teams.map((t) => ({ id: t.id, name: t.name, members: t.members })),
  };
}

async function latestSubmissions(
  workspaceId: string,
  period: QuotaPeriod,
  label: string,
  db: Db,
): Promise<Map<string, ForecastSubmission>> {
  const rows = (await db
    .prepare(
      `SELECT * FROM crm_forecast_submissions WHERE user_id = ? AND period = ? AND period_label = ?
       ORDER BY created_at DESC, rowid DESC`,
    )
    .all(workspaceId, period, label)) as Array<ForecastSubmission & { user_id: string }>;
  const out = new Map<string, ForecastSubmission>();
  for (const r of rows) {
    if (out.has(r.person_id)) continue;
    const { user_id: _ws, ...rest } = r;
    out.set(r.person_id, rest);
  }
  return out;
}

export class ForecastError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const LABEL_RE = { month: /^\d{4}-(0[1-9]|1[0-2])$/, quarter: /^\d{4}-Q[1-4]$/ } as const;

/** Guarda el número de forecast de una persona para un período (queda en el historial). */
export async function submitForecast(
  workspaceId: string,
  input: { personId: string; period: QuotaPeriod; periodLabel: string; amount: number; note?: string; submittedBy: string },
  db: Db = getDb(),
): Promise<ForecastSubmission> {
  if (!LABEL_RE[input.period]?.test(input.periodLabel)) throw new ForecastError('invalid_input');
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new ForecastError('invalid_input');
  if (!(await isWorkspacePerson(workspaceId, input.personId, db))) throw new ForecastError('invalid_owner');
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_forecast_submissions (id, user_id, person_id, period, period_label, amount, note, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, input.personId, input.period, input.periodLabel, r2(input.amount), (input.note ?? '').slice(0, 500), input.submittedBy);
  const row = (await db.prepare('SELECT * FROM crm_forecast_submissions WHERE id = ?').get(id)) as ForecastSubmission & { user_id: string };
  const { user_id: _ws, ...rest } = row;
  return rest;
}

/** Historial de envíos de una persona en un período, del más nuevo al más viejo. */
export async function submissionHistory(
  workspaceId: string,
  personId: string,
  period: QuotaPeriod,
  periodLabel: string,
  db: Db = getDb(),
): Promise<ForecastSubmission[]> {
  const rows = (await db
    .prepare(
      `SELECT * FROM crm_forecast_submissions WHERE user_id = ? AND person_id = ? AND period = ? AND period_label = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 50`,
    )
    .all(workspaceId, personId, period, periodLabel)) as Array<ForecastSubmission & { user_id: string }>;
  return rows.map(({ user_id: _ws, ...rest }) => rest);
}

/** Cambia la categoría de forecast de un deal ('' = la de su etapa). Deja rastro en el historial del deal. */
export async function setDealForecastCategory(
  workspaceId: string,
  dealId: string,
  category: ForecastCategory | '',
  actorEmail: string,
  db: Db = getDb(),
): Promise<boolean> {
  const row = (await db
    .prepare('SELECT forecast_category FROM crm_deals WHERE id = ? AND user_id = ?')
    .get(dealId, workspaceId)) as { forecast_category: string } | undefined;
  if (!row) return false;
  if (row.forecast_category === category) return true;
  await db
    .prepare("UPDATE crm_deals SET forecast_category = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(category, dealId, workspaceId);
  await db
    .prepare(
      `INSERT INTO crm_property_events (id, user_id, entity, entity_id, field, old_value, new_value, actor_email)
       VALUES (?, ?, 'deal', ?, 'forecast_category', ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), workspaceId, dealId, row.forecast_category, category, actorEmail);
  return true;
}

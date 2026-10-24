/**
 * CRM — cuotas por owner (mensuales o trimestrales): valor ganado, deals
 * ganados y reuniones agendadas. Progreso en el dashboard del CRM y en
 * reportes. Server-only (la matemática de períodos es pura y se testea sola).
 */
import { getDb, type CrmQuotaRow, type Db } from './db';
import { baseAmountSql } from './crm-currency';
import { splitShareArgs, splitShareSql } from './crm-splits';
import { isWorkspacePerson } from './crm-refs';

export const QUOTA_METRICS = ['won_value', 'won_count', 'meetings'] as const;
export type QuotaMetric = (typeof QUOTA_METRICS)[number];
export const QUOTA_PERIODS = ['month', 'quarter'] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

export interface PeriodRange {
  /** 'YYYY-MM-DD HH:MM:SS' UTC, inclusivo. */
  start: string;
  /** 'YYYY-MM-DD HH:MM:SS' UTC, exclusivo. */
  end: string;
  /** '2026-10' o '2026-Q4'. */
  label: string;
  /** Fracción del período transcurrida (0..1). */
  elapsed: number;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Período (mes o trimestre calendario, UTC) que contiene `now`. */
export function periodRange(period: QuotaPeriod, now: Date = new Date()): PeriodRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const startMonth = period === 'month' ? m : Math.floor(m / 3) * 3;
  const start = new Date(Date.UTC(y, startMonth, 1));
  const end = new Date(Date.UTC(y, startMonth + (period === 'month' ? 1 : 3), 1));
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
  const label = period === 'month' ? `${y}-${String(m + 1).padStart(2, '0')}` : `${y}-Q${Math.floor(m / 3) + 1}`;
  return { start: fmt(start), end: fmt(end), label, elapsed };
}

export interface QuotaProgressMath {
  pct: number;
  remaining: number;
  /** % esperado a esta altura del período (lineal). */
  expectedPct: number;
  /** ¿Va al ritmo (o adelante) del objetivo? */
  onTrack: boolean;
}

/** Progreso de una cuota: % logrado, faltante y si va al ritmo esperado. */
export function quotaMath(target: number, actual: number, elapsed: number): QuotaProgressMath {
  const pct = target > 0 ? Math.round((actual / target) * 1000) / 10 : actual > 0 ? 100 : 0;
  const expectedPct = Math.round(Math.min(1, Math.max(0, elapsed)) * 1000) / 10;
  return {
    pct,
    remaining: Math.max(0, Math.round((target - actual) * 100) / 100),
    expectedPct,
    onTrack: pct >= expectedPct,
  };
}

// ---------- CRUD ----------

export async function listQuotas(workspaceId: string, db: Db = getDb()): Promise<CrmQuotaRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_quotas WHERE user_id = ? ORDER BY person_id, metric, period')
    .all(workspaceId)) as CrmQuotaRow[];
}

export class QuotaError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Crea o actualiza la cuota (una por persona + métrica + período). */
export async function upsertQuota(
  workspaceId: string,
  input: { personId: string; metric: QuotaMetric; period: QuotaPeriod; target: number },
  db: Db = getDb(),
): Promise<CrmQuotaRow> {
  if (!(await isWorkspacePerson(workspaceId, input.personId, db))) throw new QuotaError('invalid_owner');
  if (!(QUOTA_METRICS as readonly string[]).includes(input.metric)) throw new QuotaError('invalid_input');
  if (!(QUOTA_PERIODS as readonly string[]).includes(input.period)) throw new QuotaError('invalid_input');
  if (!Number.isFinite(input.target) || input.target < 0) throw new QuotaError('invalid_input');
  await db
    .prepare(
      `INSERT INTO crm_quotas (id, user_id, person_id, metric, period, target) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, person_id, metric, period) DO UPDATE SET target = excluded.target, updated_at = datetime('now')`,
    )
    .run(crypto.randomUUID(), workspaceId, input.personId, input.metric, input.period, input.target);
  return (await db
    .prepare('SELECT * FROM crm_quotas WHERE user_id = ? AND person_id = ? AND metric = ? AND period = ?')
    .get(workspaceId, input.personId, input.metric, input.period)) as CrmQuotaRow;
}

export async function deleteQuota(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  return (await db.prepare('DELETE FROM crm_quotas WHERE id = ? AND user_id = ?').run(id, workspaceId)).changes > 0;
}

// ---------- Progreso ----------

/** Valor real de una métrica para una persona en un rango [start, end). */
export async function quotaActual(
  workspaceId: string,
  personId: string,
  metric: QuotaMetric,
  range: Pick<PeriodRange, 'start' | 'end'>,
  db: Db = getDb(),
): Promise<number> {
  if (metric === 'meetings') {
    const row = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM crm_activities a
         WHERE a.user_id = ? AND a.type = 'meeting' AND COALESCE(a.owner_id, a.user_id) = ?
           AND a.created_at >= ? AND a.created_at < ?`,
      )
      .get(workspaceId, personId, range.start, range.end)) as { c: number };
    return Number(row.c);
  }
  // Con splits (lib/crm-splits.ts), cada persona suma su porcentaje del deal ganado.
  const row = (await db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(${baseAmountSql('d')} * d.sh), 0) AS a FROM (
         SELECT d.*, ${splitShareSql('d', 1)} AS sh
         FROM crm_deals d JOIN crm_stages s ON s.id = d.stage_id
         WHERE d.user_id = ? AND s.is_won = 1 AND d.closed_at >= ? AND d.closed_at < ?
       ) d WHERE d.sh > 0`,
    )
    .get(...splitShareArgs([personId]), workspaceId, range.start, range.end)) as { c: number; a: number };
  return metric === 'won_count' ? Number(row.c) : Math.round(Number(row.a) * 100) / 100;
}

export interface QuotaProgress extends QuotaProgressMath {
  id: string;
  personId: string;
  personName: string;
  metric: QuotaMetric;
  period: QuotaPeriod;
  periodLabel: string;
  target: number;
  actual: number;
}

/**
 * Progreso de las cuotas del período actual. `ownerIds` limita a esas
 * personas (visibilidad por owner); `people` da los nombres.
 */
export async function quotaProgress(
  workspaceId: string,
  opts: { now?: Date; ownerIds?: string[] | null; people?: Array<{ id: string; name: string }> } = {},
  db: Db = getDb(),
): Promise<QuotaProgress[]> {
  const now = opts.now ?? new Date();
  const names = new Map((opts.people ?? []).map((p) => [p.id, p.name]));
  const quotas = (await listQuotas(workspaceId, db)).filter((q) => !opts.ownerIds || opts.ownerIds.includes(q.person_id));
  const out: QuotaProgress[] = [];
  for (const q of quotas) {
    const range = periodRange(q.period, now);
    const actual = await quotaActual(workspaceId, q.person_id, q.metric, range, db);
    out.push({
      id: q.id,
      personId: q.person_id,
      personName: names.get(q.person_id) ?? q.person_id,
      metric: q.metric,
      period: q.period,
      periodLabel: range.label,
      target: q.target,
      actual,
      ...quotaMath(q.target, actual, range.elapsed),
    });
  }
  return out;
}

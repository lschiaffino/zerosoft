/**
 * CRM — historial de etapas de cada deal (crm_deal_stage_history) y la
 * analítica del recorrido de deals que sale de él: cuántos deals llegan a
 * cada etapa, cuántos pasan a la siguiente, cuánto tardan en cada una y en
 * qué etapa se pierden. Server-only; la matemática (journeyMath) es pura.
 *
 * Una fila por cada entrada a una etapa: entered_at al entrar y exited_at al
 * salir (NULL mientras el deal sigue ahí). createDeal y moveDeal (lib/crm.ts)
 * llaman a recordStageEntry; la migración 074 reconstruyó el historial de los
 * deals que ya existían desde el audit trail.
 */
import { getDb, type Db } from './db';
import { scopeAnd, type OwnerScope } from './crm-visibility';

export interface StageHistoryRow {
  id: string;
  user_id: string;
  deal_id: string;
  pipeline_id: string;
  stage_id: string;
  entered_at: string;
  exited_at: string | null;
}

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Cierra la etapa abierta del deal (si la hay) y abre la nueva. No hace nada si ya está en esa etapa. */
export async function recordStageEntry(
  input: { userId: string; dealId: string; pipelineId: string; stageId: string; at?: string },
  db: Db = getDb(),
): Promise<void> {
  const at = input.at ?? nowDb();
  const open = (await db
    .prepare('SELECT id, stage_id FROM crm_deal_stage_history WHERE deal_id = ? AND exited_at IS NULL ORDER BY entered_at DESC LIMIT 1')
    .get(input.dealId)) as { id: string; stage_id: string } | undefined;
  if (open?.stage_id === input.stageId) return;
  await db.prepare('UPDATE crm_deal_stage_history SET exited_at = ? WHERE deal_id = ? AND exited_at IS NULL').run(at, input.dealId);
  await db
    .prepare(
      `INSERT INTO crm_deal_stage_history (id, user_id, deal_id, pipeline_id, stage_id, entered_at, exited_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(crypto.randomUUID(), input.userId, input.dealId, input.pipelineId, input.stageId, at);
}

/** Historial de un deal, del más viejo al más nuevo. */
export async function listStageHistory(userId: string, dealId: string, db: Db = getDb()): Promise<StageHistoryRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_deal_stage_history WHERE user_id = ? AND deal_id = ? ORDER BY entered_at ASC, rowid ASC')
    .all(userId, dealId)) as StageHistoryRow[];
}

// ============================================================
// RECORRIDO DE DEALS
// ============================================================

export interface JourneyStageInput {
  id: string;
  name: string;
  is_won: number;
  is_lost: number;
}

export interface JourneyDealInput {
  id: string;
  stage_id: string;
  /** Entradas a etapas en orden cronológico. */
  entries: Array<{ stage_id: string; entered_at: string; exited_at: string | null }>;
}

export interface JourneyStage {
  id: string;
  name: string;
  isWon: boolean;
  /** Deals que llegaron a la etapa (o a una posterior, en modo acumulado). */
  reached: number;
  /** % de los que llegaron que pasaron a la etapa siguiente (null en la última). */
  nextRate: number | null;
  /** % de los que llegaron respecto de la primera etapa. */
  fromStartRate: number | null;
  /** Deals que hoy siguen en esta etapa. */
  current: number;
  /** Deals que se perdieron estando en esta etapa (su última etapa abierta). */
  lost: number;
  /** % de los que llegaron que se perdieron acá. */
  lostRate: number | null;
  /** Días promedio en la etapa (entradas ya cerradas); null si nadie salió todavía. */
  avgDays: number | null;
  /** Entradas cerradas que promedia avgDays. */
  exits: number;
}

export interface JourneyResult {
  stages: JourneyStage[];
  /** Deals del período (cohorte por fecha de creación). */
  total: number;
  won: number;
  lost: number;
  open: number;
  /** % ganados sobre el total de la cohorte. */
  winRate: number | null;
  /** Días promedio de creación a ganado. */
  avgDaysToWin: number | null;
  /** Etapa con más deals perdidos (dónde se caen). */
  biggestDropStageId: string | null;
}

export type JourneyMode = 'cumulative' | 'strict';

function days(from: string, to: string): number {
  const a = Date.parse(`${from.replace(' ', 'T')}Z`);
  const b = Date.parse(`${to.replace(' ', 'T')}Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 86_400_000);
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Embudo del recorrido. Las etapas van en el orden del pipeline; las
 * perdidas no forman parte del embudo (se cuentan como caída de la etapa
 * abierta donde estaba el deal al perderse).
 * - cumulative: un deal que llegó a una etapa posterior también cuenta como
 *   que pasó por las anteriores (como el embudo de HubSpot por defecto).
 * - strict: solo cuenta si entró de verdad a esa etapa.
 */
export function journeyMath(
  stages: JourneyStageInput[],
  deals: JourneyDealInput[],
  mode: JourneyMode = 'cumulative',
): JourneyResult {
  const flow = stages.filter((s) => !s.is_lost);
  const lostIds = new Set(stages.filter((s) => s.is_lost).map((s) => s.id));
  const wonIds = new Set(stages.filter((s) => s.is_won).map((s) => s.id));
  const index = new Map(flow.map((s, i) => [s.id, i]));

  const reached = new Array(flow.length).fill(0);
  const current = new Array(flow.length).fill(0);
  const lostAt = new Array(flow.length).fill(0);
  const durSum = new Array(flow.length).fill(0);
  const durN = new Array(flow.length).fill(0);
  let won = 0;
  let lost = 0;
  let winDays = 0;

  for (const d of deals) {
    const entered = new Set<number>();
    for (const e of d.entries) {
      const i = index.get(e.stage_id);
      if (i === undefined) continue;
      entered.add(i);
      if (e.exited_at) {
        durSum[i] += days(e.entered_at, e.exited_at);
        durN[i] += 1;
      }
    }
    // Una etapa ganada de "llegada" alcanza a todas las ganadas (no hay orden entre ellas).
    const isWon = wonIds.has(d.stage_id);
    const isLost = lostIds.has(d.stage_id);
    if (isWon) {
      won += 1;
      const firstEntry = d.entries[0]?.entered_at;
      const winEntry = [...d.entries].reverse().find((e) => wonIds.has(e.stage_id));
      if (firstEntry && winEntry) winDays += days(firstEntry, winEntry.entered_at);
    }
    if (isLost) lost += 1;
    const curIdx = index.get(d.stage_id);
    if (curIdx !== undefined && !isWon) current[curIdx] += 1;

    let furthest = -1;
    for (const i of entered) furthest = Math.max(furthest, i);
    if (mode === 'cumulative') {
      for (let i = 0; i <= furthest; i++) {
        if (flow[i].is_won && !entered.has(i)) continue;
        reached[i] += 1;
      }
    } else {
      for (const i of entered) reached[i] += 1;
    }
    if (isLost) {
      // Última etapa abierta antes de perderse.
      const lastOpen = [...d.entries].reverse().find((e) => index.has(e.stage_id) && !wonIds.has(e.stage_id));
      const i = lastOpen ? index.get(lastOpen.stage_id)! : -1;
      if (i >= 0) lostAt[i] += 1;
    }
  }

  const start = reached[0] ?? 0;
  const wonReached = flow.reduce((acc, s, i) => acc + (s.is_won ? reached[i] : 0), 0);
  const out: JourneyStage[] = flow.map((s, i) => {
    // De una etapa abierta a la siguiente; si la siguiente es ganada, cuentan todas las ganadas.
    let nextRate: number | null = null;
    if (!s.is_won && i + 1 < flow.length) {
      const nextReached = flow[i + 1].is_won ? wonReached : reached[i + 1];
      nextRate = pct(Math.min(nextReached, reached[i]), reached[i]);
    }
    return {
      id: s.id,
      name: s.name,
      isWon: !!s.is_won,
      reached: reached[i],
      nextRate,
      fromStartRate: pct(reached[i], start),
      current: current[i],
      lost: lostAt[i],
      lostRate: pct(lostAt[i], reached[i]),
      avgDays: durN[i] > 0 ? round1(durSum[i] / durN[i]) : null,
      exits: durN[i],
    };
  });

  let biggest: string | null = null;
  let max = 0;
  for (const s of out) {
    if (s.lost > max) {
      max = s.lost;
      biggest = s.id;
    }
  }

  return {
    stages: out,
    total: deals.length,
    won,
    lost,
    open: deals.length - won - lost,
    winRate: pct(won, deals.length),
    avgDaysToWin: won > 0 ? round1(winDays / won) : null,
    biggestDropStageId: biggest,
  };
}

export const JOURNEY_RANGES = ['30d', '90d', 'quarter', '12m', 'all'] as const;
export type JourneyRange = (typeof JOURNEY_RANGES)[number];

function rangeStart(range: JourneyRange, now = new Date()): string | null {
  if (range === 'all') return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === 'quarter') {
    d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3, 1);
  } else {
    const n = range === '30d' ? 29 : range === '90d' ? 89 : 364;
    d.setUTCDate(d.getUTCDate() - n);
  }
  return d.toISOString().slice(0, 10) + ' 00:00:00';
}

/** Recorrido de los deals de un pipeline creados en el rango. */
export async function dealJourney(
  userId: string,
  opts: { pipelineId: string; range?: JourneyRange; ownerId?: string; mode?: JourneyMode; scope?: OwnerScope },
  db: Db = getDb(),
): Promise<JourneyResult> {
  const stages = (await db
    .prepare(
      `SELECT s.id, s.name, s.is_won, s.is_lost FROM crm_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id
       WHERE s.pipeline_id = ? AND p.user_id = ? ORDER BY s.position ASC`,
    )
    .all(opts.pipelineId, userId)) as JourneyStageInput[];
  if (!stages.length) return journeyMath([], []);

  const where = ['d.user_id = ?', 'd.pipeline_id = ?'];
  const args: string[] = [userId, opts.pipelineId];
  const from = rangeStart(opts.range ?? '90d');
  if (from) {
    where.push('d.created_at >= ?');
    args.push(from);
  }
  if (opts.ownerId) {
    where.push('COALESCE(d.owner_id, d.user_id) = ?');
    args.push(opts.ownerId);
  }
  const sc = scopeAnd('d', opts.scope);
  const rows = (await db
    .prepare(
      `SELECT d.id, d.stage_id, h.stage_id AS h_stage, h.entered_at, h.exited_at
       FROM crm_deals d LEFT JOIN crm_deal_stage_history h ON h.deal_id = d.id
       WHERE ${where.join(' AND ')}${sc.sql}
       ORDER BY d.id, h.entered_at ASC, h.rowid ASC`,
    )
    .all(...args, ...sc.args)) as Array<{ id: string; stage_id: string; h_stage: string | null; entered_at: string | null; exited_at: string | null }>;

  const deals = new Map<string, JourneyDealInput>();
  for (const r of rows) {
    let d = deals.get(r.id);
    if (!d) {
      d = { id: r.id, stage_id: r.stage_id, entries: [] };
      deals.set(r.id, d);
    }
    if (r.h_stage && r.entered_at) d.entries.push({ stage_id: r.h_stage, entered_at: r.entered_at, exited_at: r.exited_at });
  }
  // Un deal sin historial (no debería pasar) cuenta en su etapa actual.
  for (const d of deals.values()) {
    if (!d.entries.length) d.entries.push({ stage_id: d.stage_id, entered_at: '', exited_at: null });
  }
  return journeyMath(stages, [...deals.values()], opts.mode ?? 'cumulative');
}

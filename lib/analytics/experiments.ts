/**
 * Experimentos (A/B) sobre un flag multivariante: quién vio cada variante sale
 * de `$feature_flag_called` (lo manda el snippet al leer el flag) y cada
 * métrica se mide después de la primera exposición de cada persona. Quien vio
 * más de una variante queda afuera. Server-only.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db';
import { conversionStats, meanStats, sampleRatioMismatch } from './compute-more';
import { filtersSql, needsPerson, numericProp, personJoins, PERSON_KEY } from './sql-build';
import { experimentMetricSchema, type ExperimentDto, type ExperimentMetric, type ExperimentMetricResult, type ExperimentResults, type FlagVariant } from './types';
import { getFlag, updateFlag } from './records';
import { ROW_CAP } from './query';

interface Row {
  id: string;
  flag_id: string;
  flag_key: string | null;
  name: string;
  hypothesis: string;
  metrics: string;
  status: string;
  started_at: number | null;
  ended_at: number | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
}

function toDto(r: Row): ExperimentDto {
  let metrics: ExperimentMetric[] = [];
  try {
    metrics = z.array(experimentMetricSchema).parse(JSON.parse(r.metrics));
  } catch {
    metrics = [];
  }
  return {
    id: r.id,
    name: r.name,
    hypothesis: r.hypothesis,
    flagId: r.flag_id,
    flagKey: r.flag_key ?? '',
    metrics,
    status: r.status as ExperimentDto['status'],
    startedAt: r.started_at === null ? null : Number(r.started_at),
    endedAt: r.ended_at === null ? null : Number(r.ended_at),
    conclusion: r.conclusion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SELECT = 'SELECT x.*, f.key AS flag_key FROM analytics_experiments x LEFT JOIN analytics_flags f ON f.id = x.flag_id';

export async function listExperiments(projectId: string): Promise<ExperimentDto[]> {
  const rows = await getDb().prepare(`${SELECT} WHERE x.project_id = ? ORDER BY x.updated_at DESC LIMIT 200`).all(projectId);
  return (rows as unknown as Row[]).map(toDto);
}

export async function getExperiment(projectId: string, id: string): Promise<ExperimentDto | null> {
  const r = (await getDb().prepare(`${SELECT} WHERE x.id = ? AND x.project_id = ?`).get(id, projectId)) as Row | undefined;
  return r ? toDto(r) : null;
}

export async function createExperiment(
  projectId: string,
  personId: string,
  input: { name: string; hypothesis: string; flagId: string; metrics: ExperimentMetric[] },
): Promise<ExperimentDto | 'flag_not_found' | 'flag_not_multivariate'> {
  const flag = await getFlag(projectId, input.flagId);
  if (!flag) return 'flag_not_found';
  if (flag.variants.length < 2) return 'flag_not_multivariate';
  const id = `ax_${nanoid(12)}`;
  const ts = new Date().toISOString();
  await getDb()
    .prepare('INSERT INTO analytics_experiments (id, project_id, flag_id, name, hypothesis, metrics, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, input.flagId, input.name, input.hypothesis, JSON.stringify(input.metrics), personId, ts, ts);
  return (await getExperiment(projectId, id))!;
}

export async function updateExperiment(projectId: string, id: string, patch: { name?: string; hypothesis?: string; metrics?: ExperimentMetric[]; conclusion?: string | null }): Promise<ExperimentDto | null> {
  const cur = await getExperiment(projectId, id);
  if (!cur) return null;
  await getDb()
    .prepare('UPDATE analytics_experiments SET name = ?, hypothesis = ?, metrics = ?, conclusion = ?, updated_at = ? WHERE id = ? AND project_id = ?')
    .run(patch.name ?? cur.name, patch.hypothesis ?? cur.hypothesis, JSON.stringify(patch.metrics ?? cur.metrics), patch.conclusion === undefined ? cur.conclusion : patch.conclusion, new Date().toISOString(), id, projectId);
  return getExperiment(projectId, id);
}

export async function setExperimentFlag(projectId: string, id: string, flagId: string): Promise<void> {
  await getDb().prepare("UPDATE analytics_experiments SET flag_id = ?, updated_at = ? WHERE id = ? AND project_id = ? AND status = 'draft'").run(flagId, new Date().toISOString(), id, projectId);
}

export async function deleteExperiment(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_experiments WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

/** Empieza (prende el flag) o termina. Una vez terminado no se vuelve a empezar: las fechas son las del análisis. */
export async function setExperimentStatus(projectId: string, id: string, action: 'start' | 'stop', now = Date.now()): Promise<ExperimentDto | 'invalid_state' | null> {
  const cur = await getExperiment(projectId, id);
  if (!cur) return null;
  if (action === 'start') {
    if (cur.status !== 'draft') return 'invalid_state';
    await getDb().prepare("UPDATE analytics_experiments SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'").run(now, new Date(now).toISOString(), id);
    await updateFlag(projectId, cur.flagId, { active: true });
  } else {
    if (cur.status !== 'running') return 'invalid_state';
    await getDb().prepare("UPDATE analytics_experiments SET status = 'stopped', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(now, new Date(now).toISOString(), id);
  }
  return getExperiment(projectId, id);
}

/** Lleva a todo el mundo a una variante: el flag queda con esa variante al 100 %. */
export async function shipVariant(projectId: string, id: string, variant: string): Promise<ExperimentDto | 'invalid_variant' | null> {
  const cur = await getExperiment(projectId, id);
  if (!cur) return null;
  const flag = await getFlag(projectId, cur.flagId);
  if (!flag || !flag.variants.some((v) => v.key === variant)) return 'invalid_variant';
  const variants: FlagVariant[] = flag.variants.map((v) => ({ key: v.key, rollout: v.key === variant ? 100 : 0 }));
  await updateFlag(projectId, cur.flagId, { variants, active: true, rollout: 100, groups: [], conditions: [] });
  return updateExperiment(projectId, id, { conclusion: variant });
}

/** Experimentos que usan un flag (un flag en uso no se puede borrar). */
export async function experimentsUsingFlag(projectId: string, flagId: string): Promise<number> {
  const r = (await getDb().prepare('SELECT COUNT(*) AS n FROM analytics_experiments WHERE project_id = ? AND flag_id = ?').get(projectId, flagId)) as { n: number };
  return Number(r.n);
}

/** Resultados del experimento: exposiciones por variante y cada métrica. */
export async function experimentResults(projectId: string, exp: ExperimentDto, now = Date.now()): Promise<ExperimentResults> {
  const flag = await getFlag(projectId, exp.flagId);
  const variants = flag?.variants ?? [];
  const empty: ExperimentResults = { exposedTotal: 0, multipleVariants: 0, sampleMismatch: false, metrics: [], truncated: false };
  if (!exp.startedAt || !flag) return empty;
  const from = exp.startedAt;
  const to = exp.endedAt ?? now;
  const db = getDb();

  const exposures = (await db
    .prepare(
      `SELECT ${PERSON_KEY} AS person, CAST(json_extract(e.properties, '$."$feature_flag_response"') AS TEXT) AS variant, MIN(e.ts) AS first
       FROM analytics_events e ${personJoins(false)}
       WHERE e.project_id = ? AND e.event = '$feature_flag_called' AND e.ts >= ? AND e.ts <= ? AND json_extract(e.properties, '$."$feature_flag"') = ?
       GROUP BY 1, 2 LIMIT ?`,
    )
    .all(projectId, from, to, flag.key, ROW_CAP + 1)) as Array<{ person: string; variant: string | null; first: number }>;
  const truncated = exposures.length > ROW_CAP;
  const keys = new Set(variants.map((v) => v.key));
  const seen = new Map<string, { variant: string; first: number; multiple: boolean }>();
  for (const r of exposures.slice(0, ROW_CAP)) {
    const variant = String(r.variant ?? '');
    if (!keys.has(variant)) continue;
    const person = String(r.person);
    const prev = seen.get(person);
    if (prev) prev.multiple = true;
    else seen.set(person, { variant, first: Number(r.first), multiple: false });
  }
  const assigned = new Map<string, { variant: string; first: number }>();
  let multipleVariants = 0;
  for (const [person, v] of seen) {
    if (v.multiple) multipleVariants++;
    else assigned.set(person, v);
  }
  const exposedBy = new Map<string, number>(variants.map((v) => [v.key, 0]));
  for (const v of assigned.values()) exposedBy.set(v.variant, (exposedBy.get(v.variant) ?? 0) + 1);

  const metrics: ExperimentMetricResult[] = [];
  let cut = truncated;
  for (const metric of exp.metrics) {
    const f = filtersSql(metric.filters);
    const withValue = metric.type === 'mean' && metric.mathProperty;
    const value = withValue ? numericProp(metric.mathProperty!) : { sql: '1', args: [] };
    const rows = (await db
      .prepare(
        `SELECT ${PERSON_KEY} AS person, e.ts AS ts, ${value.sql} AS v FROM analytics_events e ${personJoins(needsPerson(metric.filters))}
         WHERE e.project_id = ? AND e.ts >= ? AND e.ts <= ?${metric.event === '*' ? '' : ' AND e.event = ?'}${f.sql ? ` AND ${f.sql}` : ''} LIMIT ?`,
      )
      .all(...value.args, projectId, from, to, ...(metric.event === '*' ? [] : [metric.event]), ...f.args, ROW_CAP + 1)) as Array<{ person: string; ts: number; v: number | null }>;
    cut = cut || rows.length > ROW_CAP;
    // Por persona: solo lo que pasó después de su primera exposición.
    const byPerson = new Map<string, number>();
    for (const r of rows.slice(0, ROW_CAP)) {
      const a = assigned.get(String(r.person));
      if (!a || Number(r.ts) < a.first) continue;
      byPerson.set(String(r.person), (byPerson.get(String(r.person)) ?? 0) + Number(r.v ?? 0));
    }
    const agg = new Map<string, { conversions: number; sum: number; sumSquares: number }>(variants.map((v) => [v.key, { conversions: 0, sum: 0, sumSquares: 0 }]));
    for (const [person, total] of byPerson) {
      const g = agg.get(assigned.get(person)!.variant);
      if (!g) continue;
      g.conversions++;
      g.sum += total;
      g.sumSquares += total * total;
    }
    // Control va primero: el cambio se mide contra ella.
    const ordered = [...variants].sort((a, b) => (a.key === 'control' ? -1 : b.key === 'control' ? 1 : 0));
    const stats =
      metric.type === 'conversion'
        ? conversionStats(ordered.map((v) => ({ key: v.key, exposed: exposedBy.get(v.key) ?? 0, conversions: agg.get(v.key)?.conversions ?? 0 })))
        : meanStats(ordered.map((v) => ({ key: v.key, exposed: exposedBy.get(v.key) ?? 0, sum: agg.get(v.key)?.sum ?? 0, sumSquares: agg.get(v.key)?.sumSquares ?? 0 })));
    const best = stats.reduce((a, b) => (b.chanceBest > a.chanceBest ? b : a), stats[0]);
    const enough = stats.every((s) => s.exposed >= 20);
    metrics.push({ metric, variants: stats, winner: best && enough && best.chanceBest >= 0.95 ? best.key : null });
  }
  const totalShare = variants.reduce((a, v) => a + v.rollout, 0) || 1;
  return {
    exposedTotal: assigned.size,
    multipleVariants,
    sampleMismatch: sampleRatioMismatch(variants.map((v) => exposedBy.get(v.key) ?? 0), variants.map((v) => v.rollout / totalShare)),
    metrics,
    truncated: cut,
  };
}

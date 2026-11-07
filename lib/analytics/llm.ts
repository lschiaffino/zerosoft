/**
 * LLM de Analytics: $ai_generation con los nombres de PostHog. Los números los
 * informa el cliente: se leen con filas acotadas y se limpian en llm-core.
 * Server-only.
 */
import { getDb } from '../db';
import { resolveRange } from './compute';
import { clampNumber, cleanLabel, computeLlm, latencyMs, LLM_MAX, truthy, type LlmRow } from './llm-core';
import type { ProjectRow } from './projects';
import type { LlmGeneration, LlmGenerationDetail, LlmOverview, LlmTrace } from './more-types';
import { projectTz } from './tz';

export const LLM_ROW_CAP = 50_000;
const TEXT_CAP = 8000;

const j = (key: string, alias = 'e') => `json_extract(${alias}.properties, '$."${key}"')`;

export async function llmOverview(project: ProjectRow, query: { from?: string }, now = Date.now()): Promise<LlmOverview> {
  const tz = projectTz(project);
  const range = resolveRange({ from: query.from ?? '-30d' }, now, tz);
  const rows = (await getDb()
    .prepare(
      `SELECT e.ts AS ts, ${j('$ai_model')} AS model, ${j('$ai_provider')} AS provider, ${j('$ai_input_tokens')} AS input, ${j('$ai_output_tokens')} AS output,
              ${j('$ai_total_cost_usd')} AS cost, ${j('$ai_latency')} AS latency, ${j('$ai_is_error')} AS error
       FROM analytics_events e WHERE e.project_id = ? AND e.event = '$ai_generation' AND e.ts >= ? AND e.ts <= ? ORDER BY e.ts DESC LIMIT ?`,
    )
    .all(project.id, range.from, range.to, LLM_ROW_CAP + 1)) as unknown as LlmRow[];
  return computeLlm(rows.slice(0, LLM_ROW_CAP), range, tz, rows.length > LLM_ROW_CAP);
}

function toGeneration(r: Record<string, unknown>): LlmGeneration {
  return {
    id: Number(r.id),
    ts: Number(r.ts),
    model: cleanLabel(r.model) ?? '(unknown)',
    provider: cleanLabel(r.provider),
    traceId: cleanLabel(r.trace, 200),
    distinctId: String(r.distinct_id),
    inputTokens: clampNumber(r.input, LLM_MAX.tokens),
    outputTokens: clampNumber(r.output, LLM_MAX.tokens),
    costUsd: clampNumber(r.cost, LLM_MAX.costUsd),
    latencyMs: latencyMs(r.latency),
    isError: truthy(r.error),
  };
}

const GENERATION_COLS = `e.id AS id, e.ts AS ts, e.distinct_id AS distinct_id, ${j('$ai_model')} AS model, ${j('$ai_provider')} AS provider, ${j('$ai_trace_id')} AS trace,
  ${j('$ai_input_tokens')} AS input, ${j('$ai_output_tokens')} AS output, ${j('$ai_total_cost_usd')} AS cost, ${j('$ai_latency')} AS latency, ${j('$ai_is_error')} AS error`;

export interface GenerationQuery {
  from?: string;
  model?: string | null;
  trace?: string | null;
  errorsOnly?: boolean;
  before?: number | null;
  limit?: number;
}

/** Generaciones, lo más nuevo primero, con cursor por id. */
export async function llmGenerations(project: ProjectRow, q: GenerationQuery, now = Date.now()): Promise<{ generations: LlmGeneration[]; nextBefore: number | null }> {
  const range = resolveRange({ from: q.from ?? '-30d' }, now, projectTz(project));
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
  const parts = [`e.project_id = ?`, `e.event = '$ai_generation'`, 'e.ts >= ?', 'e.ts <= ?'];
  const args: Array<string | number> = [project.id, range.from, range.to];
  if (q.before) {
    parts.push('e.id < ?');
    args.push(q.before);
  }
  if (q.model) {
    parts.push(`${j('$ai_model')} = ?`);
    args.push(q.model.slice(0, 100));
  }
  if (q.trace) {
    parts.push(`${j('$ai_trace_id')} = ?`);
    args.push(q.trace.slice(0, 200));
  }
  if (q.errorsOnly) parts.push(`${j('$ai_is_error')} IN (1, 'true', '1')`);
  const rows = (await getDb()
    .prepare(`SELECT ${GENERATION_COLS} FROM analytics_events e WHERE ${parts.join(' AND ')} ORDER BY e.id DESC LIMIT ?`)
    .all(...args, limit + 1)) as Array<Record<string, unknown>>;
  const page = rows.slice(0, limit).map(toGeneration);
  return { generations: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
}

const num = (key: string, max: number) => `MIN(MAX(COALESCE(CAST(${j(key)} AS REAL), 0), 0), ${max})`;

/** Trazas del rango (una por $ai_trace_id), con totales. */
export async function llmTraces(project: ProjectRow, q: { from?: string }, now = Date.now()): Promise<LlmTrace[]> {
  const range = resolveRange({ from: q.from ?? '-30d' }, now, projectTz(project));
  const rows = (await getDb()
    .prepare(
      `SELECT trace, COUNT(*) AS n, SUM(input) AS input, SUM(output) AS output, SUM(cost) AS cost, SUM(err) AS errors, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM (
         SELECT e.ts AS ts, ${j('$ai_trace_id')} AS trace, ${num('$ai_input_tokens', LLM_MAX.tokens)} AS input, ${num('$ai_output_tokens', LLM_MAX.tokens)} AS output,
                ${num('$ai_total_cost_usd', LLM_MAX.costUsd)} AS cost, CASE WHEN ${j('$ai_is_error')} IN (1, 'true', '1') THEN 1 ELSE 0 END AS err
         FROM analytics_events e WHERE e.project_id = ? AND e.event = '$ai_generation' AND e.ts >= ? AND e.ts <= ? ORDER BY e.ts DESC LIMIT ${LLM_ROW_CAP}
       ) WHERE trace IS NOT NULL GROUP BY trace ORDER BY last_ts DESC LIMIT 100`,
    )
    .all(project.id, range.from, range.to)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    traceId: String(r.trace).slice(0, 200),
    generations: Number(r.n),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
    costUsd: Number(r.cost),
    errors: Number(r.errors),
    firstTs: Number(r.first_ts),
    lastTs: Number(r.last_ts),
  }));
}

function textOf(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let s: string;
  try {
    s = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  } catch {
    return null;
  }
  return s.length > TEXT_CAP ? `${s.slice(0, TEXT_CAP)}…` : s;
}

export async function llmGeneration(projectId: string, id: number): Promise<LlmGenerationDetail | null> {
  const r = (await getDb()
    .prepare(`SELECT ${GENERATION_COLS}, e.properties AS properties FROM analytics_events e WHERE e.id = ? AND e.project_id = ? AND e.event = '$ai_generation'`)
    .get(id, projectId)) as Record<string, unknown> | undefined;
  if (!r) return null;
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(String(r.properties ?? '{}'));
  } catch {
    props = {};
  }
  return { ...toGeneration(r), input: textOf(props.$ai_input), output: textOf(props.$ai_output_choices ?? props.$ai_output), errorText: textOf(props.$ai_error) };
}

/** Proyecto de una generación, solo si es de este workspace. Solo lee. */
export async function generationProjectId(id: number, workspaceId: string): Promise<string | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = (await getDb()
    .prepare(
      `SELECT e.project_id FROM analytics_events e JOIN analytics_projects p ON p.id = e.project_id
       WHERE e.id = ? AND e.event = '$ai_generation' AND p.workspace_id = ? AND p.deleted_at IS NULL`,
    )
    .get(id, workspaceId)) as { project_id: string } | undefined;
  return row?.project_id ?? null;
}

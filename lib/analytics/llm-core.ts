/**
 * LLM, la parte pura: las propiedades de $ai_generation las manda el cliente,
 * así que todo número se convierte, los negativos quedan en 0 y los absurdos en
 * un tope. Totales, por modelo y por día sobre filas ya acotadas.
 */
import { bucketList, bucketOf } from './compute';
import { percentile } from './web-core';
import type { LlmModelRow, LlmOverview, LlmTotals } from './more-types';

export const LLM_MAX = { tokens: 10_000_000, costUsd: 1000, latencySec: 3600 } as const;

/** Número del cliente → número finito entre 0 y `max` (0 si no es un número). */
export function clampNumber(raw: unknown, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (Number.isNaN(n) || n <= 0) return 0;
  return Math.min(n, max);
}

/** Latencia en segundos (como PostHog) → ms, o null si no vino o no es un número. */
export function latencyMs(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(Math.min(n, LLM_MAX.latencySec) * 1000);
}

export function truthy(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === 'true' || raw === '1';
}

export function cleanLabel(raw: unknown, max = 100): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim().slice(0, max);
  return s || null;
}

export interface LlmRow {
  ts: number;
  model: unknown;
  provider: unknown;
  input: unknown;
  output: unknown;
  cost: unknown;
  latency: unknown;
  error: unknown;
}

const emptyTotals = (): LlmTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, errors: 0 });

function add(t: LlmTotals, r: LlmRow): void {
  t.calls++;
  t.inputTokens += clampNumber(r.input, LLM_MAX.tokens);
  t.outputTokens += clampNumber(r.output, LLM_MAX.tokens);
  t.costUsd += clampNumber(r.cost, LLM_MAX.costUsd);
  if (truthy(r.error)) t.errors++;
}

export const LLM_MAX_MODELS = 50;

export function computeLlm(rows: readonly LlmRow[], range: { from: number; to: number }, tzOffsetMin: number, truncated: boolean): LlmOverview {
  const totals = emptyTotals();
  const models = new Map<string, { totals: LlmTotals; provider: string | null; latencies: number[] }>();
  const buckets = bucketList(range.from, range.to, 'day', tzOffsetMin);
  const index = new Map(buckets.map((b, i) => [b, i]));
  const callsPerDay = buckets.map(() => 0);
  const costPerDay = buckets.map(() => 0);
  for (const r of rows) {
    add(totals, r);
    const model = cleanLabel(r.model) ?? '(unknown)';
    let m = models.get(model);
    if (!m) {
      m = { totals: emptyTotals(), provider: cleanLabel(r.provider), latencies: [] };
      models.set(model, m);
    }
    add(m.totals, r);
    const l = latencyMs(r.latency);
    if (l !== null) m.latencies.push(l);
    const i = index.get(bucketOf(r.ts, 'day', tzOffsetMin));
    if (i !== undefined) {
      callsPerDay[i]++;
      costPerDay[i] += clampNumber(r.cost, LLM_MAX.costUsd);
    }
  }
  const list: LlmModelRow[] = [...models.entries()]
    .sort((a, b) => b[1].totals.calls - a[1].totals.calls || a[0].localeCompare(b[0]))
    .slice(0, LLM_MAX_MODELS)
    .map(([model, m]) => {
      const sorted = m.latencies.sort((a, b) => a - b);
      return { model, provider: m.provider, ...m.totals, p50LatencyMs: percentile(sorted, 50), p95LatencyMs: percentile(sorted, 95) };
    });
  return { totals, models: list, buckets, callsPerDay, costPerDay: costPerDay.map((c) => Math.round(c * 10000) / 10000), truncated };
}

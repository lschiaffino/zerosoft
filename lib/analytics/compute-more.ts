/**
 * Más cálculos puros de Analytics: fórmulas, percentiles, stickiness, ciclo de
 * vida, correlación de embudos, estadística de experimentos y CSV. Sin base.
 */
import type { CorrelationItem, ExperimentVariantResult, InsightResult } from './types';

// ---------- Fórmulas ----------

type Tok = { t: 'num'; v: number } | { t: 'var'; v: number } | { t: 'op'; v: string };

/** Separa una fórmula ('(A + B) / 2') en tokens. null si tiene otra cosa. */
function tokenize(src: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) return null;
      out.push({ t: 'num', v });
      i = j;
    } else if (/[A-Ea-e]/.test(c)) {
      out.push({ t: 'var', v: c.toUpperCase().charCodeAt(0) - 65 });
      i++;
    } else if ('+-*/()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else return null;
  }
  return out;
}

type Node = { n: number } | { s: number } | { neg: Node } | { op: string; a: Node; b: Node };

/** Parser descendente: expr = term (+|- term)*; term = factor (*|/ factor)*. null si está mal formada. */
export function parseFormula(src: string): Node | null {
  const parsed = tokenize(src);
  if (!parsed || !parsed.length || parsed.length > 200) return null;
  const toks: Tok[] = parsed;
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()?.v === v;
  function factor(depth: number): Node | null {
    if (depth > 30) return null;
    const k = peek();
    if (!k) return null;
    if (k.t === 'num') {
      p++;
      return { n: k.v };
    }
    if (k.t === 'var') {
      p++;
      return { s: k.v };
    }
    if (isOp('-')) {
      p++;
      const inner = factor(depth + 1);
      return inner ? { neg: inner } : null;
    }
    if (isOp('(')) {
      p++;
      const inner = expr(depth + 1);
      if (!inner || !isOp(')')) return null;
      p++;
      return inner;
    }
    return null;
  }
  function term(depth: number): Node | null {
    let a = factor(depth);
    while (a && (isOp('*') || isOp('/'))) {
      const op = String(toks[p++].v);
      const b = factor(depth);
      if (!b) return null;
      a = { op, a, b };
    }
    return a;
  }
  function expr(depth: number): Node | null {
    let a = term(depth);
    while (a && (isOp('+') || isOp('-'))) {
      const op = String(toks[p++].v);
      const b = term(depth);
      if (!b) return null;
      a = { op, a, b };
    }
    return a;
  }
  const root = expr(0);
  return root && p === toks.length ? root : null;
}

function evalNode(node: Node, vars: number[]): number {
  if ('n' in node) return node.n;
  if ('s' in node) return vars[node.s] ?? 0;
  if ('neg' in node) return -evalNode(node.neg, vars);
  const a = evalNode(node.a, vars);
  const b = evalNode(node.b, vars);
  switch (node.op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    default:
      // Dividir por 0 da 0 (una cubeta vacía no rompe el gráfico).
      return b === 0 ? 0 : a / b;
  }
}

export function round2(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/** Aplica la fórmula por cubeta sobre las series (A = 0). */
export function applyFormula(node: Node, series: number[][], len: number): number[] {
  return Array.from({ length: len }, (_, i) => round2(evalNode(node, series.map((s) => s[i] ?? 0))));
}

/** Evalúa la fórmula sobre valores sueltos (los totales de cada serie). */
export function formulaValue(node: Node, values: number[]): number {
  return round2(evalNode(node, values));
}

// ---------- Percentiles ----------

/** Percentil por interpolación lineal (p entre 0 y 1). Lista vacía: 0. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return round2(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}

export const PERCENTILE_OF: Record<string, number> = { median: 0.5, p75: 0.75, p90: 0.9, p95: 0.95, p99: 0.99 };

// ---------- Stickiness ----------

/** Filas (persona, intervalos activos) → cuánta gente estuvo activa exactamente n intervalos (índice n-1). */
export function stickinessHistogram(counts: number[], intervals: number): number[] {
  const out = new Array(intervals).fill(0) as number[];
  for (const c of counts) {
    const i = Math.min(Math.max(c, 1), intervals) - 1;
    out[i]++;
  }
  return out;
}

// ---------- Ciclo de vida ----------

export interface LifecycleSeries {
  new: number[];
  returning: number[];
  resurrecting: number[];
  dormant: number[];
}

/**
 * Por persona: sus cubetas activas y la cubeta de su primer evento de siempre.
 * `buckets` trae una cubeta antes del rango (la 0), que no se devuelve: sirve
 * para saber quién venía del intervalo anterior.
 * - new: es su primera cubeta;
 * - returning: activa ahora y en la anterior;
 * - resurrecting: activa ahora, no en la anterior y ya existía;
 * - dormant: activa en la anterior y no ahora (en negativo).
 */
export function computeLifecycle(rows: Array<{ person: string; bucket: string }>, firstSeen: Map<string, string>, buckets: string[]): LifecycleSeries {
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const byPerson = new Map<string, Set<number>>();
  for (const r of rows) {
    const i = idx.get(r.bucket);
    if (i === undefined) continue;
    let set = byPerson.get(r.person);
    if (!set) {
      set = new Set();
      byPerson.set(r.person, set);
    }
    set.add(i);
  }
  const n = buckets.length - 1;
  const out: LifecycleSeries = {
    new: new Array(n).fill(0),
    returning: new Array(n).fill(0),
    resurrecting: new Array(n).fill(0),
    dormant: new Array(n).fill(0),
  };
  for (const [person, set] of byPerson) {
    const first = firstSeen.get(person);
    for (let i = 1; i <= n; i++) {
      const now = set.has(i);
      const prev = set.has(i - 1);
      if (now && prev) out.returning[i - 1]++;
      else if (now && buckets[i] === first) out.new[i - 1]++;
      else if (now) out.resurrecting[i - 1]++;
      else if (prev) out.dormant[i - 1]--;
    }
  }
  return out;
}

// ---------- Correlación ----------

/**
 * Odds ratio con corrección de Haldane (+1 en cada celda, para no dividir por
 * 0) y si el intervalo del 95 % de su logaritmo no cruza el 0.
 */
export function oddsRatio(converted: number, dropped: number, totalConverted: number, totalDropped: number): { odds: number; significant: boolean } {
  const a = converted + 1;
  const b = Math.max(totalConverted - converted, 0) + 1;
  const c = dropped + 1;
  const d = Math.max(totalDropped - dropped, 0) + 1;
  const odds = (a / b) / (c / d);
  const se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  return { odds: Math.round(odds * 1000) / 1000, significant: Math.abs(Math.log(odds)) / se >= 1.96 };
}

/**
 * Ocurrencias (persona, nombre) → los que más empujan a convertir y los que
 * más alejan. Cada persona cuenta una vez por nombre.
 */
export function correlate(
  rows: Array<{ person: string; name: string }>,
  converted: ReadonlySet<string>,
  dropped: ReadonlySet<string>,
  kind: CorrelationItem['kind'],
  limit = 10,
): { positive: CorrelationItem[]; negative: CorrelationItem[] } {
  const seen = new Map<string, { c: Set<string>; d: Set<string> }>();
  for (const r of rows) {
    const isC = converted.has(r.person);
    if (!isC && !dropped.has(r.person)) continue;
    let e = seen.get(r.name);
    if (!e) {
      e = { c: new Set(), d: new Set() };
      seen.set(r.name, e);
    }
    (isC ? e.c : e.d).add(r.person);
  }
  const items: CorrelationItem[] = [];
  for (const [name, e] of seen) {
    if (e.c.size + e.d.size < 2) continue;
    const { odds, significant } = oddsRatio(e.c.size, e.d.size, converted.size, dropped.size);
    items.push({ name, kind, converted: e.c.size, dropped: e.d.size, odds, significant });
  }
  const positive = items.filter((i) => i.odds > 1).sort((a, b) => b.odds - a.odds || a.name.localeCompare(b.name)).slice(0, limit);
  const negative = items.filter((i) => i.odds < 1).sort((a, b) => a.odds - b.odds || a.name.localeCompare(b.name)).slice(0, limit);
  return { positive, negative };
}

// ---------- Caminos ----------

/** /orders/123 y /orders/9f8a7b6c5d4e → /orders/:id (ids numéricos, uuid o hex largos). */
export function collapsePath(path: string): string {
  return path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8,}(-[0-9a-f]{4,})*$/i.test(seg) ? ':id' : seg))
    .join('/');
}

// ---------- Experimentos ----------

/** Generador con semilla (mulberry32): el mismo resultado en cada corrida. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Muestra de una Gamma(k, 1) (Marsaglia y Tsang). */
function sampleGamma(k: number, r: () => number): number {
  if (k < 1) return sampleGamma(k + 1, r) * Math.pow(Math.max(r(), 1e-12), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = gauss(r);
    const v0 = 1 + c * x;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    const u = Math.max(r(), 1e-12);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

function sampleBeta(a: number, b: number, r: () => number): number {
  const x = sampleGamma(a, r);
  const y = sampleGamma(b, r);
  return x / (x + y);
}

const SAMPLES = 10_000;

function bestShare(draws: number[][]): number[] {
  const wins = new Array(draws.length).fill(0) as number[];
  for (let i = 0; i < SAMPLES; i++) {
    let best = 0;
    for (let v = 1; v < draws.length; v++) if (draws[v][i] > draws[best][i]) best = v;
    wins[best]++;
  }
  return wins.map((w) => w / SAMPLES);
}

/** Bayesiano sobre tasas: cada variante con una Beta(1 + conv, 1 + exp - conv). La primera es control. */
export function conversionStats(variants: Array<{ key: string; exposed: number; conversions: number }>): ExperimentVariantResult[] {
  const r = rng(42);
  const draws = variants.map((v) => {
    const conv = Math.min(v.conversions, v.exposed);
    const a = 1 + conv;
    const b = 1 + v.exposed - conv;
    return Array.from({ length: SAMPLES }, () => sampleBeta(a, b, r));
  });
  const share = bestShare(draws);
  const control = variants[0] && variants[0].exposed ? variants[0].conversions / variants[0].exposed : 0;
  return variants.map((v, i) => {
    const sorted = [...draws[i]].sort((x, y) => x - y);
    const rate = v.exposed ? Math.min(v.conversions, v.exposed) / v.exposed : 0;
    return {
      key: v.key,
      exposed: v.exposed,
      value: v.conversions,
      rate,
      low: sorted[Math.floor(SAMPLES * 0.025)],
      high: sorted[Math.floor(SAMPLES * 0.975)],
      chanceBest: share[i],
      uplift: i === 0 || control === 0 ? null : (rate - control) / control,
    };
  });
}

/** Medias por persona con aproximación normal: posterior N(media, var/n). Valores por persona (los no activos, 0). */
export function meanStats(variants: Array<{ key: string; exposed: number; sum: number; sumSquares: number }>): ExperimentVariantResult[] {
  const r = rng(43);
  const stats = variants.map((v) => {
    const n = Math.max(v.exposed, 1);
    const mean = v.sum / n;
    const variance = Math.max(v.sumSquares / n - mean * mean, 0);
    return { mean, se: Math.sqrt(variance / n) };
  });
  const draws = stats.map((s) => Array.from({ length: SAMPLES }, () => s.mean + s.se * gauss(r)));
  const share = bestShare(draws);
  const control = stats[0]?.mean ?? 0;
  return variants.map((v, i) => ({
    key: v.key,
    exposed: v.exposed,
    value: round2(v.sum),
    rate: stats[i].mean,
    low: stats[i].mean - 1.96 * stats[i].se,
    high: stats[i].mean + 1.96 * stats[i].se,
    chanceBest: share[i],
    uplift: i === 0 || control === 0 ? null : (stats[i].mean - control) / control,
  }));
}

/** Chi cuadrado del reparto contra lo configurado: true si p < 0.001 (hay un problema de asignación). */
export function sampleRatioMismatch(observed: number[], expectedShares: number[]): boolean {
  const total = observed.reduce((a, b) => a + b, 0);
  if (total < 100 || observed.length < 2 || observed.length !== expectedShares.length) return false;
  let chi = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = total * expectedShares[i];
    if (e > 0) chi += ((observed[i] - e) ** 2) / e;
  }
  // Valores críticos de chi² con p = 0.001 según los grados de libertad.
  const CRITICAL = [10.83, 13.82, 16.27, 18.47, 20.52, 22.46, 24.32, 26.12, 27.88];
  return chi > (CRITICAL[observed.length - 2] ?? 30);
}

// ---------- CSV ----------

/** Celda de CSV: comillas y, para que Excel no la ejecute, nada que arranque como fórmula. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLines(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

/** Resultado de un insight como filas de CSV. */
export function resultRows(r: InsightResult): unknown[][] {
  switch (r.kind) {
    case 'trends':
      return [
        ['series', 'breakdown', ...r.buckets, 'total'],
        ...r.series.map((s) => [s.label, s.breakdownValue ?? '', ...s.data, s.total]),
      ];
    case 'funnel':
      return [
        ['step', 'event', 'count', 'conversion', 'from_previous', 'dropped', 'median_ms'],
        ...r.steps.map((s, i) => [i + 1, s.label, s.count, round4(s.conversion), round4(s.stepConversion), s.dropped, s.medianMs ?? '']),
      ];
    case 'retention': {
      const n = r.cohorts.length;
      return [
        ['cohort', 'people', ...Array.from({ length: n }, (_, k) => `${r.period}_${k}`)],
        ...r.cohorts.map((c) => [c.start, c.size, ...Array.from({ length: n }, (_, k) => c.values[k] ?? '')]),
      ];
    }
    case 'paths':
      return [['step', 'from', 'to', 'sessions'], ...r.links.map((l) => [l.step + 1, l.from, l.to, l.count])];
    case 'sql':
      return [r.columns, ...r.rows];
    case 'stickiness':
      return [
        ['series', ...Array.from({ length: r.intervals }, (_, i) => `${i + 1}`), 'total'],
        ...r.series.map((s) => [s.label, ...s.data, s.total]),
      ];
    case 'lifecycle':
      return [
        ['bucket', 'new', 'returning', 'resurrecting', 'dormant'],
        ...r.buckets.map((b, i) => [b, r.new[i], r.returning[i], r.resurrecting[i], r.dormant[i]]),
      ];
  }
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

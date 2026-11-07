/**
 * Cálculo de embudos, sin base de datos. Sigue la documentación de PostHog
 * (docs/product-analytics/funnels):
 *
 * - Orden secuencial (puede haber otros eventos en el medio), estricto (el paso
 *   siguiente tiene que ser el evento inmediato) o cualquiera.
 * - Exclusiones: quien hace el evento entre dos pasos queda afuera de todo el
 *   embudo. Una conversión completa anterior no se pierde; en cualquier orden
 *   rigen entre el primer y el último paso.
 * - Apertura con atribución: primer valor visto, último valor visto, todos los
 *   pasos (la persona cuenta en cada valor, con los pasos que hizo con ese valor)
 *   o el valor de un paso (sin valor en ese paso, no entra al embudo).
 */

import { bucketOf, bucketList } from './compute';
import type { FunnelPathMode, Interval } from './types';
import type { Tz } from './tz';

export type FunnelOrder = 'ordered' | 'strict' | 'unordered';
export type FunnelAttribution = 'first' | 'last' | 'all' | 'step';

export interface FunnelRow {
  /** Persona, sesión o grupo que se cuenta. */
  person: string;
  /** Índices de los pasos que este evento cumple (un evento puede servir a más de uno). */
  steps: number[];
  ts: number;
  /** Índices de las exclusiones que este evento cumple. */
  excl?: number[];
  /** Valor de la apertura en este evento. */
  value?: string | null;
  /** Persona dueña, cuando lo que se cuenta son sesiones. */
  owner?: string;
}

export interface FunnelOptions {
  order?: FunnelOrder;
  exclusions?: Array<{ fromStep: number; toStep: number }>;
  droppedLimit?: number;
  attribution?: FunnelAttribution | null;
  attributionStep?: number;
  /** Devolver los tiempos de cada persona (para caminos desde un paso). */
  collectTimes?: boolean;
  /** Cubetas por fecha de entrada al embudo (gráfico histórico). */
  historical?: { interval: Interval; tz: Tz; now: number } | null;
}

export interface TimeBin {
  fromMs: number;
  toMs: number;
  count: number;
}

export interface FunnelTime {
  /** Índices de paso. */
  fromStep: number;
  toStep: number;
  count: number;
  avgMs: number | null;
  medianMs: number | null;
  bins: TimeBin[];
}

export interface FunnelComputed {
  counts: number[];
  /** Mediana de tiempo entre el paso i-1 y el i (ms); null en el primero o sin datos. */
  medians: Array<number | null>;
  /** Personas que llegaron al paso i y no al i+1. */
  dropped: string[][];
  /** Personas que llegaron al último paso. */
  converted: string[];
  /** Personas que llegaron al paso i (hasta el límite). */
  reached: string[][];
  /** Tiempos: cada par de pasos seguidos y, al final, del primero al último. */
  times: FunnelTime[];
  /** Valores de la apertura, ordenados por cuántos entraron. */
  breakdown: Array<{ value: string | null; counts: number[] }>;
  historical: Array<{ bucket: string; counts: number[]; incomplete: boolean }> | null;
  personTimes?: Map<string, number[]>;
}

/**
 * Qué parte de la actividad de una persona mira un camino desde un paso `k` del
 * embudo (0 es el primero). null: esa persona no entra. Abandonar en `k` es
 * haber llegado al paso anterior y no a `k`.
 */
export function pathWindow(mode: FunnelPathMode, k: number, times: number[]): { from: number; to: number } | null {
  const reached = times.length;
  const any = { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY };
  switch (mode) {
    case 'before':
      return reached > k ? { ...any, to: times[k] } : null;
    case 'between':
      return k >= 1 && reached > k ? { from: times[k - 1], to: times[k] } : null;
    case 'after':
      return reached > k ? { ...any, from: times[k] } : null;
    case 'after_dropoff':
      return k >= 1 && reached === k ? { ...any, from: times[k - 1] } : null;
    case 'before_dropoff':
      return k >= 1 && reached === k ? { ...any, to: times[k - 1] } : null;
  }
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

interface Attempt {
  reached: number;
  times: number[];
  /** Índice del evento usado en cada paso. */
  used: number[];
  excluded: boolean;
}

function sequentialAttempt(events: FunnelRow[], s: number, n: number, windowMs: number, strict: boolean, exclusions: Array<{ fromStep: number; toStep: number }>): Attempt {
  const start = events[s];
  const times = [start.ts];
  const used = [s];
  let step = 1;
  for (let k = s + 1; k < events.length && step < n; k++) {
    const ev = events[k];
    if (ev.ts - start.ts > windowMs) break;
    if (ev.excl?.some((x) => exclusions[x] && exclusions[x].fromStep <= step - 1 && step <= exclusions[x].toStep)) {
      return { reached: step, times, used, excluded: true };
    }
    if (ev.steps.includes(step)) {
      times.push(ev.ts);
      used.push(k);
      step++;
    } else if (strict) {
      break;
    }
  }
  return { reached: step, times, used, excluded: false };
}

/** Cualquier orden: cuántos pasos distintos se cumplen con eventos distintos (asignación por caminos de aumento). */
function unorderedAttempt(events: FunnelRow[], s: number, n: number, windowMs: number, hasExclusions: boolean): Attempt {
  const start = events[s];
  const owner = new Array<number>(n).fill(-1);
  const times: number[] = [];
  const used: number[] = [];
  const tryAssign = (k: number, seen: Set<number>): boolean => {
    for (const st of events[k].steps) {
      if (seen.has(st)) continue;
      seen.add(st);
      if (owner[st] === -1 || tryAssign(owner[st], seen)) {
        owner[st] = k;
        return true;
      }
    }
    return false;
  };
  for (let k = s; k < events.length && times.length < n; k++) {
    const ev = events[k];
    if (ev.ts - start.ts > windowMs) break;
    if (hasExclusions && ev.excl?.length) return { reached: times.length, times, used, excluded: true };
    if (ev.steps.length && tryAssign(k, new Set())) {
      times.push(ev.ts);
      used.push(k);
    }
  }
  return { reached: times.length, times, used, excluded: false };
}

/**
 * Por persona: cada evento que abre el embudo arranca un intento y gana el que
 * más lejos llega. Devuelve también si quedó excluida.
 */
function bestAttempt(events: FunnelRow[], n: number, windowMs: number, order: FunnelOrder, exclusions: Array<{ fromStep: number; toStep: number }>): Attempt {
  let best: Attempt = { reached: 0, times: [], used: [], excluded: false };
  for (let s = 0; s < events.length && best.reached < n; s++) {
    const a = opens(events[s], order) ? attemptAt(events, s, n, windowMs, order, exclusions) : null;
    if (!a) continue;
    if (a.excluded) return { ...a, reached: 0, excluded: true };
    if (a.reached > best.reached) best = a;
  }
  return best;
}

const opens = (ev: FunnelRow, order: FunnelOrder) => (order === 'unordered' ? ev.steps.length > 0 : ev.steps.includes(0));

function attemptAt(events: FunnelRow[], s: number, n: number, windowMs: number, order: FunnelOrder, exclusions: Array<{ fromStep: number; toStep: number }>): Attempt {
  return order === 'unordered' ? unorderedAttempt(events, s, n, windowMs, exclusions.length > 0) : sequentialAttempt(events, s, n, windowMs, order === 'strict', exclusions);
}

/** Hasta 12 cubetas parejas entre el mínimo y el máximo. */
export function timeBins(xs: number[], maxBins = 12): TimeBin[] {
  if (!xs.length) return [];
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (min === max) return [{ fromMs: min, toMs: max, count: xs.length }];
  const nBins = Math.min(maxBins, Math.max(2, Math.ceil(Math.sqrt(xs.length))));
  const width = Math.ceil((max - min) / nBins) || 1;
  const bins: TimeBin[] = Array.from({ length: nBins }, (_, i) => ({ fromMs: min + i * width, toMs: min + (i + 1) * width, count: 0 }));
  for (const x of xs) bins[Math.min(nBins - 1, Math.floor((x - min) / width))].count++;
  return bins;
}

function timeStats(fromStep: number, toStep: number, xs: number[]): FunnelTime {
  return {
    fromStep,
    toStep,
    count: xs.length,
    avgMs: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null,
    medianMs: median(xs),
    bins: timeBins(xs),
  };
}

const BREAKDOWN_LIMIT = 25;
const OTHER = '$other';

/** Las filas vienen ordenadas por persona y tiempo, y ya dentro del rango de fechas. */
export function computeFunnel(rows: FunnelRow[], nSteps: number, windowMs: number, range: { from: number; to: number }, optsOrLimit: FunnelOptions | number = {}): FunnelComputed {
  const opts: FunnelOptions = typeof optsOrLimit === 'number' ? { droppedLimit: optsOrLimit } : optsOrLimit;
  const order = opts.order ?? 'ordered';
  // En cualquier orden no hay "entre dos pasos": la exclusión rige en todo el embudo.
  const exclusions = opts.exclusions ?? [];
  const limit = opts.droppedLimit ?? 100;
  const counts = new Array<number>(nSteps).fill(0);
  const gaps: number[][] = Array.from({ length: nSteps }, () => []);
  const totals: number[] = [];
  const dropped: string[][] = Array.from({ length: nSteps }, () => []);
  const reached: string[][] = Array.from({ length: nSteps }, () => []);
  const converted: string[] = [];
  const byValue = new Map<string | null, number[]>();
  const addValue = (value: string | null, steps: number) => {
    let c = byValue.get(value);
    if (!c) {
      c = new Array<number>(nSteps).fill(0);
      byValue.set(value, c);
    }
    for (let s = 0; s < steps; s++) c[s]++;
  };
  const hist = opts.historical ? new Map<string, number[]>() : null;
  const personTimes = opts.collectTimes ? new Map<string, number[]>() : undefined;
  const attribution = opts.attribution ?? null;

  let i = 0;
  while (i < rows.length) {
    const person = rows[i].person;
    let j = i;
    while (j < rows.length && rows[j].person === person) j++;
    const events = rows.slice(i, j).filter((e) => e.ts >= range.from && e.ts <= range.to);
    i = j;
    if (!events.length) continue;

    const best = bestAttempt(events, nSteps, windowMs, order, exclusions);
    if (best.excluded || best.reached === 0) continue;

    // Atribución: el valor de una persona en la apertura.
    if (attribution === 'step') {
      // En cualquier orden no hay un paso fijo: vale el primer valor de los eventos usados ("Any step").
      const usedAt = order === 'unordered' ? best.used.map((u) => events[u].value).find((v) => v != null) : best.used[opts.attributionStep ?? 0] === undefined ? null : events[best.used[opts.attributionStep ?? 0]].value;
      if (usedAt == null) continue;
      addValue(usedAt, best.reached);
    } else if (attribution === 'first' || attribution === 'last') {
      const seen = events.filter((e) => e.steps.length > 0 && e.value != null);
      const v = attribution === 'first' ? seen[0]?.value : seen[seen.length - 1]?.value;
      addValue(v ?? null, best.reached);
    } else if (attribution === 'all') {
      const values = new Set(events.filter((e) => e.steps.length > 0).map((e) => e.value ?? null));
      for (const v of values) {
        // Solo los pasos que hizo con ese valor, en el mismo orden.
        const subset = events.filter((e) => (e.value ?? null) === v);
        const a = bestAttempt(subset, nSteps, windowMs, order, exclusions);
        if (!a.excluded && a.reached > 0) addValue(v, a.reached);
      }
    }

    personTimes?.set(person, best.times);
    const who = events[0].owner ?? person;
    for (let s = 0; s < best.reached; s++) {
      counts[s]++;
      if (s > 0) gaps[s].push(best.times[s] - best.times[s - 1]);
      if (reached[s].length < 100 && !reached[s].includes(who)) reached[s].push(who);
    }
    if (best.reached === nSteps) {
      converted.push(who);
      if (nSteps > 1) totals.push(best.times[nSteps - 1] - best.times[0]);
    } else if (dropped[best.reached - 1].length < limit && (!events[0].owner || !dropped[best.reached - 1].includes(who))) {
      dropped[best.reached - 1].push(who);
    }

    if (hist && opts.historical) {
      // Una persona puede entrar en varios períodos; en cada uno vale su mejor intento.
      const perBucket = new Map<string, number>();
      for (let s = 0; s < events.length; s++) {
        if (!opens(events[s], order)) continue;
        const a = attemptAt(events, s, nSteps, windowMs, order, exclusions);
        if (a.excluded) continue;
        const b = bucketOf(events[s].ts, opts.historical.interval, opts.historical.tz);
        if ((perBucket.get(b) ?? 0) < a.reached) perBucket.set(b, a.reached);
      }
      for (const [b, steps] of perBucket) {
        let c = hist.get(b);
        if (!c) {
          c = new Array<number>(nSteps).fill(0);
          hist.set(b, c);
        }
        for (let s = 0; s < steps; s++) c[s]++;
      }
    }
  }

  const times = gaps.slice(1).map((g, s) => timeStats(s, s + 1, g));
  if (nSteps > 2) times.push(timeStats(0, nSteps - 1, totals));

  const sorted = [...byValue.entries()].map(([value, c]) => ({ value, counts: c })).sort((a, b) => b.counts[0] - a.counts[0] || String(a.value).localeCompare(String(b.value)));
  let breakdown = sorted;
  if (sorted.length > BREAKDOWN_LIMIT) {
    const rest = sorted.slice(BREAKDOWN_LIMIT - 1);
    const other = new Array<number>(nSteps).fill(0);
    for (const r of rest) r.counts.forEach((v, s) => (other[s] += v));
    breakdown = [...sorted.slice(0, BREAKDOWN_LIMIT - 1), { value: OTHER, counts: other }];
  }

  let historical: FunnelComputed['historical'] = null;
  if (hist && opts.historical) {
    const { interval, tz, now } = opts.historical;
    // Un período está incompleto mientras alguien que entró en él todavía puede convertir.
    const lastComplete = bucketOf(now - windowMs, interval, tz);
    historical = bucketList(range.from, range.to, interval, tz).map((bucket) => ({
      bucket,
      counts: hist.get(bucket) ?? new Array<number>(nSteps).fill(0),
      incomplete: bucket >= lastComplete,
    }));
  }

  return { counts, medians: gaps.map((g, s) => (s === 0 ? null : median(g))), dropped, converted, reached, times, breakdown, historical, personTimes };
}

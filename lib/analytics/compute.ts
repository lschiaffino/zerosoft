/**
 * Cálculos puros de las consultas de Analytics: rangos de fechas, cubetas de
 * tiempo (las mismas que arma el SQL), embudos, retención y caminos. El
 * servidor trae filas ya filtradas por proyecto y acá se agregan.
 */
import type { DateRange, Interval } from './types';
import { fromLocal, offsetMsAt, type Tz } from './tz';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------- Rangos ----------

/**
 * Rango [from, to] en ms. `from` relativo ('-7d', '-24h', '-2w', '-3m') o una
 * fecha local del proyecto; `to` una fecha (fin de ese día) o ahora.
 */
export function resolveRange(range: DateRange, now: number, tz: Tz = 0): { from: number; to: number } {
  let to = now;
  if (range.to) {
    const t = Date.parse(`${range.to}T00:00:00Z`);
    if (Number.isFinite(t)) to = Math.min(now, fromLocal(t + DAY, tz) - 1);
  }
  let from: number;
  const rel = /^-(\d{1,4})([hdwm])$/.exec(range.from);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    if (unit === 'h') from = to - n * HOUR;
    else {
      const days = unit === 'd' ? n : unit === 'w' ? n * 7 : n * 30;
      // Días enteros del proyecto: desde la medianoche local de hace N-1 días.
      const localToday = Math.floor((to + offsetMsAt(tz, to)) / DAY) * DAY;
      from = fromLocal(localToday - (days - 1) * DAY, tz);
    }
  } else {
    const f = Date.parse(`${range.from}T00:00:00Z`);
    from = Number.isFinite(f) ? fromLocal(f, tz) : to - 7 * DAY;
  }
  if (from > to) from = to;
  return { from, to };
}

/** El período anterior del mismo largo (para comparar). */
export function previousRange(r: { from: number; to: number }): { from: number; to: number } {
  const len = r.to - r.from + 1;
  return { from: r.from - len, to: r.from - 1 };
}

/**
 * El período anterior comparable: las mismas cubetas enteras corridas hacia
 * atrás. Con un rango de 7 días que termina ahora, compara los mismos 7 días
 * cortados a la misma hora, y cada cubeta cae frente a su equivalente.
 */
export function previousAligned(r: { from: number; to: number }, interval: Interval, tz: Tz = 0): { from: number; to: number } {
  const n = bucketList(r.from, r.to, interval, tz).length;
  if (interval === 'month') {
    const back = (ts: number) => {
      const d = new Date(ts + offsetMsAt(tz, ts));
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
      target.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
      return fromLocal(target.getTime(), tz);
    };
    return { from: back(r.from), to: back(r.to) };
  }
  if (interval === 'hour') return { from: r.from - n * HOUR, to: r.to - n * HOUR };
  // Días y semanas se corren en hora local: un cambio de hora en el medio no mueve el corte.
  const unit = interval === 'day' ? DAY : 7 * DAY;
  const back = (ts: number) => fromLocal(ts + offsetMsAt(tz, ts) - n * unit, tz);
  return { from: back(r.from), to: back(r.to) };
}

// ---------- Cubetas ----------

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Etiqueta de la cubeta de un timestamp, con el desfase del proyecto. Es la
 * misma que arma bucketSql en SQLite: 'YYYY-MM-DD HH:00', 'YYYY-MM-DD'
 * (día), el lunes de la semana o 'YYYY-MM-01'.
 */
export function bucketOf(ts: number, interval: Interval, tz: Tz = 0): string {
  const local = ts + offsetMsAt(tz, ts);
  const s = iso(local);
  switch (interval) {
    case 'hour':
      return `${s.slice(0, 10)} ${s.slice(11, 13)}:00`;
    case 'day':
      return s.slice(0, 10);
    case 'week': {
      const day = Math.floor(local / DAY);
      // 1970-01-01 fue jueves: el lunes es (día + 3) mod 7 hacia atrás.
      const monday = day - ((day + 3) % 7);
      return iso(monday * DAY).slice(0, 10);
    }
    case 'month':
      return `${s.slice(0, 7)}-01`;
  }
}

/** Un instante dentro de la cubeta anterior a la de `ts` (meses de calendario, no 30 días). */
export function bucketBefore(ts: number, interval: 'day' | 'week' | 'month', tz: Tz = 0): number {
  const local = ts + offsetMsAt(tz, ts);
  if (interval === 'month') {
    const d = new Date(local);
    return fromLocal(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1), tz);
  }
  return fromLocal(local - (interval === 'day' ? DAY : 7 * DAY), tz);
}

/**
 * Expresión SQLite con la misma etiqueta que bucketOf (columna `ts` en ms; un
 * parámetro: el desfase en ms al inicio del rango). `shift` corrige los eventos
 * posteriores a un cambio de hora (tzShiftSql).
 */
export function bucketSql(interval: Interval, col = 'e.ts', shift = ''): string {
  const t = `((${col} + CAST(? AS INTEGER)${shift}) / 1000)`;
  switch (interval) {
    case 'hour':
      return `strftime('%Y-%m-%d %H:00', ${t}, 'unixepoch')`;
    case 'day':
      return `strftime('%Y-%m-%d', ${t}, 'unixepoch')`;
    case 'week':
      return `date(${t}, 'unixepoch', 'weekday 0', '-6 days')`;
    case 'month':
      return `strftime('%Y-%m-01', ${t}, 'unixepoch')`;
  }
}

/** Todas las cubetas del rango, en orden (las vacías también). Tope de 2000. */
export function bucketList(from: number, to: number, interval: Interval, tz: Tz = 0): string[] {
  const out: string[] = [];
  let last = '';
  if (interval === 'hour') {
    for (let t = from; t <= to && out.length < 2000; t += HOUR) {
      const b = bucketOf(t, interval, tz);
      if (b !== last) {
        out.push(b);
        last = b;
      }
    }
  } else {
    // Por día de calendario en la zona: un día de 23 o 25 horas no se saltea ni se repite.
    const firstDay = Math.floor((from + offsetMsAt(tz, from)) / DAY);
    const lastDay = Math.floor((to + offsetMsAt(tz, to)) / DAY);
    for (let d = firstDay; d <= lastDay && out.length < 2000; d++) {
      const b = bucketOf(d * DAY, interval, 0);
      if (b !== last) {
        out.push(b);
        last = b;
      }
    }
  }
  const end = bucketOf(to, interval, tz);
  if (out[out.length - 1] !== end && out.length < 2000) out.push(end);
  return out;
}

/** Intervalo razonable para un rango (horas hasta 2 días, días hasta ~3 meses, semanas después). */
export function defaultInterval(from: number, to: number): Interval {
  const span = to - from;
  if (span <= 2 * DAY) return 'hour';
  if (span <= 100 * DAY) return 'day';
  return 'week';
}

// ---------- Apertura (breakdown) ----------

/**
 * Filas (cubeta, valor, cantidad) → series por valor: las `limit` más
 * grandes y, si se puede sumar (cantidad total), "Other" con el resto.
 */
export function breakdownSeries(
  rows: Array<{ bucket: string; value: string | null; count: number }>,
  buckets: string[],
  limit: number,
  summable: boolean,
): Array<{ value: string; data: number[]; total: number }> {
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const byValue = new Map<string, number[]>();
  for (const r of rows) {
    const i = idx.get(r.bucket);
    if (i === undefined) continue;
    const key = r.value ?? '(none)';
    let arr = byValue.get(key);
    if (!arr) {
      arr = new Array(buckets.length).fill(0);
      byValue.set(key, arr);
    }
    arr[i] += Number(r.count);
  }
  const all = [...byValue.entries()].map(([value, data]) => ({ value, data, total: data.reduce((a, b) => a + b, 0) }));
  all.sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
  const top = all.slice(0, limit);
  const rest = all.slice(limit);
  if (summable && rest.length) {
    const data = new Array(buckets.length).fill(0);
    for (const r of rest) r.data.forEach((v, i) => (data[i] += v));
    top.push({ value: '$other', data, total: data.reduce((a, b) => a + b, 0) });
  }
  return top;
}

/** Filas (cubeta, cantidad) → serie alineada con las cubetas. */
export function alignSeries(rows: Array<{ bucket: string; count: number }>, buckets: string[]): number[] {
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const out = new Array(buckets.length).fill(0);
  for (const r of rows) {
    const i = idx.get(r.bucket);
    if (i !== undefined) out[i] += Number(r.count);
  }
  return out;
}

// ---------- Embudos: lib/analytics/funnel-core.ts ----------

export { computeFunnel, type FunnelRow, type FunnelComputed } from './funnel-core';

// ---------- Retención ----------

export type RetentionPeriod = 'hour' | 'day' | 'week' | 'month';
export type RetentionType = 'recurring' | 'first_time' | 'first_ever';
export interface RetentionOptions {
  /** Con `recurring`, cada vez que hizo el evento inicial entra en esa cohorte. Si no, solo la primera. */
  recurring?: boolean;
  /** "En o después": quien vuelve más tarde también cuenta en los períodos anteriores. */
  cumulative?: boolean;
}

function retentionSets(starts: Array<{ person: string; period: number }>, returns: Array<{ person: string; period: number }>, firstPeriod: number, periods: number, opts: RetentionOptions) {
  const members = new Map<string, Set<number>>();
  for (const s of starts) {
    if (s.period < firstPeriod || s.period >= firstPeriod + periods) continue;
    let set = members.get(s.person);
    if (!set) members.set(s.person, (set = new Set()));
    if (opts.recurring) set.add(s.period);
    else {
      const prev = [...set][0];
      if (prev === undefined || s.period < prev) {
        set.clear();
        set.add(s.period);
      }
    }
  }
  const back = new Map<string, Set<number>>();
  for (const r of returns) {
    let set = back.get(r.person);
    if (!set) back.set(r.person, (set = new Set()));
    set.add(r.period);
  }
  return { members, back };
}

function returned(set: Set<number> | undefined, p: number, k: number, cumulative: boolean | undefined): boolean {
  if (!set) return false;
  if (!cumulative) return set.has(p + k);
  for (const x of set) if (x >= p + k) return true;
  return false;
}

/**
 * Retención por cohortes: cada persona entra en la cohorte del período en que
 * hizo el evento inicial por primera vez (dentro del rango), o en todas si es
 * recurrente, y cuenta en el período k si hizo el evento de vuelta en ese
 * período (k = 0 es el mismo).
 */
export function computeRetention(
  starts: Array<{ person: string; period: number }>,
  returns: Array<{ person: string; period: number }>,
  firstPeriod: number,
  periods: number,
  opts: RetentionOptions = {},
): Array<{ period: number; size: number; values: number[] }> {
  const { members, back } = retentionSets(starts, returns, firstPeriod, periods, opts);
  const cohorts = Array.from({ length: periods }, (_, c) => ({ period: firstPeriod + c, size: 0, values: new Array(periods - c).fill(0) as number[] }));
  for (const [person, set] of members) {
    for (const p of set) {
      const c = cohorts[p - firstPeriod];
      c.size++;
      c.values[0]++;
      for (let k = 1; k < c.values.length; k++) if (returned(back.get(person), p, k, opts.cumulative)) c.values[k]++;
    }
  }
  return cohorts;
}

/** Quiénes están en una celda de la tabla. */
export function retentionCellPeople(
  starts: Array<{ person: string; period: number }>,
  returns: Array<{ person: string; period: number }>,
  firstPeriod: number,
  periods: number,
  opts: RetentionOptions,
  cohort: number,
  k: number,
  limit = 200,
): string[] {
  const { members, back } = retentionSets(starts, returns, firstPeriod, periods, opts);
  const p = firstPeriod + cohort;
  const out: string[] = [];
  for (const [person, set] of members) {
    if (!set.has(p)) continue;
    if (k === 0 || returned(back.get(person), p, k, opts.cumulative)) out.push(person);
    if (out.length >= limit) break;
  }
  return out;
}

/** Porcentaje de una celda: sobre la cohorte, o sobre el período anterior. null si no hay con qué dividir. */
export function retentionRate(values: number[], size: number, k: number, reference: 'period0' | 'previous' = 'period0'): number | null {
  const v = values[k];
  if (v === undefined) return null;
  const base = reference === 'previous' && k > 0 ? values[k - 1] : size;
  return base ? v / base : null;
}

/** Promedio de cada período entre cohortes: ponderado por tamaño o simple. */
export function retentionMean(
  cohorts: Array<{ size: number; values: number[] }>,
  periods: number,
  reference: 'period0' | 'previous' = 'period0',
  mean: 'weighted' | 'simple' = 'weighted',
): Array<number | null> {
  return Array.from({ length: periods }, (_, k) => {
    let top = 0;
    let bottom = 0;
    const rates: number[] = [];
    for (const c of cohorts) {
      const r = retentionRate(c.values, c.size, k, reference);
      if (r === null) continue;
      rates.push(r);
      top += c.values[k];
      bottom += reference === 'previous' && k > 0 ? c.values[k - 1] : c.size;
    }
    if (!rates.length) return null;
    return mean === 'simple' ? rates.reduce((a, b) => a + b, 0) / rates.length : top / bottom;
  });
}


/** Número de período (horas, días, semanas desde el lunes o meses desde 1970) con el desfase del proyecto. */
export function periodOf(ts: number, period: RetentionPeriod, tz: Tz = 0): number {
  const local = ts + offsetMsAt(tz, ts);
  if (period === 'hour') return Math.floor(local / HOUR);
  if (period === 'month') {
    const d = new Date(local);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
  const day = Math.floor(local / DAY);
  return period === 'day' ? day : Math.floor((day + 3) / 7);
}

/** Instante local (ms como si fuera UTC) en que arranca un período. */
export function periodStartLocal(n: number, period: RetentionPeriod): number {
  if (period === 'hour') return n * HOUR;
  if (period === 'month') return Date.UTC(Math.floor(n / 12), n % 12, 1);
  return (period === 'day' ? n : n * 7 - 3) * DAY;
}

/** Etiqueta de un período, con el formato de las cubetas. */
export function periodLabel(n: number, period: RetentionPeriod): string {
  const s = iso(periodStartLocal(n, period));
  return period === 'hour' ? `${s.slice(0, 10)} ${s.slice(11, 13)}:00` : s.slice(0, 10);
}

/** Expresión SQLite con el mismo número que periodOf. Parámetro: el desfase (dos veces en meses). */
export function periodSql(period: RetentionPeriod, shift = ''): string {
  const local = `(e.ts + CAST(? AS INTEGER)${shift})`;
  switch (period) {
    case 'hour':
      return `(${local} / 3600000)`;
    case 'day':
      return `(${local} / 86400000)`;
    case 'week':
      return `(((${local} / 86400000) + 3) / 7)`;
    case 'month':
      return `(CAST(strftime('%Y', ${local} / 1000, 'unixepoch') AS INTEGER) * 12 + CAST(strftime('%m', ${local} / 1000, 'unixepoch') AS INTEGER) - 1)`;
  }
}

// ---------- Caminos ----------

/**
 * Caminos de páginas por sesión: las primeras `steps` páginas (sin repetir la
 * misma seguida), los enlaces de cada paso al siguiente y los caminos más
 * comunes. Con `startPath`, cada sesión arranca en la primera vez que pasa
 * por esa página.
 */
export function computePaths(
  rows: Array<{ session: string; path: string; ts: number }>,
  steps: number,
  startPath: string | null,
  limit = 30,
  endPath: string | null = null,
): { links: Array<{ step: number; from: string; to: string; count: number }>; topPaths: Array<{ path: string[]; count: number }>; sessions: number } {
  const bySession = new Map<string, Array<{ path: string; ts: number }>>();
  for (const r of rows) {
    let arr = bySession.get(r.session);
    if (!arr) {
      arr = [];
      bySession.set(r.session, arr);
    }
    arr.push(r);
  }
  const linkCount = new Map<string, number>();
  const pathCount = new Map<string, number>();
  let sessions = 0;
  for (const list of bySession.values()) {
    list.sort((a, b) => a.ts - b.ts);
    const seq: string[] = [];
    for (const r of list) if (seq[seq.length - 1] !== r.path) seq.push(r.path);
    let from = 0;
    if (startPath) {
      from = seq.indexOf(startPath);
      if (from < 0) continue;
    }
    let path = seq.slice(from, from + steps);
    // Con un final: solo las sesiones que llegan ahí, cortadas en esa página.
    if (endPath) {
      const end = seq.indexOf(endPath, from);
      if (end < 0) continue;
      path = seq.slice(Math.max(from, end - steps + 1), end + 1);
    }
    if (!path.length) continue;
    sessions++;
    for (let s = 0; s + 1 < path.length; s++) {
      const k = `${s}\u0000${path[s]}\u0000${path[s + 1]}`;
      linkCount.set(k, (linkCount.get(k) ?? 0) + 1);
    }
    const pk = path.join('\u0000');
    pathCount.set(pk, (pathCount.get(pk) ?? 0) + 1);
  }
  const links = [...linkCount.entries()]
    .map(([k, count]) => {
      const [step, from, to] = k.split('\u0000');
      return { step: Number(step), from, to, count };
    })
    .sort((a, b) => a.step - b.step || b.count - a.count || a.from.localeCompare(b.from));
  // Las `limit` más fuertes de cada paso.
  const perStep = new Map<number, number>();
  const topLinks = links.filter((l) => {
    const n = (perStep.get(l.step) ?? 0) + 1;
    perStep.set(l.step, n);
    return n <= limit;
  });
  const topPaths = [...pathCount.entries()]
    .map(([k, count]) => ({ path: k.split('\u0000'), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  return { links: topLinks, topPaths, sessions };
}

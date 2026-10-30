/**
 * Cálculos puros de las consultas de Analytics: rangos de fechas, cubetas de
 * tiempo (las mismas que arma el SQL), embudos, retención y caminos. El
 * servidor trae filas ya filtradas por proyecto y acá se agregan.
 */
import type { DateRange, Interval } from './types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// ---------- Rangos ----------

/**
 * Rango [from, to] en ms. `from` relativo ('-7d', '-24h', '-2w', '-3m') o una
 * fecha local del proyecto; `to` una fecha (fin de ese día) o ahora.
 */
export function resolveRange(range: DateRange, now: number, offsetMin = 0): { from: number; to: number } {
  const off = offsetMin * 60_000;
  let to = now;
  if (range.to) {
    const t = Date.parse(`${range.to}T00:00:00Z`);
    if (Number.isFinite(t)) to = Math.min(now, t - off + DAY - 1);
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
      const localToday = Math.floor((to + off) / DAY) * DAY;
      from = localToday - (days - 1) * DAY - off;
    }
  } else {
    const f = Date.parse(`${range.from}T00:00:00Z`);
    from = Number.isFinite(f) ? f - off : to - 7 * DAY;
  }
  if (from > to) from = to;
  return { from, to };
}

/** El período anterior del mismo largo (para comparar). */
export function previousRange(r: { from: number; to: number }): { from: number; to: number } {
  const len = r.to - r.from + 1;
  return { from: r.from - len, to: r.from - 1 };
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
export function bucketOf(ts: number, interval: Interval, offsetMin = 0): string {
  const local = ts + offsetMin * 60_000;
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

/** Expresión SQLite con la misma etiqueta que bucketOf (columna `ts` en ms; un parámetro: el desfase en ms). */
export function bucketSql(interval: Interval, col = 'e.ts'): string {
  const t = `((${col} + CAST(? AS INTEGER)) / 1000)`;
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
export function bucketList(from: number, to: number, interval: Interval, offsetMin = 0): string[] {
  const out: string[] = [];
  const step = interval === 'hour' ? HOUR : DAY;
  let last = '';
  for (let t = from; t <= to && out.length < 2000; t += step) {
    const b = bucketOf(t, interval, offsetMin);
    if (b !== last) {
      out.push(b);
      last = b;
    }
  }
  const end = bucketOf(to, interval, offsetMin);
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

// ---------- Embudos ----------

export interface FunnelRow {
  person: string;
  /** Índices de los pasos que este evento cumple (un evento puede servir a más de uno). */
  steps: number[];
  ts: number;
}

export interface FunnelComputed {
  counts: number[];
  /** Mediana de tiempo entre el paso i-1 y el i (ms); null en el primero o sin datos. */
  medians: Array<number | null>;
  /** Personas que llegaron al paso i y no al i+1. */
  dropped: string[][];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * Embudo secuencial (como el "sequential" de PostHog): por persona, cada
 * arranque del paso 1 dentro del rango abre un intento; los pasos siguientes
 * cuentan en orden y dentro de la ventana desde ese arranque. Gana el intento
 * que más lejos llega. Las filas vienen ordenadas por persona y tiempo.
 */
export function computeFunnel(rows: FunnelRow[], nSteps: number, windowMs: number, range: { from: number; to: number }, droppedLimit = 100): FunnelComputed {
  const counts = new Array(nSteps).fill(0);
  const gaps: number[][] = Array.from({ length: nSteps }, () => []);
  const dropped: string[][] = Array.from({ length: nSteps }, () => []);

  let i = 0;
  while (i < rows.length) {
    const person = rows[i].person;
    let j = i;
    while (j < rows.length && rows[j].person === person) j++;
    const events = rows.slice(i, j);
    i = j;

    let best = 0;
    let bestTimes: number[] = [];
    for (let s = 0; s < events.length && best < nSteps; s++) {
      const start = events[s];
      if (!start.steps.includes(0) || start.ts < range.from || start.ts > range.to) continue;
      const times = [start.ts];
      let step = 1;
      for (let k = s + 1; k < events.length && step < nSteps; k++) {
        const ev = events[k];
        if (ev.ts - start.ts > windowMs) break;
        if (ev.steps.includes(step) && ev.ts >= times[step - 1]) {
          times.push(ev.ts);
          step++;
        }
      }
      if (step > best) {
        best = step;
        bestTimes = times;
      }
    }
    if (best === 0) continue;
    for (let s = 0; s < best; s++) {
      counts[s]++;
      if (s > 0) gaps[s].push(bestTimes[s] - bestTimes[s - 1]);
    }
    if (best < nSteps && dropped[best - 1].length < droppedLimit) dropped[best - 1].push(person);
  }
  return { counts, medians: gaps.map((g, s) => (s === 0 ? null : median(g))), dropped };
}

// ---------- Retención ----------

/**
 * Retención por cohortes: cada persona entra en la cohorte del período en que
 * hizo el evento inicial por primera vez (dentro del rango) y cuenta en el
 * período k si hizo el evento de vuelta en ese período (k = 0 es el mismo).
 */
export function computeRetention(
  starts: Array<{ person: string; period: number }>,
  returns: Array<{ person: string; period: number }>,
  firstPeriod: number,
  periods: number,
): Array<{ period: number; size: number; values: number[] }> {
  const first = new Map<string, number>();
  for (const s of starts) {
    if (s.period < firstPeriod || s.period >= firstPeriod + periods) continue;
    const prev = first.get(s.person);
    if (prev === undefined || s.period < prev) first.set(s.person, s.period);
  }
  const back = new Map<string, Set<number>>();
  for (const r of returns) {
    let set = back.get(r.person);
    if (!set) {
      set = new Set();
      back.set(r.person, set);
    }
    set.add(r.period);
  }
  const cohorts = Array.from({ length: periods }, (_, c) => ({ period: firstPeriod + c, size: 0, values: new Array(periods - c).fill(0) as number[] }));
  for (const [person, p] of first) {
    const c = cohorts[p - firstPeriod];
    c.size++;
    c.values[0]++;
    const set = back.get(person);
    if (!set) continue;
    for (let k = 1; k < c.values.length; k++) if (set.has(p + k)) c.values[k]++;
  }
  return cohorts;
}

/** Número de período (días o semanas desde 1970, semanas desde el lunes) con el desfase del proyecto. */
export function periodOf(ts: number, period: 'day' | 'week', offsetMin = 0): number {
  const day = Math.floor((ts + offsetMin * 60_000) / DAY);
  return period === 'day' ? day : Math.floor((day + 3) / 7);
}

/** Primer día (YYYY-MM-DD) de un período. */
export function periodLabel(n: number, period: 'day' | 'week'): string {
  const day = period === 'day' ? n : n * 7 - 3;
  return iso(day * DAY).slice(0, 10);
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
    const path = seq.slice(from, from + steps);
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

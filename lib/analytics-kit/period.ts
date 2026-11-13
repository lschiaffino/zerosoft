/**
 * Analítica, el kit: períodos, zona horaria, rangos, percentiles y CSV. Puro
 * (sin base ni APIs del servidor): lo usan el servidor de cada producto, los
 * componentes del navegador y los tests. Nació en los reportes de Lines
 * (lib/groups-analytics-shared.ts lo reexporta tal cual).
 */

export const ANALYTICS_PERIODS = [7, 30, 90] as const;
/** Tope de un rango propio: un año. Más que eso no se lee de la base. */
export const MAX_RANGE_DAYS = 366;
/** Cookie con la zona horaria del navegador (la pone el tablero al abrirse). */
export const ANALYTICS_TZ_COOKIE = 'zs_tz';

// ---------- Zona horaria ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

/** Zona IANA válida o UTC. */
export function validTz(tz: string | undefined | null): string {
  if (!tz || tz.length > 64) return 'UTC';
  try {
    formatter(tz);
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Segundos que hay que sumarle a UTC para tener la hora local en ese instante. */
export function tzOffsetSec(ms: number, tz: string): number {
  if (tz === 'UTC') return 0;
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((local - Math.floor(ms / 1000) * 1000) / 1000);
}

/** Un día de calendario real (no 2026-02-30), entre 1970 y 9999: antes de eso no hay mensajes ni offsets confiables. */
export function isDay(v: string | undefined | null): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v) || v < '1970-01-02' || v > '9999-01-01') return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

/** Día de calendario ± n. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Día local (YYYY-MM-DD) de un instante. */
export function localDay(ms: number, tz: string): string {
  return new Date(ms + tzOffsetSec(ms, tz) * 1000).toISOString().slice(0, 10);
}

/** Instante UTC de la medianoche local de ese día. */
export function zonedMidnight(day: string, tz: string): number {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const first = guess - tzOffsetSec(guess, tz) * 1000;
  return guess - tzOffsetSec(first, tz) * 1000;
}

export interface TzSegment {
  /** Desde este segundo UTC (incluido) vale `offsetSec`. El primero arranca en -∞. */
  fromSec: number;
  offsetSec: number;
}

/**
 * Tramos de offset constante entre dos instantes (cambios de hora). Con esto
 * el SQL calcula el día y la hora local exactos sin traer las filas.
 */
export function tzSegments(tz: string, fromMs: number, toMs: number): TzSegment[] {
  const out: TzSegment[] = [{ fromSec: Number.NEGATIVE_INFINITY, offsetSec: tzOffsetSec(fromMs, tz) }];
  if (tz === 'UTC') return out;
  let t = fromMs;
  let off = out[0].offsetSec;
  while (t < toMs) {
    const next = Math.min(t + DAY_MS, toMs);
    const nextOff = tzOffsetSec(next, tz);
    if (nextOff !== off) {
      // El cambio está en (t, next]: se busca al minuto.
      let lo = t;
      let hi = next;
      while (hi - lo > 60_000) {
        const mid = lo + Math.max(1, Math.floor((hi - lo) / 120_000)) * 60_000;
        if (tzOffsetSec(mid, tz) === off) lo = mid;
        else hi = mid;
      }
      out.push({ fromSec: Math.floor(hi / 1000), offsetSec: nextOff });
      off = nextOff;
    }
    t = next;
  }
  return out;
}

/** Expresión SQL (enteros en línea, sin parámetros) del offset local para la columna (o expresión) de segundos `col`. */
export function tzOffsetSql(segments: TzSegment[], col: string): string {
  if (segments.length <= 1) return String(Math.trunc(segments[0]?.offsetSec ?? 0));
  const whens = segments.slice(1).map((s, i) => `WHEN ${col} < ${Math.trunc(s.fromSec)} THEN ${Math.trunc(segments[i].offsetSec)}`);
  return `(CASE ${whens.join(' ')} ELSE ${Math.trunc(segments[segments.length - 1].offsetSec)} END)`;
}

// ---------- Rango ----------

export interface AnalyticsRange {
  tz: string;
  /** Rango del período: [since, until) en ISO. */
  since: string;
  until: string;
  /** El período anterior, del mismo largo: [prevSince, since). */
  prevSince: string;
  days: number;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  custom: boolean;
  /** El rango pedido era más largo que el tope y se recortó. */
  clipped: boolean;
}

export interface RangeInput {
  days?: number;
  from?: string;
  to?: string;
  tz?: string;
}

/**
 * Rango del reporte en días de calendario de la zona de quien mira: los
 * últimos `days` (hoy incluido) o un rango propio (inclusive, hasta un año).
 * Un rango invertido se ignora. Puro.
 */
export function analyticsRange(input: RangeInput = {}, now = new Date()): AnalyticsRange {
  const tz = validTz(input.tz);
  const today = localDay(now.getTime(), tz);
  let from: string;
  let to: string;
  let custom = false;
  let clipped = false;
  if (isDay(input.from) && (!isDay(input.to) || input.to >= input.from)) {
    custom = true;
    from = input.from;
    to = isDay(input.to) ? input.to : today < from ? from : today;
    if (to > addDays(from, MAX_RANGE_DAYS - 1)) {
      to = addDays(from, MAX_RANGE_DAYS - 1);
      clipped = true;
    }
  } else {
    const n = Math.min(MAX_RANGE_DAYS, Math.max(1, Math.round(Number(input.days) || 30)));
    to = today;
    from = addDays(today, -(n - 1));
  }
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  const prevFrom = addDays(from, -days);
  return {
    tz,
    since: new Date(zonedMidnight(from, tz)).toISOString(),
    until: new Date(zonedMidnight(addDays(to, 1), tz)).toISOString(),
    prevSince: new Date(zonedMidnight(prevFrom, tz)).toISOString(),
    days,
    from,
    to,
    prevFrom,
    prevTo: addDays(from, -1),
    custom,
    clipped,
  };
}

export function dayList(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}

// ---------- Números ----------

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Cuantil de una distribución dada como [valor, cantidad]. q = 0.5 es la
 * mediana (promedio de las dos del medio si es par); el resto, rango más
 * cercano. null sin muestras.
 */
export function weightedQuantile(pairs: Array<[number, number]>, q: number): number | null {
  const sorted = pairs.filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return null;
  const at = (rank: number): number => {
    let seen = 0;
    for (const [v, n] of sorted) {
      seen += n;
      if (seen >= rank) return v;
    }
    return sorted[sorted.length - 1][0];
  };
  if (q === 0.5) return total % 2 ? at((total + 1) / 2) : Math.round((at(total / 2) + at(total / 2 + 1)) / 2);
  return at(Math.min(total, Math.max(1, Math.ceil(q * total))));
}

/** Cambio contra el período anterior en fracción (0.25 = +25 %). null si no hay con qué comparar. */
export function delta(value: number | null | undefined, prev: number | null | undefined): number | null {
  if (value == null || prev == null || !Number.isFinite(value) || !Number.isFinite(prev) || prev === 0) return null;
  return (value - prev) / prev;
}

/** Fracción segura: 0 si el divisor es 0. */
export function share(part: number, total: number): number {
  return total > 0 && Number.isFinite(part) ? Math.min(1, Math.max(0, part / total)) : 0;
}

/** Tramos de la primera respuesta, en minutos (límite superior exclusivo; el último no tiene tope). */
export const RESPONSE_BUCKETS = [5, 15, 60, 240, 1440] as const;

export function responseBuckets(pairs: Array<[number, number]>): number[] {
  const out = new Array<number>(RESPONSE_BUCKETS.length + 1).fill(0);
  for (const [min, n] of pairs) {
    const i = RESPONSE_BUCKETS.findIndex((b) => min < b);
    out[i === -1 ? RESPONSE_BUCKETS.length : i] += n;
  }
  return out;
}

/** Número de una celda de la base (null, texto o bigint): 0 si no es un número. */
export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Un monto con su moneda; si el código no es válido, el número y el código. */
export function formatMoney(value: number, locale: string, currency: string, decimals = 0): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(value);
  } catch {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value)} ${currency}`;
  }
}

// ---------- Datos comunes ----------

export interface Kpi {
  value: number | null;
  /** Mismo dato en el período anterior. undefined: no se compara (es una foto de ahora). */
  prev?: number | null;
}

export interface RangeInfo {
  from: string;
  to: string;
  days: number;
  tz: string;
  prevFrom: string;
  prevTo: string;
  custom: boolean;
  clipped: boolean;
}

export const rangeInfo = (r: AnalyticsRange): RangeInfo => ({ from: r.from, to: r.to, days: r.days, tz: r.tz, prevFrom: r.prevFrom, prevTo: r.prevTo, custom: r.custom, clipped: r.clipped });

// ---------- Período pedido en la URL ----------

export interface PeriodSearch {
  days?: string;
  from?: string;
  to?: string;
}

export interface PeriodChoice {
  /** Uno de ANALYTICS_PERIODS (30 si no vino o no vale). */
  days: number;
  /** Rango propio válido (undefined si no vino, no vale o está invertido). */
  from?: string;
  to?: string;
  /** "Hasta" antes de "desde": no se aplica y se avisa, en vez de cambiar la fecha en silencio. */
  inverted: boolean;
  /** Hay un rango propio aplicado. */
  custom: boolean;
  /** Lo que vino en la URL (para volver a mostrarlo en el formulario si estaba invertido). */
  rawFrom?: string;
  rawTo?: string;
}

/** Lee el período de la URL (?days=7|30|90 o ?from=&to=). Puro. */
export function periodChoice(sp: PeriodSearch): PeriodChoice {
  const days = (ANALYTICS_PERIODS as readonly number[]).includes(Number(sp.days)) ? Number(sp.days) : 30;
  const from = isDay(sp.from) ? sp.from : undefined;
  const to = isDay(sp.to) ? sp.to : undefined;
  const inverted = Boolean(from && to && to < from);
  return { days, from: inverted ? undefined : from, to: inverted ? undefined : to, inverted, custom: !inverted && Boolean(from), rawFrom: from, rawTo: to };
}

/** Los parámetros de la URL que conservan el período al cambiar otro filtro. */
export function periodParams(range: Pick<RangeInfo, 'custom' | 'from' | 'to' | 'days'>): Record<string, string | undefined> {
  if (range.custom) return { from: range.from, to: range.to, days: undefined };
  return { from: undefined, to: undefined, days: range.days === 30 ? undefined : String(range.days) };
}

// ---------- SQL ----------

/** Día (entero: días desde 1970-01-01 en hora local) de una expresión SQL en segundos UTC. */
export function dayIndexSql(segments: TzSegment[], secExpr: string): string {
  return `((${secExpr}) + ${tzOffsetSql(segments, secExpr)}) / 86400`;
}

/** Hora local (0-23) de una expresión SQL en segundos UTC. */
export function hourSql(segments: TzSegment[], secExpr: string): string {
  return `(((${secExpr}) + ${tzOffsetSql(segments, secExpr)}) % 86400) / 3600`;
}

/** Lunes = 0 a domingo = 6 de un índice de día (el día 0, 1970-01-01, fue jueves). */
export const weekdaySql = (dayExpr: string) => `((${dayExpr}) + 3) % 7`;

/** El día (YYYY-MM-DD) de un índice de dayIndexSql. */
export function idxDay(idx: unknown): string {
  return new Date(num(idx) * DAY_MS).toISOString().slice(0, 10);
}

/** Un instante ISO en el formato de datetime('now') de SQLite ('YYYY-MM-DD HH:MM:SS'), para comparar con columnas guardadas así. */
export function sqlStamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

/** Tramos de zona horaria que cubren el período anterior y el actual. */
export function rangeSegments(range: AnalyticsRange): TzSegment[] {
  return tzSegments(range.tz, Date.parse(range.prevSince), Date.parse(range.until));
}

/**
 * Series por día del período y del anterior, alineadas por posición: cada día
 * del rango con su valor o `empty()`.
 */
export function daySeries<T extends object>(
  range: Pick<AnalyticsRange, 'from' | 'prevFrom' | 'days'>,
  byDay: Map<string, T>,
  empty: () => T,
): { cur: Array<{ day: string } & T>; prev: Array<{ day: string } & T> } {
  const list = (from: string) => dayList(from, range.days).map((day) => ({ day, ...(byDay.get(day) ?? empty()) }));
  return { cur: list(range.from), prev: list(range.prevFrom) };
}

/** Suma de un valor en una lista. */
export function sumOf<T>(list: T[], pick: (v: T) => number): number {
  return list.reduce((a, v) => a + (Number(pick(v)) || 0), 0);
}

// ---------- CSV ----------

/** Celda CSV: comillas si hace falta y sin fórmulas (= + - @ al inicio). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

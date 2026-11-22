/**
 * CRM: rangos de fecha de los filtros rápidos de los listados (Fecha de creación,
 * Fecha de última actividad), como los de HubSpot: "Hoy", "Últimos 7 días",
 * "Este mes"… Puro: lo usan las páginas, los componentes y los unitarios.
 *
 * En la URL va la clave del rango (`created=last7`), no las fechas: una vista
 * guardada con "Últimos 7 días" sigue siendo relativa al día en que se abre.
 * Un rango a medida va en `<param>From` / `<param>To` (YYYY-MM-DD) con la clave
 * `custom`. El rango se calcula en la zona horaria de la persona.
 */

export const DATE_PRESETS = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'last90',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

/** Clave del rango a medida (usa From / To). */
export const CUSTOM_RANGE = 'custom';
/** Solo para la última actividad: registros sin ninguna actividad. */
export const NO_DATE = 'none';

export function isDatePreset(v: unknown): v is DatePreset {
  return typeof v === 'string' && (DATE_PRESETS as readonly string[]).includes(v);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha YYYY-MM-DD válida? */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** El día de hoy (YYYY-MM-DD) en una zona horaria. */
export function todayIn(now: Date, timeZone?: string): string {
  try {
    // en-CA da YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parts(day: string): { y: number; m: number } {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) };
}

function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

/** Desde y hasta (inclusive, YYYY-MM-DD) de un rango relativo a hoy. */
export function presetRange(preset: DatePreset, now: Date, timeZone?: string): { from: string; to: string } {
  const today = todayIn(now, timeZone);
  const { y, m } = parts(today);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'last90':
      return { from: addDays(today, -89), to: today };
    case 'thisMonth':
      return { from: ymd(y, m, 1), to: today };
    case 'lastMonth':
      // Día 0 del mes actual = el último del anterior.
      return { from: ymd(y, m - 1, 1), to: ymd(y, m, 0) };
    case 'thisQuarter':
      return { from: ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
    case 'thisYear':
      return { from: ymd(y, 1, 1), to: today };
  }
}

export interface ResolvedRange {
  from?: string;
  to?: string;
  /** Sin fecha (solo "Sin actividad"). */
  none?: boolean;
}

/**
 * Lo que filtra un rango del listado a partir de sus params: una clave relativa,
 * `custom` con From/To, o `none` si se permite. Una clave desconocida o fechas
 * inválidas no filtran nada.
 */
export function resolveDateFilter(
  preset: string | undefined,
  from: string | undefined,
  to: string | undefined,
  opts: { now: Date; timeZone?: string; allowNone?: boolean },
): ResolvedRange {
  if (preset && isDatePreset(preset)) return presetRange(preset, opts.now, opts.timeZone);
  if (preset === NO_DATE) return opts.allowNone ? { none: true } : {};
  // Sin clave (links viejos con createdFrom/createdTo) o `custom`: las fechas que vengan bien.
  if (preset && preset !== CUSTOM_RANGE) return {};
  const out: ResolvedRange = {};
  if (isDay(from)) out.from = from;
  if (isDay(to)) out.to = to;
  return out;
}

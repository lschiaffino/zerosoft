/**
 * Cal — reglas puras de frecuencia de reservas (sin DB): cada cuánto se
 * ofrece un inicio y los topes de reuniones por día, semana y mes.
 *
 * Los períodos se cuentan en la zona del horario del evento (la del
 * anfitrión), no en la del invitado: "3 por día" es el día del anfitrión.
 */

export const LIMIT_PERIODS = ['day', 'week', 'month'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
export type PeriodLimits = Partial<Record<LimitPeriod, number>>;

/** Tope máximo aceptado por período (también lo valida el schema). */
export const MAX_PERIOD_LIMIT = 1000;

/** Saltos de inicio aceptados (minutos). */
export const SLOT_INTERVAL_MIN = 5;
export const SLOT_INTERVAL_MAX = 720;

/**
 * Cada cuánto arranca un slot: el intervalo propio del evento o, si no tiene
 * (o es inválido), la duración (comportamiento previo).
 */
export function slotStepMin(durationMin: number, intervalMin?: unknown): number {
  if (typeof intervalMin === 'number' && Number.isInteger(intervalMin) && intervalMin >= SLOT_INTERVAL_MIN && intervalMin <= SLOT_INTERVAL_MAX) {
    return intervalMin;
  }
  return Math.max(1, durationMin);
}

/** Topes válidos de un objeto suelto (JSON de booking_rules): enteros de 1 a MAX_PERIOD_LIMIT. */
export function normalizeLimits(raw: unknown): PeriodLimits {
  const out: PeriodLimits = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const p of LIMIT_PERIODS) {
    const v = (raw as Record<string, unknown>)[p];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_PERIOD_LIMIT) out[p] = v;
  }
  return out;
}

export function hasLimits(limits: PeriodLimits): boolean {
  return LIMIT_PERIODS.some((p) => limits[p] !== undefined);
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInTz(d: Date, tz: string): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Algunos motores devuelven 24 para la medianoche con hour12: false.
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/** Medianoche local (en `tz`) del día calendario y/m/d, como instante UTC. Tolera días fuera de rango (Date.UTC normaliza). */
function localMidnight(year: number, month: number, day: number, tz: string): Date {
  const desired = Date.UTC(year, month - 1, day);
  let utc = desired;
  for (let i = 0; i < 5; i++) {
    const p = partsInTz(new Date(utc), tz);
    const diff = desired - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

/**
 * Período (día, semana o mes local en `tz`) que contiene `at`: [start, end).
 * `weekStart`: 0 = domingo … 6 = sábado (calendar_users.week_start).
 */
export function periodBounds(at: Date, period: LimitPeriod, tz: string, weekStart = 1): { start: Date; end: Date } {
  const p = partsInTz(at, tz);
  if (period === 'month') {
    return { start: localMidnight(p.year, p.month, 1, tz), end: localMidnight(p.year, p.month + 1, 1, tz) };
  }
  let day = p.day;
  let length = 1;
  if (period === 'week') {
    const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    day -= (dow - (((weekStart % 7) + 7) % 7) + 7) % 7;
    length = 7;
  }
  return { start: localMidnight(p.year, p.month, day, tz), end: localMidnight(p.year, p.month, day + length, tz) };
}

/**
 * Una reserva más que empiece en `at` respeta los topes, dados los inicios
 * de las reservas vivas ya contadas (`starts`).
 */
export function withinLimits(starts: readonly Date[], at: Date, limits: PeriodLimits, tz: string, weekStart = 1): boolean {
  for (const period of LIMIT_PERIODS) {
    const max = limits[period];
    if (max === undefined) continue;
    const { start, end } = periodBounds(at, period, tz, weekStart);
    let count = 0;
    for (const s of starts) if (s >= start && s < end) count++;
    if (count >= max) return false;
  }
  return true;
}

/**
 * Cron de 5 campos (minuto hora día-del-mes mes día-de-semana) con zona
 * horaria. Sin dependencias: lo usan Flow (trigger.schedule) y Robots, en el
 * servidor y en el editor (vista previa de la próxima corrida).
 *
 * Soporta *, listas (1,15), rangos (1-5), pasos (*\/15, 10-50/10), nombres
 * (JAN-DEC, SUN-SAT), 7 = domingo y los atajos @hourly @daily @weekly
 * @monthly @yearly. Igual que Vixie cron: si día-del-mes y día-de-semana
 * están restringidos, alcanza con que coincida uno de los dos.
 */

export interface CronSchedule {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
  /** true si el campo no es '*' (para la regla día-del-mes / día-de-semana). */
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

export type CronParseResult = { ok: true; schedule: CronSchedule } | { ok: false; error: 'invalid_cron'; field?: number };

const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const FIELDS: Array<{ min: number; max: number; names?: string[]; nameBase?: number }> = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTHS, nameBase: 1 },
  { min: 0, max: 7, names: DAYS, nameBase: 0 },
];

function parseValue(raw: string, field: (typeof FIELDS)[number]): number | null {
  const up = raw.toUpperCase();
  if (field.names) {
    const i = field.names.indexOf(up);
    if (i >= 0) return i + (field.nameBase ?? 0);
  }
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= field.min && n <= field.max ? n : null;
}

function parseField(text: string, index: number): number[] | null {
  const field = FIELDS[index];
  const out = new Set<number>();
  for (const part of text.split(',')) {
    if (!part) return null;
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) return null;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d{1,2}$/.test(stepPart) || Number(stepPart) < 1) return null;
      step = Number(stepPart);
    }
    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = field.min;
      hi = index === 4 ? 6 : field.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      const va = parseValue(a, field);
      const vb = parseValue(b, field);
      if (va === null || vb === null || va > vb) return null;
      lo = va;
      hi = vb;
    } else {
      const v = parseValue(rangePart, field);
      if (v === null) return null;
      lo = v;
      // "5/15" = desde 5 hasta el máximo, cada 15.
      hi = stepPart !== undefined ? field.max : v;
    }
    for (let v = lo; v <= hi; v += step) out.add(index === 4 && v === 7 ? 0 : v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(expr: string): CronParseResult {
  const raw = String(expr ?? '').trim().replace(/\s+/g, ' ');
  const text = MACROS[raw.toLowerCase()] ?? raw;
  const parts = text.split(' ');
  if (parts.length !== 5 || text.length > 120) return { ok: false, error: 'invalid_cron' };
  const fields: number[][] = [];
  for (let i = 0; i < 5; i++) {
    const values = parseField(parts[i], i);
    if (!values || values.length === 0) return { ok: false, error: 'invalid_cron', field: i };
    fields.push(values);
  }
  return {
    ok: true,
    schedule: {
      minutes: fields[0],
      hours: fields[1],
      days: fields[2],
      months: fields[3],
      weekdays: fields[4],
      dayRestricted: parts[2] !== '*' && !parts[2].startsWith('*/'),
      weekdayRestricted: parts[4] !== '*' && !parts[4].startsWith('*/'),
    },
  };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr).ok;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Minutos que la zona está adelantada respecto de UTC en `at`. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/** Hora local (pared) → instante UTC, corrigiendo cambios de horario. */
function wallToUtc(tz: string, y: number, mo: number, d: number, h: number, mi: number): number {
  const wall = Date.UTC(y, mo, d, h, mi);
  let utc = wall - tzOffsetMinutes(tz, new Date(wall)) * 60_000;
  const again = wall - tzOffsetMinutes(tz, new Date(utc)) * 60_000;
  if (again !== utc) utc = again;
  return utc;
}

function dayMatches(s: CronSchedule, day: number, weekday: number): boolean {
  const dom = s.days.includes(day);
  const dow = s.weekdays.includes(weekday);
  if (s.dayRestricted && s.weekdayRestricted) return dom || dow;
  if (s.dayRestricted) return dom;
  if (s.weekdayRestricted) return dow;
  return true;
}

/**
 * Próxima ejecución estrictamente posterior a `from` (al minuto). null si la
 * expresión es inválida o no hay coincidencias en ~5 años (p. ej. 31 de febrero).
 */
export function nextCronRun(expr: string, timezone = 'UTC', from: Date = new Date()): Date | null {
  const parsed = parseCron(expr);
  if (!parsed.ok) return null;
  const s = parsed.schedule;
  const tz = timezone && isValidTimezone(timezone) ? timezone : 'UTC';
  const after = Math.floor(from.getTime() / 60_000) * 60_000;
  const local = new Date(after + tzOffsetMinutes(tz, from) * 60_000);
  let y = local.getUTCFullYear();
  let mo = local.getUTCMonth();
  let d = local.getUTCDate();
  for (let i = 0; i < 366 * 5; i++) {
    const date = new Date(Date.UTC(y, mo, d));
    y = date.getUTCFullYear();
    mo = date.getUTCMonth();
    d = date.getUTCDate();
    if (s.months.includes(mo + 1) && dayMatches(s, d, date.getUTCDay())) {
      for (const h of s.hours) {
        for (const mi of s.minutes) {
          const at = wallToUtc(tz, y, mo, d, h, mi);
          if (at > after) return new Date(at);
        }
      }
    }
    d += 1;
  }
  return null;
}

/** Próximas `n` ejecuciones (vista previa del editor). */
export function nextCronRuns(expr: string, timezone: string, n: number, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < n; i++) {
    const next = nextCronRun(expr, timezone, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

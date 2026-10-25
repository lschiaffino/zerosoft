/**
 * Groups: reglas de los mensajes recurrentes (puro: lo usan el servidor, la
 * interfaz para mostrar la próxima corrida y los tests).
 *
 * - daily: todos los días a la hora `time`.
 * - weekly: los días `days` (0 = domingo) a la hora `time`.
 * - monthly: el día `dayOfMonth` (si el mes es más corto, el último día).
 * - cron: expresión de 5 campos (minuto hora día-del-mes mes día-de-semana)
 *   con *, números, listas, rangos y pasos (*\/15, 1-5). Si día del mes y día
 *   de semana están restringidos, alcanza con uno (como cron).
 *
 * Las horas son de la zona `timezone` (con horario de verano).
 */

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'cron';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** "HH:MM" local (no se usa con cron). */
  time: string;
  days: number[];
  dayOfMonth: number;
  cron: string;
}

export const RECURRENCE_FREQS: readonly RecurrenceFreq[] = ['daily', 'weekly', 'monthly', 'cron'];

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return Boolean(tz);
  } catch {
    return false;
  }
}

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Valida y limpia una regla. Lanza el código de error si no sirve. */
export function normalizeRule(raw: unknown): RecurrenceRule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const freq = RECURRENCE_FREQS.find((f) => f === r.freq);
  if (!freq) throw new Error('invalid_recurrence');
  const time = String(r.time ?? '09:00').trim();
  if (freq !== 'cron' && !HM.test(time)) throw new Error('invalid_time');
  const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (freq === 'weekly' && days.length === 0) throw new Error('invalid_days');
  const dom = Math.round(Number(r.dayOfMonth ?? 1));
  if (freq === 'monthly' && !(dom >= 1 && dom <= 31)) throw new Error('invalid_day_of_month');
  const cron = String(r.cron ?? '').trim().replace(/\s+/g, ' ');
  if (freq === 'cron' && !parseCron(cron)) throw new Error('invalid_cron');
  return {
    freq,
    time: freq === 'cron' ? '' : time.padStart(5, '0'),
    days: freq === 'weekly' ? days : [],
    dayOfMonth: freq === 'monthly' ? dom : 1,
    cron: freq === 'cron' ? cron : '',
  };
}

// ---------- cron ----------

export interface CronSpec {
  minutes: number[];
  hours: number[];
  dom: number[] | null;
  months: number[] | null;
  dow: number[] | null;
}

function field(raw: string, min: number, max: number): number[] | null | false {
  if (raw === '*') return null;
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!m) return false;
    const step = m[3] ? Number(m[3]) : 1;
    if (step < 1) return false;
    let lo: number;
    let hi: number;
    if (m[1] === '*') {
      lo = min;
      hi = max;
    } else {
      lo = Number(m[1]);
      hi = m[2] !== undefined ? Number(m[2]) : m[3] ? max : lo;
    }
    if (lo < min || hi > max || lo > hi) return false;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** "m h dom mon dow" → conjuntos; null si no es válida. El día de semana 7 es domingo. */
export function parseCron(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minutes = field(parts[0], 0, 59);
  const hours = field(parts[1], 0, 23);
  const dom = field(parts[2], 1, 31);
  const months = field(parts[3], 1, 12);
  const dowRaw = field(parts[4], 0, 7);
  if (minutes === false || hours === false || dom === false || months === false || dowRaw === false) return null;
  const dow = dowRaw ? [...new Set(dowRaw.map((d) => (d === 7 ? 0 : d)))].sort() : null;
  return {
    minutes: minutes ?? Array.from({ length: 60 }, (_, i) => i),
    hours: hours ?? Array.from({ length: 24 }, (_, i) => i),
    dom,
    months,
    dow,
  };
}

// ---------- zona horaria ----------

interface LocalDay {
  y: number;
  m: number;
  d: number;
  weekday: number;
}

function localParts(date: Date, tz: string): LocalDay & { hh: number; mm: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour) % 24,
    mm: Number(p.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday)),
  };
}

/** Fecha y hora locales de `tz` → instante UTC. */
export function zonedTime(y: number, m: number, d: number, minutes: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(ts), tz);
    ts += guess - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  }
  return new Date(ts);
}

function addDays(day: LocalDay, n: number): LocalDay {
  const dt = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), weekday: dt.getUTCDay() };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Minutos del día en que la regla corre ese día local (vacío si ese día no corre). */
function slotsFor(rule: RecurrenceRule, day: LocalDay, cron: CronSpec | null): number[] {
  if (rule.freq === 'cron' && cron) {
    if (cron.months && !cron.months.includes(day.m)) return [];
    const domOk = cron.dom ? cron.dom.includes(day.d) : true;
    const dowOk = cron.dow ? cron.dow.includes(day.weekday) : true;
    const dayOk = cron.dom && cron.dow ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) return [];
    const out: number[] = [];
    for (const h of cron.hours) for (const mi of cron.minutes) out.push(h * 60 + mi);
    return out;
  }
  const [hh, mm] = rule.time.split(':').map(Number);
  const at = hh * 60 + mm;
  if (rule.freq === 'daily') return [at];
  if (rule.freq === 'weekly') return rule.days.includes(day.weekday) ? [at] : [];
  const target = Math.min(rule.dayOfMonth, daysInMonth(day.y, day.m));
  return day.d === target ? [at] : [];
}

/** Próxima corrida estrictamente después de `after` (null si no hay en ~13 meses). */
export function nextRun(rule: RecurrenceRule, timezone: string, after: Date): Date | null {
  const tz = isValidTimezone(timezone) ? timezone : 'UTC';
  const cron = rule.freq === 'cron' ? parseCron(rule.cron) : null;
  const start = localParts(after, tz);
  let day: LocalDay = { y: start.y, m: start.m, d: start.d, weekday: start.weekday };
  for (let i = 0; i < 400; i++) {
    for (const minutes of slotsFor(rule, day, cron)) {
      const at = zonedTime(day.y, day.m, day.d, minutes, tz);
      if (at.getTime() > after.getTime()) return at;
    }
    day = addDays(day, 1);
  }
  return null;
}

/** Las próximas `n` corridas (para mostrar en la interfaz). */
export function upcomingRuns(rule: RecurrenceRule, timezone: string, from: Date, n = 3, endsAt?: string | null): Date[] {
  const out: Date[] = [];
  let cursor = from;
  const end = endsAt ? Date.parse(endsAt) : NaN;
  while (out.length < n) {
    const next = nextRun(rule, timezone, cursor);
    if (!next || (Number.isFinite(end) && next.getTime() > end)) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

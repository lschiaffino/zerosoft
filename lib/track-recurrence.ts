/**
 * Track — fechas puras para lo que corre solo: issues que se repiten,
 * cycles automáticos y el horario del resumen diario. Todo en días
 * calendario YYYY-MM-DD (sin horas, sin problemas de DST).
 */
import { addDays } from './track-tasks';
import type { TrackRecurringFrequency } from './schema/types';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return [y, m, d];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Zona horaria IANA válida o UTC. */
export function safeTimeZone(raw: string | null | undefined): string {
  if (!raw) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return 'UTC';
  }
}

/** Día local (YYYY-MM-DD) en la zona indicada. */
export function localDayIn(timeZone: string, now: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return f.format(now);
}

/** Hora local (0–23) en la zona indicada. */
export function localHourIn(timeZone: string, now: Date): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(h) % 24;
}

/**
 * Siguiente fecha después de `from` para una regla que arrancó en `anchor`.
 * Mensual y anual conservan el día del ancla: el 31 cae el último día de los
 * meses más cortos y el 29 de febrero, el 28 en años no bisiestos.
 */
export function nextOccurrence(from: string, frequency: TrackRecurringFrequency, every: number, anchor: string): string {
  const step = Math.max(1, Math.floor(every) || 1);
  if (frequency === 'daily') return addDays(from, step);
  if (frequency === 'weekly') return addDays(from, 7 * step);
  const [fy, fm] = parts(from);
  const [, am, ad] = parts(anchor);
  if (frequency === 'monthly') {
    const index = fy * 12 + (fm - 1) + step;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return `${y}-${pad(m)}-${pad(Math.min(ad, daysInMonth(y, m)))}`;
  }
  const y = fy + step;
  return `${y}-${pad(am)}-${pad(Math.min(ad, daysInMonth(y, am)))}`;
}

/**
 * Próxima corrida estrictamente después de `today`, avanzando desde `from`
 * (si el tick estuvo parado varios períodos, se saltan sin crear de más).
 */
export function nextRunAfter(
  from: string,
  today: string,
  frequency: TrackRecurringFrequency,
  every: number,
  anchor: string,
): string {
  let next = nextOccurrence(from, frequency, every, anchor);
  for (let i = 0; i < 5000 && next <= today; i++) next = nextOccurrence(next, frequency, every, anchor);
  return next;
}

/** Primera corrida de una regla nueva: el día de inicio si no pasó, si no la siguiente. */
export function firstRunOn(startOn: string, today: string, frequency: TrackRecurringFrequency, every: number): string {
  if (startOn >= today) return startOn;
  return nextRunAfter(startOn, addDays(today, -1), frequency, every, startOn);
}

// ---------- Cycles automáticos ----------

interface CycleSpan {
  name: string;
  start_at: string;
  end_at: string;
}

export interface PlannedCycle {
  name: string;
  startAt: string;
  endAt: string;
}

function cycleNumber(name: string): number {
  return Number(/(\d+)\s*$/.exec(name)?.[1] ?? NaN);
}

/**
 * Cycles que faltan para que siempre haya uno en curso y uno próximo, de
 * `weeks` semanas. Si no hay ninguno en curso arranca hoy (y termina antes
 * del siguiente si ya hay uno planeado); el próximo empieza el día después
 * del último. Los nombres siguen la numeración ("Cycle 4" → "Cycle 5").
 */
export function planAutoCycles(cycles: CycleSpan[], today: string, weeks: number, prefix: string): PlannedCycle[] {
  const length = Math.max(1, Math.min(8, Math.floor(weeks) || 2)) * 7;
  const label = prefix.trim() || 'Cycle';
  const numbers = cycles.map((c) => cycleNumber(c.name)).filter((n) => Number.isFinite(n));
  let n = numbers.length > 0 ? Math.max(...numbers) : cycles.length;
  const spans = cycles.map((c) => ({ start: c.start_at.slice(0, 10), end: c.end_at.slice(0, 10) }));
  const planned: PlannedCycle[] = [];

  const hasActive = spans.some((c) => c.start <= today && c.end >= today);
  if (!hasActive) {
    let end = addDays(today, length - 1);
    const nextStart = spans
      .filter((c) => c.start > today)
      .map((c) => c.start)
      .sort()[0];
    if (nextStart && nextStart <= end) end = addDays(nextStart, -1);
    planned.push({ name: `${label} ${++n}`, startAt: today, endAt: end });
    spans.push({ start: today, end });
  }

  if (!spans.some((c) => c.start > today)) {
    const lastEnd = spans.map((c) => c.end).sort().pop() ?? today;
    const start = addDays(lastEnd > today ? lastEnd : today, 1);
    planned.push({ name: `${label} ${++n}`, startAt: start, endAt: addDays(start, length - 1) });
  }
  return planned;
}

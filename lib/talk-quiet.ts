/**
 * Talk: horario de no molestar (como el "Pausar notificaciones" con horario
 * de Slack). Funciones puras: sirven en el servidor (avisos, push, email) y
 * en el navegador (presencia).
 */

export interface DndSchedule {
  enabled: boolean;
  /** "HH:MM" en la zona horaria de la persona. */
  start: string;
  end: string;
  /** Días en que arranca el horario (0 = domingo … 6 = sábado). */
  days: number[];
}

export const DEFAULT_DND: DndSchedule = { enabled: false, start: '22:00', end: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };

export function validTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseDays(raw: string | null | undefined): number[] {
  return [...new Set(String(raw ?? '').split(',').map((d) => Number(d.trim())).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Día de la semana y minutos desde la medianoche en esa zona horaria. */
export function localClock(now: Date, tz: string): { day: number; minutes: number } {
  const zone = validTimeZone(tz) ? tz : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: Math.max(0, WEEKDAYS.indexOf(get('weekday'))), minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * ¿Ahora cae dentro del horario? Si termina antes de lo que empieza
 * (22:00 → 08:00) cruza la medianoche: la mañana cuenta para el día anterior.
 */
export function inDndSchedule(s: DndSchedule, tz: string, now = new Date()): boolean {
  if (!s.enabled || !validTime(s.start) || !validTime(s.end) || !s.days.length) return false;
  const { day, minutes } = localClock(now, tz);
  const start = toMinutes(s.start);
  const end = toMinutes(s.end);
  if (start === end) return s.days.includes(day);
  if (start < end) return s.days.includes(day) && minutes >= start && minutes < end;
  if (minutes >= start) return s.days.includes(day);
  if (minutes < end) return s.days.includes((day + 6) % 7);
  return false;
}

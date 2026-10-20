/**
 * CRM — tareas que se repiten (diaria, semanal o mensual). Puro: sin lib/db.
 * Al completar una tarea con repetición se crea la siguiente (lib/crm.ts →
 * updateActivity), con la fecha que calcula nextRepeatDue.
 */

export const TASK_REPEATS = ['none', 'daily', 'weekly', 'monthly'] as const;
export type TaskRepeat = (typeof TASK_REPEATS)[number];

export function isTaskRepeat(v: unknown): v is TaskRepeat {
  return typeof v === 'string' && (TASK_REPEATS as readonly string[]).includes(v);
}

const pad = (n: number) => String(n).padStart(2, '0');

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Parsea 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM[:SS]' (UTC, formato de la DB). */
function parseDbDate(s: string): { date: Date; hasTime: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  if (Number.isNaN(date.getTime())) return null;
  return { date, hasTime: m[4] !== undefined };
}

function formatDbDate(d: Date, hasTime: boolean, withSeconds: boolean): string {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (!hasTime) return day;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${day} ${time}${withSeconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
}

/**
 * Un paso de la serie. Mensual conserva el día del mes de `anchorDay` cuando
 * el mes lo tiene (31 ene → 28 feb → 31 mar).
 */
function step(d: Date, repeat: Exclude<TaskRepeat, 'none'>, anchorDay: number): Date {
  const out = new Date(d.getTime());
  if (repeat === 'daily') out.setUTCDate(out.getUTCDate() + 1);
  else if (repeat === 'weekly') out.setUTCDate(out.getUTCDate() + 7);
  else {
    const y = out.getUTCFullYear();
    const m = out.getUTCMonth() + 1;
    const year = y + Math.floor(m / 12);
    const month0 = m % 12;
    out.setUTCDate(1);
    out.setUTCFullYear(year, month0, Math.min(anchorDay, daysInMonth(year, month0)));
  }
  return out;
}

/**
 * Vencimiento de la próxima tarea de la serie. Parte del vencimiento actual
 * (o de `now` si la tarea no tenía) y avanza hasta quedar en el futuro: una
 * tarea diaria completada con una semana de atraso no deja siete vencidas.
 * Respeta el formato de entrada (solo fecha o fecha-hora).
 */
export function nextRepeatDue(dueAt: string | null, repeat: TaskRepeat, now: Date = new Date()): string | null {
  if (repeat === 'none') return null;
  const parsed = dueAt ? parseDbDate(dueAt) : null;
  const base = parsed?.date ?? now;
  const hasTime = parsed ? parsed.hasTime : true;
  const withSeconds = !!dueAt && /\d{2}:\d{2}:\d{2}/.test(dueAt);
  const anchorDay = base.getUTCDate();
  // Solo fecha: "en el futuro" = a partir de mañana (hoy ya está cumplida).
  const limit = hasTime ? now.getTime() : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let next = step(base, repeat, anchorDay);
  for (let i = 0; next.getTime() <= limit && i < 1000; i++) next = step(next, repeat, anchorDay);
  return formatDbDate(next, hasTime, withSeconds);
}

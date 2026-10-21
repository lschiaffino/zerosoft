/**
 * Track — momentos rápidos para posponer avisos y para "Recordarme" en un
 * issue, en la hora local del navegador: en 1 hora, mañana a las 9 y el
 * lunes que viene a las 9. Sin dependencias de servidor.
 */

export type SnoozePreset = 'hour' | 'tomorrow' | 'nextWeek';

export const SNOOZE_PRESETS: SnoozePreset[] = ['hour', 'tomorrow', 'nextWeek'];

/** Hora local a la que vuelven "mañana" y "la semana que viene". */
export const SNOOZE_MORNING_HOUR = 9;

export function snoozeAt(preset: SnoozePreset, now: Date): Date {
  if (preset === 'hour') return new Date(now.getTime() + 3_600_000);
  const d = new Date(now);
  d.setHours(SNOOZE_MORNING_HOUR, 0, 0, 0);
  if (preset === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return d;
  }
  // El lunes que viene (si hoy es lunes, el de la semana próxima).
  const offset = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + offset);
  return d;
}

/** Valor para <input type="datetime-local"> (hora local, sin segundos). */
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Fecha y hora cortas en el idioma de la persona ("mar 21 oct, 09:00"). */
export function formatWhenShort(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

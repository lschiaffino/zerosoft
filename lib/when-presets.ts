/**
 * Presets de "cuándo" que comparten Inbox (posponer, recordar si no contesta,
 * enviar más tarde) y Lines (enviar más tarde). Funciones puras, sirven en el
 * navegador y en el servidor.
 */

/**
 * Presets de "posponer" y "recordame si no contesta" a partir de ahora, en la
 * zona del navegador: más tarde (3 h), esta noche (20 h), mañana (8 h), el
 * fin de semana (sábado 9 h), la semana que viene (lunes 8 h), en una semana.
 */
export type SnoozePreset = 'later' | 'tonight' | 'tomorrow' | 'weekend' | 'nextWeek' | 'inWeek';
export const SNOOZE_PRESETS: readonly SnoozePreset[] = ['later', 'tonight', 'tomorrow', 'weekend', 'nextWeek', 'inWeek'];

export function presetDate(preset: SnoozePreset, now = new Date()): Date {
  const d = new Date(now);
  const at = (h: number) => {
    d.setHours(h, 0, 0, 0);
    return d;
  };
  switch (preset) {
    case 'later':
      return new Date(now.getTime() + 3 * 3600_000);
    case 'tonight': {
      at(20);
      if (d.getTime() <= now.getTime() + 30 * 60_000) d.setDate(d.getDate() + 1);
      return d;
    }
    case 'tomorrow':
      d.setDate(d.getDate() + 1);
      return at(8);
    case 'weekend': {
      const add = (6 - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + add);
      return at(9);
    }
    case 'nextWeek': {
      const add = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + add);
      return at(8);
    }
    case 'inWeek':
      d.setDate(d.getDate() + 7);
      return at(8);
  }
}

/** Fecha larga y corta a la vez: "mar, 11 nov, 08:00". */
export function longWhen(iso: string | null, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Valor para <input type="datetime-local"> en la zona del navegador. */
export function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

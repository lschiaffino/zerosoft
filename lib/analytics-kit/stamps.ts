/**
 * Instantes guardados como texto, para las analíticas que agregan en JS
 * (Talk, Voice): leer una fecha ISO o de SQLite y sumarla al mapa de calor.
 */
import { tzOffsetSec } from './period';

/** Un instante guardado como ISO o como 'YYYY-MM-DD HH:MM:SS' de SQLite (UTC), en ms. NaN si no se entiende. */
export function stampMs(v: string | null | undefined): number {
  if (!v) return NaN;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
  return Date.parse(s);
}

/** Grilla 7 × 24 con un instante sumado en su día de la semana (0 = lunes) y hora local. */
export function heatAdd(heat: number[][], ms: number, tz: string, n = 1): void {
  if (!Number.isFinite(ms)) return;
  const local = new Date(ms + tzOffsetSec(ms, tz) * 1000);
  heat[(local.getUTCDay() + 6) % 7][local.getUTCHours()] += n;
}

import type { ComponentStatus } from './components';
import type { DayBucket } from './store';

/** Cálculos de la página pública, sin React ni DB (los prueban los tests unitarios). */

export interface DayBar {
  day: number;
  /** none = sin datos ese día. */
  tone: 'none' | 'up' | 'degraded' | 'down';
  up: number;
  degraded: number;
  down: number;
}

export function dayBars(days: DayBucket[], today: number, count = 90): DayBar[] {
  const byDay = new Map(days.map((d) => [d[0], d]));
  const out: DayBar[] = [];
  for (let day = today - count + 1; day <= today; day++) {
    const b = byDay.get(day);
    if (!b || b[1] + b[2] + b[3] === 0) {
      out.push({ day, tone: 'none', up: 0, degraded: 0, down: 0 });
      continue;
    }
    const [, up, degraded, down] = b;
    out.push({ day, tone: down > 0 ? 'down' : degraded > 0 ? 'degraded' : 'up', up, degraded, down });
  }
  return out;
}

/** Disponibilidad en % (los minutos degradados cuentan como disponibles), o null sin datos. */
export function uptimePct(bars: DayBar[]): number | null {
  let total = 0;
  let down = 0;
  for (const b of bars) {
    total += b.up + b.degraded + b.down;
    down += b.down;
  }
  if (total === 0) return null;
  return Math.floor(((total - down) / total) * 10_000) / 100;
}

export function overallStatus(list: ComponentStatus[]): ComponentStatus {
  if (list.includes('down')) return 'down';
  if (list.includes('degraded')) return 'degraded';
  if (list.length && list.every((s) => s === 'unknown')) return 'unknown';
  return 'up';
}

export function durationParts(ms: number): { unit: 'minutes' | 'hours'; n: number } {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 120) return { unit: 'minutes', n: m };
  return { unit: 'hours', n: Math.round(m / 6) / 10 };
}

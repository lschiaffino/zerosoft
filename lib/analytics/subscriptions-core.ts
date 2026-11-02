/**
 * Suscripciones, sin base de datos: cuándo toca la próxima entrega y qué dice
 * el resumen de un insight en un email.
 */

import { z } from 'zod';
import { fromLocal, offsetMsAt, type Tz } from './tz';
import type { InsightResult } from './types';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const SUBSCRIPTION_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const subscriptionScheduleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  /** Cada cuántos días, semanas o meses. */
  interval: z.number().int().min(1).max(52).default(1),
  /** Hora local del proyecto. */
  hour: z.number().int().min(0).max(23).default(9),
  /** Días de la semana (0 domingo), si es semanal. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** Mensual: un día del mes, o "el último viernes". */
  monthDay: z.number().int().min(1).max(31).nullable().optional(),
  ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]).nullable().optional(),
  ordinalDay: z.enum([...SUBSCRIPTION_DAYS, 'day', 'weekday']).nullable().optional(),
});
export type SubscriptionSchedule = z.infer<typeof subscriptionScheduleSchema>;

/** ¿Esa fecha local es el día del mes que pide la regla? */
function matchesMonth(s: SubscriptionSchedule, y: number, m: number, d: number): boolean {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (s.ordinal && s.ordinalDay) {
    const fits = (day: number) => {
      const wd = new Date(Date.UTC(y, m, day)).getUTCDay();
      if (s.ordinalDay === 'day') return true;
      if (s.ordinalDay === 'weekday') return wd >= 1 && wd <= 5;
      return SUBSCRIPTION_DAYS[wd] === s.ordinalDay;
    };
    const days = Array.from({ length: last }, (_, i) => i + 1).filter(fits);
    const pick = s.ordinal === -1 ? days[days.length - 1] : days[s.ordinal - 1];
    return pick === d;
  }
  // Un 31 en un mes corto cae el último día.
  return Math.min(s.monthDay ?? 1, last) === d;
}

/** La próxima entrega estrictamente después de `after`. `anchor`: desde cuándo se cuenta el intervalo. */
export function nextDelivery(s: SubscriptionSchedule, after: number, anchor: number, tz: Tz = 0): number {
  const anchorLocal = anchor + offsetMsAt(tz, anchor);
  const anchorDay = Math.floor(anchorLocal / DAY);
  const anchorDate = new Date(anchorDay * DAY);
  const anchorMonth = anchorDate.getUTCFullYear() * 12 + anchorDate.getUTCMonth();
  // Lunes de la semana del ancla: las semanas se cuentan de lunes a domingo.
  const weekOf = (day: number) => Math.floor((day + 3) / 7);
  const anchorWeek = weekOf(anchorDay);
  const interval = Math.max(1, s.interval ?? 1);
  const weekdays = s.weekdays?.length ? s.weekdays : [new Date(anchorDay * DAY).getUTCDay()];
  const startDay = Math.floor((after + offsetMsAt(tz, after)) / DAY);
  for (let day = startDay; day < startDay + 1500; day++) {
    const date = new Date(day * DAY);
    let ok = false;
    if (s.frequency === 'daily') ok = ((day - anchorDay) % interval + interval) % interval === 0;
    if (s.frequency === 'weekly') ok = weekdays.includes(date.getUTCDay()) && ((weekOf(day) - anchorWeek) % interval + interval) % interval === 0;
    if (s.frequency === 'monthly') {
      const month = date.getUTCFullYear() * 12 + date.getUTCMonth();
      ok = ((month - anchorMonth) % interval + interval) % interval === 0 && matchesMonth(s, date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }
    if (!ok) continue;
    const at = fromLocal(day * DAY + (s.hour ?? 9) * HOUR, tz);
    if (at > after) return at;
  }
  return after + 365 * DAY;
}

export interface SummaryTable {
  head: string[];
  rows: string[][];
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const MAX_ROWS = 12;

/** Lo que un insight dice en un email: una tabla corta, sin ids de personas. */
export function summarize(r: InsightResult): SummaryTable | null {
  switch (r.kind) {
    case 'trends':
      return { head: ['Series', 'Total'], rows: r.series.slice(0, MAX_ROWS).map((s) => [s.breakdownValue ? `${s.label} · ${s.breakdownValue === '$other' ? 'Other' : s.breakdownValue}` : s.label, String(s.total)]) };
    case 'funnel':
      return { head: ['Step', 'Count', 'Conversion'], rows: r.steps.slice(0, MAX_ROWS).map((s) => [s.label, String(s.count), pct(s.conversion)]) };
    case 'retention': {
      const live = r.cohorts.filter((c) => c.size > 0).slice(-MAX_ROWS);
      return { head: ['Cohort', 'Size', 'Period 1'], rows: live.map((c) => [c.start, String(c.size), c.values[1] === undefined ? '' : pct(c.size ? c.values[1] / c.size : 0)]) };
    }
    case 'paths':
      return { head: ['Path', 'Sessions'], rows: r.topPaths.slice(0, MAX_ROWS).map((p) => [p.path.join(' > '), String(p.count)]) };
    case 'stickiness':
      return { head: ['Series', 'Total'], rows: r.series.slice(0, MAX_ROWS).map((s) => [s.label, String(s.data.reduce((a, b) => a + b, 0))]) };
    case 'lifecycle': {
      const total = (k: 'new' | 'returning' | 'resurrecting' | 'dormant') => String(r[k].reduce((a, b) => a + Math.abs(b), 0));
      return { head: ['Group', 'Total'], rows: [['New', total('new')], ['Returning', total('returning')], ['Came back', total('resurrecting')], ['Stopped', total('dormant')]] };
    }
    default:
      return null;
  }
}

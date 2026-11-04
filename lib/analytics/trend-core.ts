/**
 * Cuentas de tendencias sin base de datos: promedio móvil, días de semana,
 * activos en una ventana móvil y formato de valores.
 */

import type { Interval, TrendOptions } from './types';

const DAY = 86_400_000;

/** Promedio de las últimas `n` cubetas. Si hay menos, de las que haya. */
export function rolling(data: number[], n: number): number[] {
  return data.map((_, i) => {
    const from = Math.max(0, i - n + 1);
    const part = data.slice(from, i + 1);
    return Math.round((part.reduce((a, b) => a + b, 0) / part.length) * 100) / 100;
  });
}

/** ¿La etiqueta de cubeta diaria ('YYYY-MM-DD') cae sábado o domingo? */
export function isWeekend(bucket: string): boolean {
  const d = new Date(`${bucket.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY);
}

function dayLabel(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

/** El último día local de una cubeta, sin pasarse de `lastDay` (hoy o el final del rango). */
export function bucketEndDay(bucket: string, interval: Interval, lastDay: string): string {
  const day = bucket.slice(0, 10);
  let end = day;
  if (interval === 'week') end = dayLabel(dayNumber(day) + 6);
  if (interval === 'month') {
    const d = new Date(`${day}T00:00:00Z`);
    end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  return end > lastDay ? lastDay : end;
}

/**
 * Activos en una ventana móvil: para cada cubeta, gente distinta en los `days`
 * días que terminan en el final de esa cubeta.
 */
export function activeInWindow(rows: Array<{ day: string; person: string }>, buckets: string[], interval: Interval, days: number, lastDay: string): number[] {
  const byDay = new Map<number, Set<string>>();
  for (const r of rows) {
    const k = dayNumber(r.day);
    let s = byDay.get(k);
    if (!s) byDay.set(k, (s = new Set()));
    s.add(r.person);
  }
  return buckets.map((b) => {
    const end = dayNumber(bucketEndDay(b, interval, lastDay));
    const seen = new Set<string>();
    for (let d = end - days + 1; d <= end; d++) for (const p of byDay.get(d) ?? []) seen.add(p);
    return seen.size;
  });
}

function shortNumber(v: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

function duration(ms: number): string {
  const neg = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  if (abs < 1000) return `${neg}${Math.round(abs)}ms`;
  const s = Math.round(abs / 1000);
  if (s < 60) return `${neg}${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${neg}${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${neg}${h}h ${m % 60}m`;
  return `${neg}${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Un valor con la unidad y el prefijo o sufijo que eligió el insight. */
export function formatTrendValue(v: number, options: TrendOptions | null | undefined, locale?: string): string {
  const unit = options?.unit ?? 'none';
  let text: string;
  switch (unit) {
    case 'short':
      text = shortNumber(v, locale);
      break;
    case 'duration':
      text = duration(v * 1000);
      break;
    case 'duration_ms':
      text = duration(v);
      break;
    case 'percentage':
      text = `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v)}%`;
      break;
    case 'currency':
      text = new Intl.NumberFormat(locale, { style: 'currency', currency: options?.currency || 'USD', maximumFractionDigits: 2 }).format(v);
      break;
    default:
      text = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
  }
  return `${options?.prefix ?? ''}${text}${options?.suffix ?? ''}`;
}

/**
 * Social: cuentas de tiempo (puro). Reintentos con backoff, los próximos
 * horarios libres de la cola y los mejores horarios según lo publicado.
 */
import { zonedTime } from './groups-recurrence';

/** Intentos máximos por destino antes de dejarlo en "falló". */
export const MAX_ATTEMPTS = 5;

/** Espera antes del intento `attempt` (1 = primer reintento): 1, 5, 15, 60 minutos. */
export function backoffMs(attempt: number): number {
  const steps = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
  return steps[Math.min(Math.max(attempt, 1), steps.length) - 1];
}

/** Errores que no se arreglan reintentando (token vencido, contenido rechazado, sin permiso). */
export function isPermanentError(code: string): boolean {
  return ['token_expired', 'not_authorized', 'invalid_media', 'invalid_content', 'not_configured', 'account_disconnected', 'validation', 'duplicate', 'unknown_state', 'timeout', 'author_access'].includes(code);
}

export interface Slot {
  weekday: number;
  minute: number;
  tz: string;
}

function localDay(date: Date, tz: string): { y: number; m: number; d: number; weekday: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday)) };
}

/**
 * Los próximos `count` horarios de la cola después de `from` que no estén
 * tomados (`taken`: instantes ya programados en esa cuenta, en ms; se
 * considera tomado si hay algo a menos de un minuto). Mira hasta 8 semanas.
 */
export function nextSlots(slots: readonly Slot[], from: Date, taken: readonly number[] = [], count = 1): Date[] {
  if (!slots.length) return [];
  const out: Date[] = [];
  const takenSet = taken.map((t) => Math.floor(t / 60_000));
  for (let day = 0; day < 56 && out.length < count; day++) {
    const candidates: Date[] = [];
    for (const s of slots) {
      const base = localDay(new Date(from.getTime() + day * 86_400_000), s.tz);
      if (base.weekday !== s.weekday) continue;
      candidates.push(zonedTime(base.y, base.m, base.d, s.minute, s.tz));
    }
    candidates.sort((a, b) => a.getTime() - b.getTime());
    for (const c of candidates) {
      if (c.getTime() <= from.getTime()) continue;
      if (takenSet.includes(Math.floor(c.getTime() / 60_000))) continue;
      if (out.some((o) => o.getTime() === c.getTime())) continue;
      out.push(c);
      if (out.length >= count) break;
    }
  }
  return out;
}

export interface PublishedSample {
  publishedAt: string;
  engagement: number;
  impressions: number;
}

export interface BestTime {
  weekday: number;
  hour: number;
  /** Interacciones promedio por publicación en ese horario (null en los horarios por defecto). */
  score: number | null;
}

/** Mínimo de publicaciones con métricas para sugerir con datos propios. */
export const BEST_TIME_MIN_SAMPLES = 10;

/**
 * Horarios por defecto cuando todavía no hay datos: martes a jueves a las 9,
 * 12 y 17 (hora local). No salen de ningún estudio: son un punto de partida
 * y la pantalla lo dice.
 */
export const DEFAULT_BEST_TIMES: readonly BestTime[] = [
  { weekday: 2, hour: 9, score: null },
  { weekday: 3, hour: 12, score: null },
  { weekday: 4, hour: 17, score: null },
  { weekday: 2, hour: 12, score: null },
  { weekday: 3, hour: 9, score: null },
];

/**
 * Mejores horarios según lo que ya se publicó: agrupa por día de la semana y
 * hora local (en `tz`) y ordena por interacciones promedio. Con menos de
 * BEST_TIME_MIN_SAMPLES publicaciones devuelve los horarios por defecto.
 */
export function bestTimes(samples: readonly PublishedSample[], tz: string, top = 5): { source: 'data' | 'default'; times: BestTime[]; samples: number } {
  if (samples.length < BEST_TIME_MIN_SAMPLES) return { source: 'default', times: DEFAULT_BEST_TIMES.slice(0, top), samples: samples.length };
  const buckets = new Map<string, { weekday: number; hour: number; sum: number; n: number }>();
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  for (const s of samples) {
    const at = new Date(s.publishedAt.includes('T') ? s.publishedAt : `${s.publishedAt.replace(' ', 'T')}Z`);
    if (Number.isNaN(at.getTime())) continue;
    const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday));
    const hour = Number(p.hour) % 24;
    const key = `${weekday}:${hour}`;
    const b = buckets.get(key) ?? { weekday, hour, sum: 0, n: 0 };
    b.sum += s.engagement;
    b.n += 1;
    buckets.set(key, b);
  }
  const times = [...buckets.values()]
    .map((b) => ({ weekday: b.weekday, hour: b.hour, score: Math.round((b.sum / b.n) * 10) / 10 }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, top);
  return { source: 'data', times, samples: samples.length };
}

/** El próximo instante (después de `from`) que cae en ese día y hora local. */
export function nextAt(weekday: number, hour: number, tz: string, from: Date = new Date()): Date {
  return nextSlots([{ weekday, minute: hour * 60, tz }], from, [], 1)[0];
}

/**
 * Zona horaria de quien mira la app. El navegador la guarda en la cookie `tz`
 * (components/app/TimezoneCookie.tsx); fuera de una request (cron, tests) o sin
 * cookie se usa UTC. Server-only.
 */
export const TZ_COOKIE = 'tz';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getUserTimeZone(): Promise<string> {
  try {
    const { cookies } = await import('next/headers');
    const value = (await cookies()).get(TZ_COOKIE)?.value;
    if (value && value.length <= 64 && isValidTimeZone(value)) return value;
  } catch {
    /* fuera de una request */
  }
  return 'UTC';
}

/** Minutos que `tz` le lleva a UTC en el instante `at` (Buenos Aires → -180). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

function sqlUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/** El día de hoy en `tz`, como rango UTC 'YYYY-MM-DD HH:MM:SS' (formato de la DB). */
export function dayRangeUtc(tz: string, at: Date = new Date()): { start: string; end: string } {
  const offset = tzOffsetMinutes(tz, at);
  const local = new Date(at.getTime() + offset * 60000);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = midnightLocalAsUtc - offset * 60000;
  return { start: sqlUtc(start), end: sqlUtc(start + 86_400_000 - 1000) };
}

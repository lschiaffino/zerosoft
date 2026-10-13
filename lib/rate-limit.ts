import { NextResponse } from 'next/server';
import { getDb } from './db';

/**
 * Rate limit de ventana fija guardado en la misma base (tabla rate_limits).
 * Compartido entre todas las instancias serverless, sin infraestructura extra
 * (sirve igual en self-host). Un UPSERT por request limitada.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number; // epoch ms
}

let lastCleanup = 0;

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const db = getDb();
  const row = (await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .get(key, windowStart, windowStart + windowMs)) as { count: number } | undefined;
  const count = Number(row?.count ?? 1);

  // Limpieza perezosa de ventanas vencidas (como mucho una vez por minuto por instancia).
  if (now - lastCleanup > 60_000) {
    lastCleanup = now;
    db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').run(now).catch(() => {});
  }

  return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt: windowStart + windowMs };
}

/** IP del cliente. En Vercel x-forwarded-for la pone el edge (no la controla el cliente). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-forwarded-for') ?? '';
  return fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Limita por IP (y opcionalmente por un sufijo, p. ej. el slug). Devuelve una
 * respuesta 429 lista para retornar, o null si la request puede seguir.
 */
export async function limitByIp(
  req: Request,
  bucket: string,
  limit: number,
  windowSec: number,
  suffix = '',
): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  const key = `${bucket}:${clientIp(req)}${suffix ? `:${suffix}` : ''}`;
  const res = await rateLimit(key, limit, windowSec);
  if (res.ok) return null;
  return NextResponse.json(
    { error: 'rate_limited' },
    {
      status: 429,
      headers: { 'retry-after': String(Math.max(1, Math.ceil((res.resetAt - Date.now()) / 1000))) },
    },
  );
}

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

/** Cuántas veces se contó la clave en la ventana actual (sin sumar). */
export async function peekCount(key: string, windowSec: number): Promise<number> {
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const row = (await getDb()
    .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
    .get(key, windowStart)) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

/** ¿La clave ya pasó el límite en la ventana actual? Solo lee (no cuenta este intento). */
export async function isRateLimited(key: string, limit: number, windowSec: number): Promise<boolean> {
  const windowMs = windowSec * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const row = (await getDb()
    .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start = ?')
    .get(key, windowStart)) as { count: number } | undefined;
  return Number(row?.count ?? 0) >= limit;
}

/**
 * IP del cliente para limitar pedidos.
 *
 * - En Vercel: x-vercel-forwarded-for (lo escribe el edge; el cliente no lo controla).
 * - Fuera de Vercel (self-host detrás de un proxy): la entrada de
 *   x-forwarded-for que agregó el proxy inmediato, contando desde la derecha
 *   (TRUST_PROXY_HOPS, por defecto 1). Las de la izquierda las puede inventar
 *   el cliente; la de la derecha la puso nuestro proxy. Si no hay, x-real-ip.
 * - TRUST_PROXY=0: no se confía en ningún header (todo cae en 'unknown').
 * - Sin headers: 'unknown' (un solo cupo, como sin proxy).
 */
export function clientIp(req: Request): string {
  if (process.env.TRUST_PROXY === '0') return 'unknown';
  const h = req.headers;
  if (process.env.VERCEL) {
    const v = h.get('x-vercel-forwarded-for') ?? h.get('x-forwarded-for') ?? '';
    return v.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  }
  const list = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (list.length) {
    const hops = Math.max(1, Math.floor(Number(process.env.TRUST_PROXY_HOPS) || 1));
    return list[Math.max(0, list.length - hops)];
  }
  return h.get('x-real-ip')?.trim() || 'unknown';
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

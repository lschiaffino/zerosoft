/**
 * Shop: sesión, errores y límites de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './session';
import { userCanUseApp } from './workspace';
import { clientIp, isRateLimited, limitByIp, rateLimit } from './rate-limit';
import { UploadError } from './uploads';
import { UnsafeUrlError } from './safe-fetch';
import { ShopError, type ShopActor } from './shop-schema';

export function shopJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

export function shopFail(err: unknown) {
  if (err instanceof ShopError) return shopJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof UploadError) return shopJson({ error: err.code }, err.status);
  if (err instanceof UnsafeUrlError) return shopJson({ error: 'unsafe_url' }, 400);
  throw err;
}

export function actorOf(user: SessionUser): ShopActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, person: person.id, admin: user.role === 'owner' || user.role === 'admin' };
}

/** Sesión con Shop en el workspace activo (guest nunca). */
export async function shopActor(): Promise<{ actor: ShopActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'shop')) return { res: shopJson({ error: 'unauthorized' }, 401) };
  return { actor: actorOf(user), user };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Límite por IP de las rutas públicas (checkout, códigos, búsqueda de pedidos). */
export function shopLimit(req: Request, bucket: string, limit: number, windowSec: number, suffix = '') {
  return limitByIp(req, `shop:${bucket}`, limit, windowSec, suffix);
}

/**
 * Adivinar códigos de descuento: solo cuentan los códigos que no existen
 * (un cliente que escribe su dirección con un código válido re-precia muchas
 * veces y no se gasta nada). 20 códigos inexistentes por IP y tienda cada 10
 * minutos; pasado el tope, cualquier código se rechaza hasta que se libera.
 */
const CODE_MISS_LIMIT = 20;
const CODE_MISS_WINDOW = 600;

function codeMissKey(req: Request, handle: string): string {
  return `shop:code-miss:${clientIp(req)}:${handle}`;
}

export async function codeGuessBlocked(req: Request, handle: string): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  if (!(await isRateLimited(codeMissKey(req, handle), CODE_MISS_LIMIT, CODE_MISS_WINDOW))) return null;
  return shopJson({ error: 'rate_limited' }, 429, { 'retry-after': String(CODE_MISS_WINDOW) });
}

export async function countCodeMiss(req: Request, handle: string): Promise<void> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return;
  await rateLimit(codeMissKey(req, handle), CODE_MISS_LIMIT, CODE_MISS_WINDOW).catch(() => undefined);
}

/** Origen público para armar URLs de retorno (el de la app, no el que manda el cliente). */
export function publicOrigin(req: Request): string {
  const env = process.env.NEXTAUTH_URL?.replace(/\/$/, '');
  if (env) return env;
  return new URL(req.url).origin;
}

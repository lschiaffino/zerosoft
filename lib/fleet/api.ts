/**
 * Fleet: sesión, errores y helpers de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, type SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { rateLimit } from '../rate-limit';
import type { FleetActor } from './core';
import { FleetError } from './types';

const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };

export function fleetActorOf(user: SessionUser): FleetActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, person: person.id, email: (person.email ?? '').toLowerCase(), name: person.name ?? person.email ?? '' };
}

export function fJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...(headers ?? {}) } });
}

export function fFail(err: unknown) {
  if (err instanceof FleetError) return fJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof ZodError) return fJson({ error: 'invalid_input' }, 400);
  throw err;
}

/** Sesión con Fleet en el workspace activo (guest nunca). */
export async function fleetActor(): Promise<{ actor: FleetActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'fleet') || user.role === 'guest') return { res: fJson({ error: 'unauthorized' }, 401) };
  return { actor: fleetActorOf(user), user };
}

/** Corre el handler con el actor y traduce los errores conocidos. */
export async function withFleet(fn: (a: { actor: FleetActor; user: SessionUser }) => Promise<Response>): Promise<Response> {
  const a = await fleetActor();
  if ('res' in a) return a.res;
  try {
    return await fn(a);
  } catch (err) {
    return fFail(err);
  }
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S, maxBytes = 64 * 1024): Promise<z.infer<S>> {
  const raw = await req.text().catch(() => '');
  if (raw.length > maxBytes) throw new FleetError('too_large', 413);
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new FleetError('invalid_input', 400);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new FleetError('invalid_input', 400);
  return parsed.data;
}

/** Límite por clave (token, persona): 429 con Retry-After si se pasa. */
export async function limit(key: string, max: number, windowSec: number): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return null;
  const r = await rateLimit(`fleet:${key}`, max, windowSec);
  if (r.ok) return null;
  return fJson({ error: 'rate_limited' }, 429, { 'retry-after': String(Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))) });
}

/** URL pública de esta instancia (la del pedido si no hay NEXT_PUBLIC_SITE_URL). */
export function baseUrlOf(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || '';
  if (env) return env.replace(/\/$/, '');
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host;
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '');
  return `${proto}://${host}`;
}

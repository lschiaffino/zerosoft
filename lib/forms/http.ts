/**
 * Forms: sesión, errores y límites de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, type SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { limitByIp } from '../rate-limit';
import { FormsError, type FormsActor } from './types';

export function fJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

export function fFail(err: unknown) {
  if (err instanceof FormsError) return fJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof ZodError) return fJson({ error: 'invalid_input' }, 400);
  throw err;
}

export function actorOf(user: SessionUser): FormsActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, person: person.id, admin: user.role === 'owner' || user.role === 'admin', crm: userCanUseApp(user, 'crm') };
}

/** Sesión con Forms en el workspace activo (guest nunca). */
export async function formsActor(): Promise<{ actor: FormsActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'forms') || user.role === 'guest') return { res: fJson({ error: 'unauthorized' }, 401) };
  return { actor: actorOf(user), user };
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new FormsError('invalid_input', 400);
  return parsed.data;
}

export function formsLimit(req: Request, bucket: string, limit: number, windowSec: number, suffix = '') {
  return limitByIp(req, `forms:${bucket}`, limit, windowSec, suffix);
}

/** CORS para las rutas públicas (envío desde el embed en otro dominio). */
export const PUBLIC_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

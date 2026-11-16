/**
 * Time: sesión, errores y límites de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, type SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { limitByIp } from '../rate-limit';
import { TimeError, type TimeActor } from './types';

export function tJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store', ...(headers ?? {}) } });
}

export function tFail(err: unknown) {
  if (err instanceof TimeError) return tJson({ error: err.code }, err.status);
  if (err instanceof ZodError) return tJson({ error: 'invalid_input' }, 400);
  throw err;
}

export function timeActorOf(user: SessionUser): TimeActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, person: person.id, admin: user.role === 'owner' || user.role === 'admin', email: (person.email ?? '').toLowerCase(), name: person.name ?? person.email ?? '' };
}

/** Sesión con Time en el workspace activo (guest nunca). */
export async function timeActor(): Promise<{ actor: TimeActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'time') || user.role === 'guest') return { res: tJson({ error: 'unauthorized' }, 401) };
  return { actor: timeActorOf(user), user };
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new TimeError('invalid_input', 400);
  return parsed.data;
}

export function timeLimit(req: Request, bucket: string, limit: number, windowSec: number, suffix = '') {
  return limitByIp(req, `time:${bucket}`, limit, windowSec, suffix);
}

export type Ctx<P extends string = 'id'> = { params: Promise<Record<P, string>> };

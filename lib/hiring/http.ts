/**
 * Hiring: sesión, errores y límites de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, type SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { limitByIp } from '../rate-limit';
import { UploadError } from '../uploads';
import { HiringError, type HiringActor } from './types';

export function hJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

export function hFail(err: unknown) {
  if (err instanceof HiringError) return hJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof UploadError) return hJson({ error: err.code }, err.status);
  if (err instanceof ZodError) return hJson({ error: 'invalid_input' }, 400);
  throw err;
}

export function actorOf(user: SessionUser): HiringActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, person: person.id, admin: user.role === 'owner' || user.role === 'admin' };
}

/** Sesión con Hiring en el workspace activo (guest nunca). */
export async function hiringActor(): Promise<{ actor: HiringActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'hiring') || user.role === 'guest') return { res: hJson({ error: 'unauthorized' }, 401) };
  return { actor: actorOf(user), user };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new HiringError('invalid_input', 400);
  return parsed.data;
}

export function hiringLimit(req: Request, bucket: string, limit: number, windowSec: number, suffix = '') {
  return limitByIp(req, `hiring:${bucket}`, limit, windowSec, suffix);
}

export type Ctx<P extends string = 'id'> = { params: Promise<Record<P, string>> };

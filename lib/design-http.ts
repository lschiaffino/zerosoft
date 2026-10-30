/**
 * Design: sesión y errores de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './session';
import { AiError } from './ai';
import { limitWrites } from './write-limit';
import { DesignError, type DesignActor } from './design';

export function designJson<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function designFail(err: unknown) {
  if (err instanceof DesignError) return designJson({ error: err.code }, err.status);
  if (err instanceof AiError) return designJson({ error: err.code }, err.code === 'ai_disabled' ? 503 : 429);
  throw err;
}

/** Quién pide (sin pasar por los helpers de sesión: Cmd+K y el inicio lo llaman con el usuario resuelto). */
export function designActorOf(user: SessionUser): DesignActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, personId: person.id, admin: user.role === 'owner' || user.role === 'admin', name: person.name || person.email || '' };
}

/**
 * Sesión con acceso a Design. getCurrentUser ya devuelve null en la API de
 * una app que la persona no tiene en el workspace (acceso por app).
 */
export async function designActor(opts: { write?: boolean } = {}): Promise<{ actor: DesignActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { res: designJson({ error: 'unauthorized' }, 401) };
  const actor = designActorOf(user);
  if (opts.write) {
    const limited = await limitWrites('design:write', actor.personId, 120);
    if (limited) return { res: limited };
  }
  return { actor, user };
}

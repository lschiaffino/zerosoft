/**
 * Social: helpers de las rutas /api/social/*. Sesión → actor, acceso por app,
 * límites de escritura y errores con código (SocialError → JSON).
 */
import { NextResponse } from 'next/server';
import type { z, ZodTypeAny } from 'zod';
import { getCurrentUser, userCanUseApp, type SessionUser } from './session';
import { SocialError, socialActor, type SocialActor } from './social';
import { jsonError, limitWrites } from './write-limit';

export type SocialCtx = { actor: SocialActor; user: SessionUser };

export async function socialSession(opts: { write?: string; limit?: number } = {}): Promise<SocialCtx | NextResponse> {
  const user = await getCurrentUser();
  // Sin la app en el workspace activo responde como sin sesión (igual que lib/session para /api/<app>).
  if (!user || !userCanUseApp(user, 'social') || user.role === 'guest') return jsonError(401, 'unauthorized');
  const actor = socialActor(user);
  if (opts.write) {
    const limited = await limitWrites(`social:${opts.write}`, actor.personId, opts.limit ?? 120);
    if (limited) return limited;
  }
  return { actor, user };
}

export function socialError(err: unknown): NextResponse {
  if (err instanceof SocialError) {
    return NextResponse.json({ error: err.code, ...(err.details !== undefined ? { details: err.details } : {}) }, { status: err.status });
  }
  console.error('[social]', err instanceof Error ? err.message : 'error');
  return jsonError(500, 'server_error');
}

export async function readBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S> | null> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

export async function withSocial(fn: (ctx: SocialCtx) => Promise<NextResponse | Response>, opts: { write?: string; limit?: number } = {}): Promise<NextResponse | Response> {
  const ctx = await socialSession(opts);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return await fn(ctx);
  } catch (err) {
    return socialError(err);
  }
}

/**
 * Talk: helpers de las rutas /api/talk/*. Sesión → actor, límites de
 * escritura y errores con código (TalkError → JSON).
 */
import { NextResponse } from 'next/server';
import type { z, ZodTypeAny } from 'zod';
import { getCurrentUser, type SessionUser } from './session';
import { TalkError, talkActor, type TalkActor } from './talk';
import { jsonError, limitWrites } from './write-limit';

export type TalkHandlerCtx = { actor: TalkActor; user: SessionUser };

/** Sesión + actor, o la respuesta 401 lista. `write` aplica el rate limit de escrituras. */
export async function talkSession(opts: { write?: string; limit?: number } = {}): Promise<TalkHandlerCtx | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const actor = talkActor(user);
  if (opts.write) {
    const limited = await limitWrites(`talk:${opts.write}`, actor.personId, opts.limit ?? 240);
    if (limited) return limited;
  }
  return { actor, user };
}

export function talkError(err: unknown): NextResponse {
  if (err instanceof TalkError) return jsonError(err.status, err.code);
  if (/UNIQUE|constraint/i.test(String(err))) return jsonError(409, 'conflict');
  console.error('[talk]', err);
  return jsonError(500, 'server_error');
}

/** Body JSON validado con zod, o null (la ruta responde invalid_input). */
export async function readBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S> | null> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

/** Corre el handler con sesión y errores normalizados. */
export async function withTalk(
  fn: (ctx: TalkHandlerCtx) => Promise<NextResponse | Response>,
  opts: { write?: string; limit?: number } = {},
): Promise<NextResponse | Response> {
  const ctx = await talkSession(opts);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return await fn(ctx);
  } catch (err) {
    return talkError(err);
  }
}

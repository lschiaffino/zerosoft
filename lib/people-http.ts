/**
 * People: sesión, errores y lectura del cuerpo en las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './session';
import { userCanUseApp } from './workspace';
import { peopleContext, PeopleError, type PeopleCtx } from './people';

export function pjson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...(headers ?? {}) } });
}

export function pfail(err: unknown) {
  if (err instanceof PeopleError) return pjson({ error: err.code }, err.status);
  throw err;
}

/** Contexto de People de la sesión (sin la app o guest: 401, como el resto de las apps). */
export async function sessionCtx(user: SessionUser): Promise<PeopleCtx> {
  const person = user.actingUser ?? user;
  return peopleContext(user.id, person.id, user.role);
}

export async function peopleActor(): Promise<{ ctx: PeopleCtx; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'people')) return { res: pjson({ error: 'unauthorized' }, 401) };
  return { ctx: await sessionCtx(user), user };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Corre el handler con el contexto y traduce los errores de People. */
export async function withPeople(run: (ctx: PeopleCtx, user: SessionUser) => Promise<Response>): Promise<Response> {
  const a = await peopleActor();
  if ('res' in a) return a.res;
  try {
    return await run(a.ctx, a.user);
  } catch (err) {
    return pfail(err);
  }
}

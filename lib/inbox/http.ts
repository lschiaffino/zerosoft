/**
 * Inbox: sesión y respuestas de las rutas API. Server-only.
 *
 * Quién: siempre la persona real de la sesión (realUserId), sin importar el
 * workspace activo ni su rol. Las operaciones del MCP (tokens delegados) no
 * entran: los mensajes personales no se leen con una API key ni desde un
 * agente.
 */
import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, realUserId } from '../session';
import { delegatedIdentity } from '../mcp/identity';
import { InboxError } from './types';

const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

export function iJson<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function iFail(err: unknown) {
  if (err instanceof InboxError) return iJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof ZodError) return iJson({ error: 'invalid_input' }, 400);
  throw err;
}

/** La persona de la sesión, o la respuesta 401. */
export async function inboxOwner(): Promise<{ owner: string } | { res: NextResponse }> {
  if (delegatedIdentity()) return { res: iJson({ error: 'unauthorized' }, 401) };
  const user = await getCurrentUser();
  if (!user) return { res: iJson({ error: 'unauthorized' }, 401) };
  return { owner: realUserId(user) };
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new InboxError('invalid_input', 400);
  return parsed.data;
}

/** Corre el handler con la persona y traduce los errores conocidos. */
export async function withOwner(fn: (owner: string) => Promise<NextResponse>): Promise<NextResponse> {
  const a = await inboxOwner();
  if ('res' in a) return a.res;
  try {
    return await fn(a.owner);
  } catch (err) {
    return iFail(err);
  }
}

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
import { roleAtLeast } from '../teams';
import { delegatedIdentity } from '../mcp/identity';
import { conditionalJson } from '../etag';
import { InboxError } from './types';
import { EMPTY_INTERNAL_SET, loadInternalSet, type InternalSet } from '../internal-contacts';

const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

export function iJson<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Como iJson, con ETag: 304 si quien pide ya tiene este contenido (lo que la pantalla consulta cada pocos segundos). */
export function iJsonIfChanged<T>(req: Request, body: T) {
  return conditionalJson(req, body, NO_STORE);
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

/**
 * Lo interno del workspace activo de quien pide (lib/internal-contacts.ts): el Inbox es personal, pero quién es del
 * equipo lo marca el workspace. Sin sesión, nadie es interno.
 */
export async function inboxInternal(): Promise<{ ws: string | null; set: InternalSet; admin: boolean }> {
  const user = await getCurrentUser();
  if (!user || delegatedIdentity()) return { ws: null, set: EMPTY_INTERNAL_SET, admin: false };
  return { ws: user.id, set: await loadInternalSet(user.id, { inboxOwner: realUserId(user) }), admin: roleAtLeast(user.role, 'admin') };
}

/**
 * Como withOwner, más el workspace activo (lo interno es del workspace; lib/internal-contacts.ts) y si es admin.
 * Una sola lectura de la sesión. Sin sesión o con un token delegado, 401.
 */
export async function withOwnerWs(fn: (owner: string, ctx: { ws: string; admin: boolean }) => Promise<NextResponse>): Promise<NextResponse> {
  if (delegatedIdentity()) return iJson({ error: 'unauthorized' }, 401);
  const user = await getCurrentUser();
  if (!user) return iJson({ error: 'unauthorized' }, 401);
  try {
    return await fn(realUserId(user), { ws: user.id, admin: roleAtLeast(user.role, 'admin') });
  } catch (err) {
    return iFail(err);
  }
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

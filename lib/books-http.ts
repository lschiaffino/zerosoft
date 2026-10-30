/**
 * Books: sesión, permisos y errores de las rutas API. Server-only.
 *
 * Cada ruta pasa por `handle`: sesión con Books en el workspace activo
 * (acceso por app; guest nunca), actor con su rol de Books, y los errores
 * de dominio como JSON con su status. Los permisos de lectura por área los
 * pide cada ruta con `need`.
 */
import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from './session';
import { userCanUseApp } from './workspace';
import { assertCan, booksActor } from './books';
import { BooksError, type BooksActor } from './books-schema';
import type { BooksPermission } from './books-roles';
import { UploadError } from './uploads';

export function booksJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

export function booksFail(err: unknown): NextResponse {
  if (err instanceof BooksError) return booksJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof UploadError) return booksJson({ error: err.code }, err.status);
  if (err && typeof err === 'object' && 'code' in err && ['ai_disabled', 'quota_exceeded', 'rate_limited'].includes(String((err as { code: unknown }).code))) {
    const code = String((err as { code: unknown }).code);
    return booksJson({ error: code }, code === 'rate_limited' ? 429 : code === 'quota_exceeded' ? 402 : 503);
  }
  // Inmutabilidad: los triggers de la base cortan cualquier cambio a un asiento o documento emitido.
  if (err instanceof Error && /books_(journal|document)_immutable/.test(err.message)) return booksJson({ error: 'document_posted' }, 409);
  console.error('[books] route error', err instanceof Error ? err.message : err);
  return booksJson({ error: 'server_error' }, 500);
}

export async function booksSession(): Promise<{ actor: BooksActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'books')) return { res: booksJson({ error: 'unauthorized' }, 401) };
  const person = user.actingUser ?? user;
  return { actor: await booksActor({ ws: user.id, person: person.id, workspaceRole: user.role }), user };
}

export function need(actor: BooksActor, perm: BooksPermission): void {
  assertCan(actor, perm);
}

/** Envuelve un handler: sesión, rol y errores. Si devuelve una Response la pasa tal cual. */
export async function handle(fn: (s: { actor: BooksActor; user: SessionUser }) => Promise<unknown>, status = 200): Promise<NextResponse> {
  const s = await booksSession();
  if ('res' in s) return s.res;
  try {
    const out = await fn(s);
    if (out instanceof NextResponse) return out;
    if (out instanceof Response) return out as NextResponse;
    return booksJson(out, status);
  } catch (err) {
    return booksFail(err);
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function must<T>(v: T | null | undefined): T {
  if (v == null) throw new BooksError('not_found', 404);
  return v;
}

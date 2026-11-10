/**
 * Calls: sesión, errores y helpers de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, type SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { limitByIp } from '../rate-limit';
import { AiError } from '../ai';
import { callsActorOf } from './actor';
import { CallsError, type CallsActor } from './types';

export { callsActorOf };

const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

export function cJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...(headers ?? {}) } });
}

export function cFail(err: unknown) {
  if (err instanceof CallsError) return cJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof AiError) return cJson({ error: err.code }, err.code === 'ai_disabled' ? 503 : 429);
  if (err instanceof ZodError) return cJson({ error: 'invalid_input' }, 400);
  throw err;
}

/** Sesión con Calls en el workspace activo (guest nunca). */
export async function callsActor(): Promise<{ actor: CallsActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'calls') || user.role === 'guest') return { res: cJson({ error: 'unauthorized' }, 401) };
  return { actor: callsActorOf(user), user };
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new CallsError('invalid_input', 400);
  return parsed.data;
}

export function callsLimit(req: Request, bucket: string, limit: number, windowSec: number, suffix = '') {
  return limitByIp(req, `calls:${bucket}`, limit, windowSec, suffix);
}

export function binaryResponse(bytes: Buffer, mime: string, extra: Record<string, string> = {}, status = 200) {
  return new NextResponse(new Uint8Array(bytes), {
    status,
    headers: { 'content-type': mime, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", ...NO_STORE, ...extra },
  });
}

export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

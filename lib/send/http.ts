/**
 * Send: sesión, errores y helpers de las rutas API. Server-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, type SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { clientIp, limitByIp } from '../rate-limit';
import { resolveLink } from './viewer';
import type { LinkRow } from './core';
import { sendActorOf } from './actor';
import { SendError, sessionCookie, type SendActor } from './types';

export { sendActorOf };

const NO_STORE = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

export function sJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...(headers ?? {}) } });
}

export function sFail(err: unknown) {
  if (err instanceof SendError) return sJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof ZodError) return sJson({ error: 'invalid_input' }, 400);
  throw err;
}

/** Sesión con Send en el workspace activo (guest nunca). */
export async function sendActor(): Promise<{ actor: SendActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'send') || user.role === 'guest') return { res: sJson({ error: 'unauthorized' }, 401) };
  return { actor: sendActorOf(user), user };
}

export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new SendError('invalid_input', 400);
  return parsed.data;
}

export function sendLimit(req: Request, bucket: string, limit: number, windowSec: number, suffix = '') {
  return limitByIp(req, `send:${bucket}`, limit, windowSec, suffix);
}

export interface PublicCtx {
  params: Promise<{ token: string }>;
}

/** Link del token y la cookie de la sesión. Un token que no existe responde igual que uno borrado. */
export async function publicLink(req: NextRequest, token: string): Promise<{ link: LinkRow; cookie: string | undefined; ip: string } | { res: NextResponse }> {
  const link = await resolveLink(token);
  if (!link) return { res: sJson({ error: 'not_found' }, 404) };
  return { link, cookie: req.cookies.get(sessionCookie(link.id))?.value, ip: clientIp(req) };
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

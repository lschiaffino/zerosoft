/**
 * Sign: sesión, errores y límites de las rutas API. Server-only.
 */
import { NextResponse } from 'next/server';
import { ZodError, type z } from 'zod';
import { getCurrentUser, type SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { clientIp, limitByIp } from '../rate-limit';
import { SignError, type SignActor } from './types';

export function sJson<T>(body: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store', ...(headers ?? {}) } });
}

export function sFail(err: unknown) {
  if (err instanceof SignError) return sJson({ error: err.code, ...(err.detail ?? {}) }, err.status);
  if (err instanceof ZodError) return sJson({ error: 'invalid_input' }, 400);
  throw err;
}

export function signActorOf(user: SessionUser): SignActor {
  const person = user.actingUser ?? user;
  return { ws: user.id, person: person.id, admin: user.role === 'owner' || user.role === 'admin', email: (person.email ?? '').toLowerCase(), name: person.name ?? person.email ?? '' };
}

/** Sesión con Sign en el workspace activo (guest nunca). */
export async function signActor(): Promise<{ actor: SignActor; user: SessionUser } | { res: NextResponse }> {
  const user = await getCurrentUser();
  if (!user || !userCanUseApp(user, 'sign') || user.role === 'guest') return { res: sJson({ error: 'unauthorized' }, 401) };
  return { actor: signActorOf(user), user };
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
  if (!parsed.success) throw new SignError('invalid_input', 400);
  return parsed.data;
}

export function signLimit(req: Request, bucket: string, limit: number, windowSec: number, suffix = '') {
  return limitByIp(req, `sign:${bucket}`, limit, windowSec, suffix);
}

export function metaOf(req: Request): { ip: string; ua: string } {
  return { ip: clientIp(req), ua: (req.headers.get('user-agent') ?? '').slice(0, 300) };
}

/** Un PDF del FormData (`file`), acotado. */
export async function pdfFromForm(req: Request, max: number): Promise<{ bytes: Buffer; name: string; form: FormData }> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > max + 64 * 1024) throw new SignError('pdf_too_large', 413);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new SignError('invalid_input', 400);
  }
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) throw new SignError('invalid_input', 400);
  if (file.size > max) throw new SignError('pdf_too_large', 413);
  return { bytes: Buffer.from(await file.arrayBuffer()), name: ((file as File).name || 'document.pdf').slice(0, 200), form };
}

export function pdfResponse(bytes: Buffer, name: string, inline = true) {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/["\\\r\n]/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // El PDF se dibuja con pdf.js en la app; abierto directo, sin scripts ni nada embebido.
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

export type Ctx<P extends string = 'id'> = { params: Promise<Record<P, string>> };

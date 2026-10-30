/**
 * Sign: rutas públicas del destinatario (sin cuenta). El token del link
 * resuelve al destinatario; la cookie zs_sign_<id> es la sesión después del
 * código por email. Todo limitado por IP.
 */
import type { NextRequest } from 'next/server';
import { resolveToken, sessionCookieName, sessionValid, type Resolved } from './signing';
import { signLimit, sJson } from './http';

export type PublicCtx = { params: Promise<{ token: string }> };

export async function publicResolve(req: NextRequest, ctx: PublicCtx, bucket: string, limit: number): Promise<{ r: Resolved; sessionOk: boolean } | { res: Response }> {
  const limited = await signLimit(req, `public:${bucket}`, limit, 600);
  if (limited) return { res: limited };
  const r = await resolveToken((await ctx.params).token);
  if (!r) return { res: sJson({ error: 'not_found' }, 404) };
  const cookie = req.cookies.get(sessionCookieName(r.recipient.id))?.value;
  return { r, sessionOk: sessionValid(r.recipient, cookie) };
}

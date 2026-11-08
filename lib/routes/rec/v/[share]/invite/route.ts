import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicVideoRow } from '@/lib/rec';
import { recJson } from '@/lib/rec-http';
import { consumeMagicToken, inviteCookieName, inviteCookieValue, REC_INVITE_COOKIE_DAYS } from '@/lib/rec-share';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ token: z.string().min(20).max(64) });

/**
 * Abrir un link mágico: lo usa (una vez) y deja la cookie firmada de esa
 * persona para este link. Es un POST desde la página (con un clic): los
 * antivirus del correo que abren los links con GET no lo gastan.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const limited = await limitByIp(req, 'rec:invite', 30, 600);
  if (limited) return limited;
  const { share } = await ctx.params;
  const v = await getPublicVideoRow(share);
  if (!v) return recJson({ error: 'not_found' }, 404);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  const email = await consumeMagicToken(v, parsed.data.token);
  if (!email) return recJson({ error: 'invalid_link' }, 410);
  const res = recJson({ ok: true });
  res.cookies.set(inviteCookieName(v.share_id), inviteCookieValue(v.share_id, email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: REC_INVITE_COOKIE_DAYS * 86400,
  });
  return res;
}

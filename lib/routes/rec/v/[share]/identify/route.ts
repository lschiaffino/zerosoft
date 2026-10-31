import { NextRequest } from 'next/server';
import { z } from 'zod';
import { emailGateCookie, emailGateToken, getPublicVideoRow, publicAccess, unlockCookieName } from '@/lib/rec';
import { saveViewerEmail } from '@/lib/rec-admin';
import { publicViewerFor, recJson, resolveViewer, withViewerCookie } from '@/lib/rec-http';
import { cleanEmails } from '@/lib/rec-schema';
import { getCurrentUser } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().max(254), name: z.string().max(80).optional() });

/** Pedido de email para ver: guarda lo que escribió (sin verificarlo) y deja pasar. Lo anterior a este paso se sigue exigiendo. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const limited = await limitByIp(req, 'rec:identify', 30, 600);
  if (limited) return limited;
  const { share } = await ctx.params;
  const v = await getPublicVideoRow(share);
  if (!v) return recJson({ error: 'not_found' }, 404);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const email = parsed.success ? cleanEmails([parsed.data.email])[0] : undefined;
  if (!parsed.success || !email) return recJson({ error: 'invalid_email' }, 400);
  const user = await getCurrentUser();
  const viewer = await publicViewerFor(v, user, (n) => req.cookies.get(n)?.value);
  // Solo si este es el único paso que falta: no sirve para saltear contraseña ni privacidad.
  if (publicAccess(v, viewer, req.cookies.get(unlockCookieName(v.share_id))?.value ?? null) !== 'email') return recJson({ error: 'invalid_input' }, 400);
  const { viewer: me, newKey } = await resolveViewer(req, v, parsed.data.name);
  await saveViewerEmail(v.id, me.key, parsed.data.name ?? '', email);
  const res = recJson({ ok: true });
  res.cookies.set(emailGateCookie(v.share_id), emailGateToken(v), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 30 * 86400 });
  return withViewerCookie(res, newKey);
}

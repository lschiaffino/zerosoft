import { NextRequest } from 'next/server';
import { getPublicVideoRow, publicAccess, unlockCookieName } from '@/lib/rec';
import { requestAccess } from '@/lib/rec-admin';
import { publicViewerFor, recFail, recJson } from '@/lib/rec-http';
import { getCurrentUser } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pedir acceso a un video privado. Hace falta una cuenta: el email que ve el
 * autor es el de la sesión. Solo tiene sentido si hoy la respuesta es "prohibido".
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const limited = await limitByIp(req, 'rec:access', 30, 600);
  if (limited) return limited;
  const { share } = await ctx.params;
  const v = await getPublicVideoRow(share);
  if (!v) return recJson({ error: 'not_found' }, 404);
  const user = await getCurrentUser();
  if (!user) return recJson({ error: 'unauthorized' }, 401);
  const viewer = await publicViewerFor(v, user, (n) => req.cookies.get(n)?.value);
  if (publicAccess(v, viewer, req.cookies.get(unlockCookieName(v.share_id))?.value ?? null) !== 'forbidden') return recJson({ error: 'invalid_input' }, 400);
  const person = user.actingUser ?? user;
  try {
    return recJson({ status: await requestAccess(v, { email: person.email ?? '', name: person.name ?? '' }) });
  } catch (err) {
    return recFail(err);
  }
}

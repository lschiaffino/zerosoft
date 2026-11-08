import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getPublicVideoRow, publicAccess, unlockCookieName } from '@/lib/rec';
import { publicViewerFor, recFail, recJson } from '@/lib/rec-http';
import { recBaseUrl } from '@/lib/rec-page';
import { askForLink } from '@/lib/rec-share';
import { getCurrentUser } from '@/lib/session';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().max(254), name: z.string().max(80).optional(), locale: z.enum(['en', 'es', 'pt']).optional() });

/**
 * Sin acceso a un video restringido: con un email de la lista llega un link
 * mágico nuevo; con otro, queda un pedido de acceso para quien grabó. La
 * respuesta es la misma en los dos casos.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const limited = await limitByIp(req, 'rec:access', 30, 600);
  if (limited) return limited;
  const { share } = await ctx.params;
  const v = await getPublicVideoRow(share);
  if (!v) return recJson({ error: 'not_found' }, 404);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_email' }, 400);
  const viewer = await publicViewerFor(v, await getCurrentUser(), (n) => req.cookies.get(n)?.value);
  const state = publicAccess(v, viewer, req.cookies.get(unlockCookieName(v.share_id))?.value ?? null);
  // Solo frente al portón de acceso: no sirve para nada más (ni para saltear contraseña o vencimiento).
  if (state !== 'signin' && state !== 'forbidden') return recJson({ error: 'invalid_input' }, 400);
  try {
    await askForLink(v, parsed.data.email, parsed.data.name ?? '', { base: recBaseUrl(), locale: parsed.data.locale ?? 'en' });
    return recJson({ ok: true });
  } catch (err) {
    return recFail(err);
  }
}

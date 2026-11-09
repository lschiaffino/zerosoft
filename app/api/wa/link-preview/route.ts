import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { linkPreview } from '@/lib/wa-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'cache-control': 'private, max-age=3600' };

/**
 * Vista previa de un link de un chat de WhatsApp (Inbox y Lines): título,
 * descripción, sitio e imagen chica. Se lee del lado del servidor (sin redes
 * internas) y queda en caché una semana. Solo con sesión.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const r = await rateLimit(`wa:link-preview:${realUserId(user)}`, 120, 60).catch(() => ({ ok: true }));
    if (!r.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const url = new URL(req.url).searchParams.get('url') ?? '';
  const preview = await linkPreview(url).catch(() => null);
  if (!preview) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  return NextResponse.json({ preview }, { headers: HEADERS });
}

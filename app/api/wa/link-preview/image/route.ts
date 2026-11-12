import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { rateLimit } from '@/lib/rate-limit';
import { linkPreviewImage } from '@/lib/wa-extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Imagen de la vista previa de un link de un chat de WhatsApp (Inbox y
 * Lines), servida desde nuestro dominio y solo de la caché (la bajó el servidor al leer la
 * página): el navegador no le pide nada al sitio del link. Solo con sesión;
 * solo tipos de imagen sin scripts (jpeg, png, webp, gif) y con nosniff.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const r = await rateLimit(`wa:link-preview-image:${realUserId(user)}`, 600, 60).catch(() => ({ ok: true }));
    if (!r.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const params = new URL(req.url).searchParams;
  const img = await linkPreviewImage(params.get('url') ?? '', params.get('n') === '1' ? 1 : 0).catch(() => null);
  if (!img) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(new Uint8Array(img.bytes), {
    headers: {
      'content-type': img.type,
      'content-length': String(img.bytes.length),
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

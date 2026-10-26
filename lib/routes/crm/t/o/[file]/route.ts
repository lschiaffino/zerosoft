import { NextRequest, NextResponse } from 'next/server';
import { recordTrackingHit } from '@/lib/crm-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GIF transparente 1×1.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Pixel de apertura: /api/crm/t/o/<token>.gif. Siempre devuelve el GIF (sin
 * revelar si el token existe); bots, precargas y repeticiones no cuentan.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ file: string }> }) {
  const { file } = await props.params;
  const token = file.replace(/\.gif$/i, '');
  await recordTrackingHit(token, 'open', { userAgent: req.headers.get('user-agent') ?? '' }).catch(() => null);
  return new NextResponse(new Uint8Array(PIXEL), {
    headers: {
      'content-type': 'image/gif',
      'content-length': String(PIXEL.length),
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'x-robots-tag': 'noindex',
    },
  });
}

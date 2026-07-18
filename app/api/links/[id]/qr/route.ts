import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getCurrentUser } from '@/lib/session';
import { getUserLink } from '@/lib/links';
import { shortUrl } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const link = getUserLink(user.id, params.id);
  if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const target = shortUrl(link.slug);
  const format = req.nextUrl.searchParams.get('format');

  if (format === 'png') {
    const buf = await QRCode.toBuffer(target, { type: 'png', width: 512, margin: 2 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': 'image/png',
        'content-disposition': `attachment; filename="${link.slug}.png"`,
      },
    });
  }

  const svg = await QRCode.toString(target, { type: 'svg', margin: 2 });
  return new NextResponse(svg, { headers: { 'content-type': 'image/svg+xml' } });
}

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getCurrentUser } from '@/lib/session';
import { getLinkForViewer } from '@/lib/links';
import { viewerOf } from '@/lib/link-folders';
import { getQrStyle, qrStyleSchema, qrTarget, renderQrSvg, saveQrStyle } from '@/lib/link-qr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const found = await getLinkForViewer(user.id, params.id, viewerOf(user), 'view');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;

  const target = qrTarget(link);
  const style = await getQrStyle(user.id, link.id);
  const format = req.nextUrl.searchParams.get('format');

  if (format === 'json') return NextResponse.json({ style, target });

  if (format === 'png') {
    // Con sharp (lo trae Next para optimizar imágenes) el PNG es el mismo SVG: marco, forma y logo.
    // Si no está, PNG plano con los colores.
    try {
      const sharp = (await import('sharp')).default;
      const png = await sharp(Buffer.from(renderQrSvg(target, style)), { density: 300 }).resize({ width: 1024 }).png().toBuffer();
      return new NextResponse(new Uint8Array(png), {
        headers: { 'content-type': 'image/png', 'content-disposition': `attachment; filename="${link.slug}.png"` },
      });
    } catch {
      /* sin sharp: abajo */
    }
    const buf = await QRCode.toBuffer(target, {
      type: 'png',
      width: 1024,
      margin: 2,
      errorCorrectionLevel: style.logo ? 'H' : 'M',
      color: { dark: style.fg, light: style.bg },
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': 'image/png',
        'content-disposition': `attachment; filename="${link.slug}.png"`,
      },
    });
  }

  return new NextResponse(renderQrSvg(target, style), {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' },
  });
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const found = await getLinkForViewer(user.id, params.id, viewerOf(user), 'edit');
  if ('status' in found) {
    return NextResponse.json({ error: found.status === 403 ? 'forbidden' : 'not_found' }, { status: found.status });
  }
  const { link } = found;

  const parsed = qrStyleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await saveQrStyle(user.id, link.id, parsed.data);
  return NextResponse.json({ style: parsed.data });
}

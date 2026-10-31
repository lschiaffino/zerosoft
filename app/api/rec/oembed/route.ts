import { NextRequest, NextResponse } from 'next/server';
import { publicPreview, recBaseUrl } from '@/lib/rec-page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * oEmbed de un video abierto a cualquiera (lo leen Slack y otros al pegar el
 * link). Protegidos, privados o vencidos: 404, sin decir nada del video.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? '';
  const m = /\/(en|es|pt)\/v\/([\w-]{8,40})(?:[/?#]|$)/.exec(raw);
  if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const og = await publicPreview(m[1], m[2]);
  if (!og) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const embed = `${recBaseUrl()}/${m[1]}/v/${m[2]}/embed`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return NextResponse.json({
    version: '1.0',
    type: 'video',
    provider_name: 'zerosoft Rec',
    title: og.title,
    width: 640,
    height: 400,
    html: `<iframe src="${esc(embed)}" width="640" height="400" frameborder="0" allow="fullscreen" allowfullscreen title="${esc(og.title)}"></iframe>`,
    ...(og.image ? { thumbnail_url: og.image } : {}),
  });
}

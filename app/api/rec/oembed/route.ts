import { NextRequest, NextResponse } from 'next/server';
import { publicPreview, recBaseUrl } from '@/lib/rec-page';
import { parseStartParam, recEmbedCode, recEmbedSrc } from '@/lib/rec-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * oEmbed de un video abierto a cualquiera (lo leen Slack y otros al pegar el
 * link). Protegidos, privados o vencidos: 404, sin decir nada del video.
 * Un link con ?t=90 inserta el reproductor arrancando en ese segundo.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? '';
  const m = /\/(en|es|pt)\/v\/([\w-]{8,40})(?:[/?#]|$)/.exec(raw);
  if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const og = await publicPreview(m[1], m[2]);
  if (!og) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let start: number | null = null;
  try {
    start = parseStartParam(new URL(raw).searchParams.get('t'));
  } catch {
    // Sin URL completa no hay ?t=.
  }
  const embed = recEmbedSrc(`${recBaseUrl()}/${m[1]}/v/${m[2]}`, { start });
  return NextResponse.json({
    version: '1.0',
    type: 'video',
    provider_name: 'zerosoft Rec',
    title: og.title,
    width: 640,
    height: 400,
    html: recEmbedCode(embed, og.title),
    ...(og.image ? { thumbnail_url: og.image } : {}),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { segmentsToVtt, type RecSegment } from './rec-schema';
import type { RecVideoRow } from './rec';
import type { serveRecFile as ServeFn } from './rec-upload';

/**
 * Archivo pedido de un video ya autorizado: ?kind=video|thumb|gif|captions
 * y ?download=1 (solo si el video deja descargar). Lo usan la ruta de la app
 * y la pública.
 */
export async function serveRecKind(
  req: NextRequest,
  v: RecVideoRow,
  opts: { serveRecFile: typeof ServeFn; allowDownload: boolean },
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind') ?? 'video';
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (kind === 'captions') {
    let segments: RecSegment[] = [];
    try {
      segments = JSON.parse(v.transcript) as RecSegment[];
    } catch {
      segments = [];
    }
    return new NextResponse(segmentsToVtt(segments), {
      headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' },
    });
  }
  if (kind === 'thumb' || kind === 'gif') {
    const url = kind === 'thumb' ? v.thumb_url : v.gif_url;
    if (!url) return notFound();
    const type = kind === 'gif' ? 'image/gif' : url.endsWith('.png') ? 'image/png' : url.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return opts.serveRecFile(req, url, type);
  }
  if (!v.url) return notFound();
  const wantDownload = sp.get('download') === '1';
  if (wantDownload && !opts.allowDownload) return NextResponse.json({ error: 'download_disabled' }, { status: 403 });
  const ext = v.content_type.includes('mp4') ? 'mp4' : v.content_type.includes('quicktime') ? 'mov' : 'webm';
  const filename = `${(v.title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'video'}.${ext}`;
  return opts.serveRecFile(req, v.url, v.content_type, { download: wantDownload ? filename : null });
}

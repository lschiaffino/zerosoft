import { NextRequest, NextResponse } from 'next/server';
import { segmentsInTrim, segmentsToVtt, type RecSegment } from './rec-schema';
import { assetVisible, videoFileFor, type RecVideoRow } from './rec';
import type { serveRecFile as ServeFn } from './rec-upload';

/**
 * Archivo pedido de un video ya autorizado: ?kind=video|thumb|gif|captions
 * y ?download=1 (solo si el video deja descargar). Lo usan la ruta de la app
 * y la pública. `privileged` (quien administra el video, o el autor en la
 * página pública) recibe el original y la transcripción entera; los demás,
 * la copia recortada y los subtítulos de lo que queda dentro del recorte.
 */
export async function serveRecKind(
  req: NextRequest,
  v: RecVideoRow,
  opts: { serveRecFile: typeof ServeFn; allowDownload: boolean; privileged: boolean },
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind') ?? 'video';
  if (!['video', 'thumb', 'gif', 'captions'].includes(kind)) return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (kind === 'captions') {
    let segments: RecSegment[] = [];
    try {
      segments = JSON.parse(v.transcript) as RecSegment[];
    } catch {
      segments = [];
    }
    if (!opts.privileged) segments = segmentsInTrim(segments, v.trim_start, v.trim_end);
    return new NextResponse(segmentsToVtt(segments), {
      headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' },
    });
  }
  if (kind === 'thumb' || kind === 'gif') {
    const url = kind === 'thumb' ? v.thumb_url : v.gif_url;
    if (!url) return notFound();
    // Con recorte, lo que se armó antes de recortar puede mostrar la parte cortada: no sale hasta regenerarlo.
    if (!opts.privileged && !assetVisible(v, kind)) return notFound();
    const type = kind === 'gif' ? 'image/gif' : url.endsWith('.png') ? 'image/png' : url.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return opts.serveRecFile(req, url, type);
  }
  const url = videoFileFor(v, opts.privileged);
  if (!url) return NextResponse.json({ error: 'processing' }, { status: 409 });
  const wantDownload = sp.get('download') === '1';
  if (wantDownload && !opts.allowDownload) return NextResponse.json({ error: 'download_disabled' }, { status: 403 });
  const ext = v.content_type.includes('mp4') ? 'mp4' : v.content_type.includes('quicktime') ? 'mov' : 'webm';
  const filename = `${(v.title || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'video'}.${ext}`;
  return opts.serveRecFile(req, url, v.content_type, { download: wantDownload ? filename : null, size: url === v.url ? v.size : undefined });
}

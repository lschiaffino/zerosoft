import { NextResponse } from 'next/server';
import { groupsSession, handleGroupsError, readJson, sessionViewer } from '@/lib/groups-http';
import { saveUpload } from '@/lib/uploads';
import { GifError } from '@/lib/wa-gifs';
import { chosenGif, gifsResponse } from '@/lib/wa-gifs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Lines: GIFs para mandar (lib/wa-gifs.ts).
 * GET ?q=&pos=&locale=: tendencias (sin q) o búsqueda: { provider, items, next }
 * (provider null: no hay clave de GIPHY ni de Tenor).
 * POST { url, width?, height? } (un MP4 del buscador): lo baja, lo guarda como
 * cualquier archivo del chat y devuelve la media para mandarlo por la ruta de
 * mensajes, como video con gifPlayback.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  try {
    const viewer = await sessionViewer(s);
    return await gifsResponse(req, `lines:${viewer.me}`);
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  try {
    const viewer = await sessionViewer(s);
    const gif = await chosenGif(req, `lines:${viewer.me}`, await readJson(req));
    const url = await saveUpload('chat', 'gif.mp4', 'video/mp4', gif.data);
    return NextResponse.json({
      media: { url, mimetype: 'video/mp4', filename: 'gif.mp4', size: gif.data.length, kind: 'video', gif: true, ...(gif.width && gif.height ? { width: gif.width, height: gif.height } : {}) },
    });
  } catch (err) {
    if (err instanceof GifError) return NextResponse.json({ error: err.code }, { status: err.status });
    return handleGroupsError(err);
  }
}

import { NextRequest } from 'next/server';
import { parseRange } from '@/lib/upload-serve';
import { getCallRow, mediaMime, readVideoRange } from '@/lib/calls/core';
import { binaryResponse, callsActor, callsLimit, cFail, cJson, contentDisposition } from '@/lib/calls/http';
import { PART_BYTES } from '@/lib/calls/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: la grabación por rangos (de a 4 MB) para el reproductor; ?download=1 la baja entera si entra. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'media', 1200, 60, a.actor.person);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    const row = await getCallRow(a.actor, id);
    const size = Number(row.video_bytes);
    if (!size || !Number(row.video_parts)) return cJson({ error: 'no_recording' }, 404);
    const head = await readVideoRange(row.id, 0, 15);
    const mime = mediaMime(row, head);
    const range = parseRange(req.headers.get('range'), size) ?? [0, size - 1];
    const end = Math.min(range[1], range[0] + PART_BYTES - 1);
    const bytes = await readVideoRange(row.id, range[0], end);
    if (!bytes.length) return cJson({ error: 'file_unavailable' }, 404);
    const name = `${(row.title || 'call').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.${mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : mime.includes('wav') ? 'wav' : 'bin'}`;
    return binaryResponse(bytes, mime, { 'accept-ranges': 'bytes', 'content-range': `bytes ${range[0]}-${end}/${size}`, 'content-disposition': contentDisposition('inline', name) }, 206);
  } catch (err) {
    return cFail(err);
  }
}

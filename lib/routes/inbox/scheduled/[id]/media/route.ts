import { NextResponse } from 'next/server';
import { getScheduledOwned } from '@/lib/inbox/core';
import { withOwner } from '@/lib/inbox/http';
import { readInboxMedia } from '@/lib/inbox/schedule';
import { InboxError } from '@/lib/inbox/types';
import { parseRange } from '@/lib/upload-serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const AUDIO = /^audio\/(ogg|mpeg|mp4|aac|webm|wav)$/;

/**
 * El audio de una nota de voz programada, para escucharla antes de que salga.
 * Solo de quien la programó y solo mientras no salió ni se canceló (después
 * el archivo ya no está). Acepta Range: el reproductor pide de a partes.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return withOwner(async (owner) => {
    const row = await getScheduledOwned(owner, id);
    if (row.media_kind !== 'voice' || !row.media_url || row.status === 'sent' || row.status === 'cancelled') throw new InboxError('not_found', 404);
    const data = new Uint8Array(await readInboxMedia(row.media_url));
    const mime = (row.media_type || '').split(';')[0].trim().toLowerCase();
    const headers: Record<string, string> = {
      'content-type': AUDIO.test(mime) ? mime : 'application/octet-stream',
      'content-disposition': 'inline; filename="voice-note"',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
    };
    const range = parseRange(req.headers.get('range'), data.length);
    if (range) {
      const [start, end] = range;
      return new NextResponse(data.slice(start, end + 1), {
        status: 206,
        headers: { ...headers, 'content-range': `bytes ${start}-${end}/${data.length}`, 'content-length': String(end - start + 1) },
      });
    }
    return new NextResponse(data, { headers: { ...headers, 'content-length': String(data.length) } });
  });
}

import { NextRequest } from 'next/server';
import { parseRange } from '@/lib/upload-serve';
import { getSharedCall, mediaMime, readVideoRange } from '@/lib/calls/core';
import { binaryResponse, callsLimit, cJson } from '@/lib/calls/http';
import { PART_BYTES } from '@/lib/calls/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: la grabación del link compartido, por rangos de 4 MB. El link se mira en cada pedido. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const limited = await callsLimit(req, 'public-media', 600, 60);
  if (limited) return limited;
  const { token } = await ctx.params;
  const shared = await getSharedCall(token);
  if (!shared) return cJson({ error: 'not_found' }, 404);
  const row = shared.row;
  const size = Number(row.video_bytes);
  if (!size) return cJson({ error: 'no_recording' }, 404);
  const head = await readVideoRange(row.id, 0, 15);
  const range = parseRange(req.headers.get('range'), size) ?? [0, size - 1];
  const end = Math.min(range[1], range[0] + PART_BYTES - 1);
  const bytes = await readVideoRange(row.id, range[0], end);
  if (!bytes.length) return cJson({ error: 'file_unavailable' }, 404);
  return binaryResponse(bytes, mediaMime(row, head), { 'accept-ranges': 'bytes', 'content-range': `bytes ${range[0]}-${end}/${size}` }, 206);
}

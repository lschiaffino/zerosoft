import { NextRequest } from 'next/server';
import { parseRange } from '@/lib/upload-serve';
import { readRange, versionForActor } from '@/lib/send/core';
import { binaryResponse, contentDisposition, sendActor, sFail, sJson } from '@/lib/send/http';
import { PART_BYTES, videoMime } from '@/lib/send/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: el archivo tal cual se subió, para quien lo administra (video de la vista previa). Hasta 4 MB por pedido. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const { version: v } = await versionForActor(a.actor, id);
    const size = Number(v.size);
    const range = parseRange(req.headers.get('range'), size) ?? [0, size - 1];
    const end = Math.min(range[1], range[0] + PART_BYTES - 1);
    const bytes = await readRange(v.id, range[0], end);
    const mime = v.kind === 'video' ? videoMime(await readRange(v.id, 0, 15)) : 'application/octet-stream';
    if (!bytes.length) return sJson({ error: 'file_unavailable' }, 404);
    return binaryResponse(bytes, mime, { 'accept-ranges': 'bytes', 'content-range': `bytes ${range[0]}-${end}/${size}`, 'content-disposition': contentDisposition('inline', v.name) }, 206);
  } catch (err) {
    return sFail(err);
  }
}

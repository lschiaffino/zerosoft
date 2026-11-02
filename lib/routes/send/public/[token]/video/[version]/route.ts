import { NextRequest } from 'next/server';
import { parseRange } from '@/lib/upload-serve';
import { readRange } from '@/lib/send/core';
import { linkDocuments, markPageView, requireViewer } from '@/lib/send/viewer';
import { binaryResponse, publicLink, sendLimit, sFail, sJson } from '@/lib/send/http';
import { PART_BYTES, videoMime } from '@/lib/send/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: el video por rangos, de a 4 MB, con el link y la sesión mirados en cada pedido. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string; version: string }> }) {
  const { token, version } = await ctx.params;
  const p = await publicLink(req, token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'video', 600, 60);
  if (limited) return limited;
  try {
    const session = await requireViewer(p.link, p.cookie);
    const docs = await linkDocuments(p.link, session.email);
    const target = docs.find((d) => d.version.id === version);
    if (!target || target.version.kind !== 'video') return sJson({ error: 'not_found' }, 404);
    await markPageView(session, version, 0);
    const size = Number(target.version.size);
    const range = parseRange(req.headers.get('range'), size) ?? [0, size - 1];
    const end = Math.min(range[1], range[0] + PART_BYTES - 1);
    const bytes = await readRange(version, range[0], end);
    if (!bytes.length) return sJson({ error: 'file_unavailable' }, 404);
    const head = await readRange(version, 0, 15);
    return binaryResponse(bytes, videoMime(head), { 'accept-ranges': 'bytes', 'content-range': `bytes ${range[0]}-${end}/${size}` }, 206);
  } catch (err) {
    return sFail(err);
  }
}

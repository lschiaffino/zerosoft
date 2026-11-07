import { NextRequest } from 'next/server';
import { pageRef, versionForActor } from '@/lib/send/core';
import { readSendFile } from '@/lib/send/files';
import { binaryResponse, sendActor, sFail, sJson } from '@/lib/send/http';
import { resizeImage } from '@/lib/send/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?w=: imagen de una página para el panel (vista previa, miniaturas), con los permisos del documento. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; page: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id, page } = await ctx.params;
    const { version } = await versionForActor(a.actor, id);
    const ref = await pageRef(version.id, Number(page));
    if (!ref) return sJson({ error: 'not_found' }, 404);
    const bytes = await readSendFile(ref.ref);
    if (!bytes) return sJson({ error: 'file_unavailable' }, 404);
    const w = Number(req.nextUrl.searchParams.get('w'));
    const out = Number.isInteger(w) && w >= 80 && w < 1600 ? await resizeImage(bytes, w) : bytes;
    return binaryResponse(out, 'image/webp', { 'cache-control': 'private, max-age=300' });
  } catch (err) {
    return sFail(err);
  }
}

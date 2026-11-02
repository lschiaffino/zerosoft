import { NextRequest } from 'next/server';
import { pageRef } from '@/lib/send/core';
import { readSendFile } from '@/lib/send/files';
import { linkDocuments, markPageView, requireViewer, watermarkText } from '@/lib/send/viewer';
import { binaryResponse, publicLink, sendLimit, sFail, sJson } from '@/lib/send/http';
import { watermarkImage } from '@/lib/send/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: la imagen de una página, con el link y la sesión mirados en este pedido y sin
 * caché. Con watermark, el email sale dibujado en la imagen.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string; version: string; page: string }> }) {
  const { token, version, page } = await ctx.params;
  const p = await publicLink(req, token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'page', 1200, 60);
  if (limited) return limited;
  try {
    const session = await requireViewer(p.link, p.cookie);
    const docs = await linkDocuments(p.link, session.email);
    if (!docs.some((d) => d.version.id === version)) return sJson({ error: 'version_changed' }, 409);
    const ref = await pageRef(version, Number(page));
    if (!ref) return sJson({ error: 'not_found' }, 404);
    const bytes = await readSendFile(ref.ref);
    if (!bytes) return sJson({ error: 'file_unavailable' }, 404);
    await markPageView(session, version, Number(page));
    const out = p.link.watermark ? await watermarkImage(bytes, watermarkText(session)) : bytes;
    return binaryResponse(out, 'image/webp');
  } catch (err) {
    return sFail(err);
  }
}

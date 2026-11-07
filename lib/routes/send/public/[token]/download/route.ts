import { NextRequest } from 'next/server';
import { downloadPiece, requireViewer } from '@/lib/send/viewer';
import { binaryResponse, contentDisposition, publicLink, sendLimit, sFail, sJson, type PublicCtx } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?document=&piece=: un pedazo de la descarga, si el link la permite. El navegador los junta. */
export async function GET(req: NextRequest, ctx: PublicCtx) {
  const p = await publicLink(req, (await ctx.params).token);
  if ('res' in p) return p.res;
  const limited = await sendLimit(req, 'download', 120, 60);
  if (limited) return limited;
  try {
    const session = await requireViewer(p.link, p.cookie);
    const sp = req.nextUrl.searchParams;
    const d = await downloadPiece(p.link, session, sp.get('document') ?? '', Number(sp.get('piece') ?? 0));
    return binaryResponse(d.bytes, 'application/octet-stream', { 'content-disposition': contentDisposition('attachment', d.name), 'x-send-pieces': String(d.pieces), 'x-send-mime': d.mime, 'x-send-name': encodeURIComponent(d.name) });
  } catch (err) {
    return sFail(err);
  }
}

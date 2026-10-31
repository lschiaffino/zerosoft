import { NextRequest, NextResponse } from 'next/server';
import { publicVideoFor } from '@/lib/rec-http';
import { serveRecFile } from '@/lib/rec-upload';
import { serveRecKind } from '@/lib/rec-serve';
import { brandLogoUrl } from '@/lib/rec-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Archivos de un video compartido (/v/<id>): mismo control que la página
 * (vencimiento, contraseña, workspace). La descarga solo si el autor la dejó
 * (los miembros del workspace siempre pueden).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ share: string }> }) {
  const { share } = await ctx.params;
  const r = await publicVideoFor(req, share);
  if ('res' in r) return r.res;
  // Logo de la marca: se sirve con el mismo control que el video.
  if (req.nextUrl.searchParams.get('kind') === 'logo') {
    const url = await brandLogoUrl(r.v.workspace_id);
    if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return serveRecFile(req, url, url.endsWith('.png') ? 'image/png' : url.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
  }
  return serveRecKind(req, r.v, { serveRecFile, allowDownload: r.isAuthor || !!r.v.allow_download, privileged: r.isAuthor });
}

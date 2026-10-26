import { NextRequest } from 'next/server';
import { publicVideoFor } from '@/lib/rec-http';
import { serveRecFile } from '@/lib/rec-upload';
import { serveRecKind } from '@/lib/rec-serve';

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
  return serveRecKind(req, r.v, { serveRecFile, allowDownload: r.isAuthor || !!r.v.allow_download, privileged: r.isAuthor });
}

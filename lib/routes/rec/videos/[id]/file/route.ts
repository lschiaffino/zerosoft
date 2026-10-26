import { NextRequest } from 'next/server';
import { canManage, getVideoRow } from '@/lib/rec';
import { recActor, recJson } from '@/lib/rec-http';
import { serveRecFile } from '@/lib/rec-upload';
import { serveRecKind } from '@/lib/rec-serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Archivos del video para la app (sesión y acceso): ?kind=video|thumb|gif|captions, ?download=1. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const v = await getVideoRow(s.actor, id);
  if (!v) return recJson({ error: 'not_found' }, 404);
  const manager = canManage(s.actor, v);
  // Quien administra baja siempre; el resto del workspace, si el video lo deja.
  return serveRecKind(req, v, { serveRecFile, allowDownload: manager || !!v.allow_download, privileged: manager });
}

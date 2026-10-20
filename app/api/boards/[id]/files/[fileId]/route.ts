import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canReadBoardFiles, getBoardFile, readBoardFile } from '@/lib/board-files';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sirve una imagen de la pizarra con los permisos de la pizarra: alguien del
 * workspace, o el link público vigente (?t=<token>). Sin acceso: 404 (no se
 * confirma que exista). La URL del storage nunca sale de acá.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  const user = await getCurrentUser();
  const token = req.nextUrl.searchParams.get('t');
  if (!(await canReadBoardFiles(id, user?.id ?? null, token))) return jsonError(404, 'not_found');
  const row = await getBoardFile(id, fileId);
  if (!row) return jsonError(404, 'not_found');
  const body = await readBoardFile(row);
  if (!body) return jsonError(404, 'not_found');
  return new NextResponse(body as BodyInit, {
    headers: {
      'Content-Type': row.mime,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // El permiso se chequea en cada request: nada de caches compartidos.
      'Cache-Control': 'private, max-age=300',
    },
  });
}

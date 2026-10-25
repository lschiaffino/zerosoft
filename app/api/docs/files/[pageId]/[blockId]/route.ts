import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow, parseBlocks } from '@/lib/docs';
import { findFileBlock, pageImageBlock } from '@/lib/docs-files';
import { fileBlockResponse } from '@/lib/upload-serve';
import { notFound } from '@/lib/docs-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sirve el archivo de un bloque image/file con los permisos de la página:
 * quien la puede abrir (dueño, share propio o heredado, link público) o
 * cualquiera si está publicada en el centro de ayuda. Sin acceso: 404 (no se
 * confirma que exista). La URL del storage nunca sale de acá.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ pageId: string; blockId: string }> }) {
  const { pageId, blockId } = await props.params;
  const row = await getDocPageRow(pageId);
  if (!row) return notFound();
  const user = await getCurrentUser();
  const access = user ? await getDocAccess(row, user) : null;
  const published = row.published === 1 && row.archived === 0;
  if (!access && !published) return notFound();

  // "icon" y "cover": el ícono o la portada subidos de la página.
  const block =
    blockId === 'icon' || blockId === 'cover'
      ? pageImageBlock(blockId === 'icon' ? row.icon : row.cover_url, blockId)
      : findFileBlock(parseBlocks(row.content), blockId);
  if (!block) return notFound();
  return (
    (await fileBlockResponse(block, {
      download: req.nextUrl.searchParams.get('download') === '1',
      range: req.headers.get('range'),
    })) ?? notFound()
  );
}

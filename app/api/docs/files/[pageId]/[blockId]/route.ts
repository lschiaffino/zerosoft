import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow, parseBlocks } from '@/lib/docs';
import { contentDisposition, findFileBlock, isInlineImageMime } from '@/lib/docs-files';
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

  const block = findFileBlock(parseBlocks(row.content), blockId);
  if (!block) return notFound();

  let body: Uint8Array;
  if (block.url.startsWith('/uploads/')) {
    const root = path.join(process.cwd(), 'public', 'uploads');
    const file = path.join(process.cwd(), 'public', block.url);
    if (!file.startsWith(root + path.sep)) return notFound();
    try {
      body = new Uint8Array(await readFile(file));
    } catch {
      return notFound();
    }
  } else {
    // findFileBlock solo deja pasar URLs del Blob de Docs (nada de SSRF).
    const res = await fetch(block.url).catch(() => null);
    if (!res?.ok) return notFound();
    body = new Uint8Array(await res.arrayBuffer());
  }

  const mime = block.mime || 'application/octet-stream';
  // En línea solo las imágenes que se muestran; todo lo demás se descarga.
  const inline = isInlineImageMime(mime) && req.nextUrl.searchParams.get('download') !== '1';
  return new NextResponse(body as BodyInit, {
    headers: {
      'Content-Type': inline ? mime : 'application/octet-stream',
      'Content-Disposition': contentDisposition(block.name || 'file', inline),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // El permiso se chequea en cada request: nada de caches compartidos.
      'Cache-Control': 'private, max-age=300',
    },
  });
}

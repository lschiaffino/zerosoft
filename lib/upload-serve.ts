import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import type { DocsBlock } from './docs-types';
import { contentDisposition, isInlineImageMime } from './docs-files';

/**
 * Sirve el archivo de un bloque image/file (Docs y Notes) una vez que la ruta
 * chequeó el acceso. El bloque viene de findFileBlock, que solo deja pasar
 * URLs del storage propio (disco local o el Blob de Docs): nada de SSRF.
 * null = el archivo no está (la ruta responde 404).
 */
export async function fileBlockResponse(
  block: DocsBlock & { url: string },
  opts: { download?: boolean } = {},
): Promise<NextResponse | null> {
  let body: Uint8Array;
  if (block.url.startsWith('/uploads/')) {
    const root = path.join(process.cwd(), 'public', 'uploads');
    const file = path.join(process.cwd(), 'public', block.url);
    if (!file.startsWith(root + path.sep)) return null;
    try {
      body = new Uint8Array(await readFile(file));
    } catch {
      return null;
    }
  } else {
    const res = await fetch(block.url).catch(() => null);
    if (!res?.ok) return null;
    body = new Uint8Array(await res.arrayBuffer());
  }

  const mime = block.mime || 'application/octet-stream';
  // En línea solo las imágenes que se muestran; todo lo demás se descarga.
  const inline = isInlineImageMime(mime) && !opts.download;
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

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

/** Carpetas de public/uploads que se sirven sin chequeo (sus URLs ya son públicas). */
const PUBLIC_UPLOAD_FOLDERS = new Set(['chat', 'track', 'tasks', 'robots']);
const LOCAL_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;
const INLINE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
};

/**
 * Archivo de public/uploads/<carpeta>/<nombre> guardado por saveUpload sin
 * Blob. Imágenes, audio y video se muestran; el resto se descarga.
 */
export async function localUploadResponse(segments: string[]): Promise<NextResponse> {
  const notFound = () => new NextResponse('Not found', { status: 404 });
  if (segments.length !== 2) return notFound();
  const [folder, name] = segments;
  if (!PUBLIC_UPLOAD_FOLDERS.has(folder) || !LOCAL_NAME.test(name)) return notFound();
  const root = path.join(process.cwd(), 'public', 'uploads');
  const file = path.join(root, folder, name);
  if (!file.startsWith(root + path.sep)) return notFound();
  let body: Uint8Array;
  try {
    body = new Uint8Array(await readFile(file));
  } catch {
    return notFound();
  }
  const mime = INLINE_BY_EXT[name.toLowerCase().split('.').pop() ?? ''];
  // El nombre guardado es "<uuid>-<original>": se descarga con el original.
  const original = name.replace(/^[0-9a-f-]{36}-/, '');
  return new NextResponse(body as BodyInit, {
    headers: {
      'Content-Type': mime ?? 'application/octet-stream',
      'Content-Disposition': contentDisposition(original || 'file', Boolean(mime)),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // El nombre lleva un uuid: el archivo no cambia nunca.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

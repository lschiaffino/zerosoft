import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import type { DocsBlock } from './docs-types';
import { contentDisposition, isInlineImageMime, isInlineMediaMime, isPdfMime } from './docs-files';

/** "bytes=0-1023" → [inicio, fin] dentro de `size`; null si no hay rango válido. */
export function parseRange(header: string | null, size: number): [number, number] | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || size <= 0) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    if (m[2] === '') return null;
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return [start, end];
}

/**
 * Sirve el archivo de un bloque (imagen, video, audio, PDF o archivo) de Docs
 * y Notes una vez que la ruta chequeó el acceso. El bloque viene de
 * findFileBlock, que solo deja pasar URLs del storage propio (disco local o
 * el Blob de Docs): nada de SSRF. Video y audio aceptan Range (el reproductor
 * pide de a partes) y lo de Blob se pasa en stream sin cargarlo entero.
 * null = el archivo no está (la ruta responde 404).
 */
export async function fileBlockResponse(
  block: DocsBlock & { url: string },
  opts: { download?: boolean; range?: string | null } = {},
): Promise<NextResponse | null> {
  const mime = block.mime || 'application/octet-stream';
  const pdf = isPdfMime(mime);
  // En línea: imágenes, video, audio y PDF que se muestran; todo lo demás se descarga.
  const inline = !opts.download && (isInlineImageMime(mime) || isInlineMediaMime(mime) || pdf);
  const headers: Record<string, string> = {
    'Content-Type': inline ? mime : 'application/octet-stream',
    'Content-Disposition': contentDisposition(block.name || 'file', inline),
    'X-Content-Type-Options': 'nosniff',
    // El visor de PDF del navegador no abre con sandbox; el resto va aislado.
    ...(pdf && inline
      ? { 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'" }
      : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
    'Accept-Ranges': 'bytes',
    // El permiso se chequea en cada request: nada de caches compartidos.
    'Cache-Control': 'private, max-age=300',
  };

  if (block.url.startsWith('/uploads/')) {
    const root = path.join(process.cwd(), 'public', 'uploads');
    const file = path.join(process.cwd(), 'public', block.url);
    if (!file.startsWith(root + path.sep)) return null;
    let body: Uint8Array;
    try {
      body = new Uint8Array(await readFile(file));
    } catch {
      return null;
    }
    const range = parseRange(opts.range ?? null, body.length);
    if (range) {
      const [start, end] = range;
      return new NextResponse(body.slice(start, end + 1) as BodyInit, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new NextResponse(body as BodyInit, { headers: { ...headers, 'Content-Length': String(body.length) } });
  }

  const res = await fetch(block.url, opts.range ? { headers: { Range: opts.range } } : undefined).catch(() => null);
  if (!res || (!res.ok && res.status !== 206) || !res.body) return null;
  const out: Record<string, string> = { ...headers };
  const len = res.headers.get('content-length');
  if (len) out['Content-Length'] = len;
  const cr = res.headers.get('content-range');
  if (res.status === 206 && cr) out['Content-Range'] = cr;
  return new NextResponse(res.body as BodyInit, { status: res.status === 206 ? 206 : 200, headers: out });
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

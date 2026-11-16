import { readFile } from 'fs/promises';
import { NextResponse } from 'next/server';
import type { DocsBlock } from './docs-types';
import { contentDisposition, isInlineImageMime, isInlineMediaMime, isPdfMime } from './docs-files';
import { localUploadPath, migrateLegacyUploads } from './uploads';
import { isFileUrl, MAX_RESPONSE_CHUNK, openFile, ownedFileRow, parseByteRange, type FileOwner } from './files/store';

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
  opts: { download?: boolean; range?: string | null; owner?: FileOwner | null } = {},
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

  if (isFileUrl(block.url)) {
    // Storage privado (lib/files/store.ts): la ruta ya chequeó el acceso al
    // registro; además el archivo tiene que ser de su workspace (un bloque lo
    // escribe el cliente: nada de ids de archivos ajenos).
    const row = await ownedFileRow(block.url, opts.owner);
    if (!row) return null;
    const range = parseByteRange(opts.range ?? null, row.size);
    if (range === 'invalid') {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${row.size}` } });
    }
    const opened = await openFile(row, range, { cap: range ? MAX_RESPONSE_CHUNK : undefined }).catch(() => null);
    if (!opened) return null;
    const out: Record<string, string> = { ...headers, 'Content-Length': String(Math.max(0, opened.end - opened.start + 1)) };
    if (opened.partial) out['Content-Range'] = `bytes ${opened.start}-${opened.end}/${opened.size}`;
    return new NextResponse(opened.stream as BodyInit, { status: opened.partial ? 206 : 200, headers: out });
  }

  if (block.url.startsWith('/uploads/')) {
    // Disco local (UPLOADS_DIR, o public/uploads de versiones anteriores).
    const file = localUploadPath(block.url);
    if (!file) return null;
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

/** Carpetas cuyas URLs son públicas por diseño: se sirven con la URL. */
// workspace: logos de los workspaces (se ven en el switcher y en los emails de invitación).
// social: las redes (Meta, Threads) bajan las fotos y videos por URL para publicarlos.
// shop: fotos de productos y logos de tiendas (se ven en la tienda pública).
const PUBLIC_UPLOAD_FOLDERS = new Set(['workspace', 'shop', 'social']);
/**
 * Carpetas de antes que ya no son públicas (adjuntos de chats, Track, tareas
 * del CRM, Robots): se sirven solo si la migración registró el archivo, con
 * el permiso de su fila (lib/files/serve.ts).
 */
const REGISTERED_UPLOAD_FOLDERS = new Set(['chat', 'track', 'tasks', 'robots']);
/** Lo único que se muestra en línea: imágenes raster, audio y video. El resto se descarga. */
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
  weba: 'audio/webm',
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
};

/** Headers de un archivo subido servido desde el disco: tipo solo de la lista, nosniff y sandbox siempre. */
export function localUploadHeaders(name: string): Record<string, string> {
  const mime = INLINE_BY_EXT[name.toLowerCase().split('.').pop() ?? ''];
  // El nombre guardado es "<uuid>-<original>": se descarga con el original.
  const original = name.replace(/^[0-9a-f-]{36}-/, '');
  return {
    'Content-Type': mime ?? 'application/octet-stream',
    'Content-Disposition': contentDisposition(original || 'file', Boolean(mime)),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    // El nombre lleva un uuid: el archivo no cambia nunca.
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
}

/**
 * /uploads/<carpeta>/<nombre> (next.config lo reescribe acá antes de mirar
 * public/). Las carpetas públicas por diseño (logos, tienda, redes) se sirven
 * con la URL; las de adjuntos de antes, solo registradas y con permiso; el
 * resto (Docs, Notes, Board, media del CRM) pasa siempre por sus rutas con
 * chequeo de permisos y acá da 404.
 */
export async function localUploadResponse(segments: string[], req?: Request): Promise<Response> {
  const notFound = () =>
    new NextResponse('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'text/plain' } });
  if (segments.length !== 2) return notFound();
  const [folder, name] = segments;
  if (REGISTERED_UPLOAD_FOLDERS.has(folder) && req && /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/.test(name) && !name.includes('..')) {
    const { fileRowForLegacyKey } = await import('./files/store');
    const { serveFileRow } = await import('./files/serve');
    return serveFileRow(req, await fileRowForLegacyKey(`uploads/${folder}/${name}`).catch(() => null));
  }
  if (!PUBLIC_UPLOAD_FOLDERS.has(folder)) return notFound();
  await migrateLegacyUploads();
  const file = localUploadPath(`/uploads/${folder}/${name}`);
  if (!file) return notFound();
  let body: Uint8Array;
  try {
    body = new Uint8Array(await readFile(file));
  } catch {
    return notFound();
  }
  return new NextResponse(body as BodyInit, { headers: localUploadHeaders(name) });
}

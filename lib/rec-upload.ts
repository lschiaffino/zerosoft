/**
 * Rec: subida por partes y lectura de archivos. Server-only.
 *
 * - Con BLOB_READ_WRITE_TOKEN (producción): el servidor firma un token de
 *   cliente para un path exacto (rec/<workspace>/<video>/<azar>-<tipo>.<ext>)
 *   y el navegador hace la subida multipart directo a Vercel Blob mientras
 *   graba (partes de 8 MB). Las funciones no reciben el video: no hay tope de
 *   4,5 MB por request ni de 10 MB de las subidas comunes.
 * - Sin Blob (dev y self-host): partes de hasta 3 MB a
 *   /api/rec/videos/<id>/parts, guardadas en UPLOADS_DIR/rec-parts/<id> y
 *   unidas en orden al completar.
 */
import { createReadStream } from 'fs';
import { appendFile, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { Readable } from 'stream';
import { NextRequest, NextResponse } from 'next/server';
import { localUploadPath, uploadsRoot } from './uploads';
import { parseRange } from './crm-media-file';
import { RecError } from './rec';
import { MAX_REC_BYTES, MAX_REC_BYTES_LOCAL, MAX_REC_PARTS } from './rec-schema';

export type RecFileKind = 'video' | 'audio';

export function blobUploadEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Sin Blob en Vercel no hay dónde guardar (el disco es efímero). */
export function assertLocalStorage(): void {
  if (process.env.VERCEL && !blobUploadEnabled()) throw new RecError('storage_unavailable', 503);
}

function extFor(kind: RecFileKind, contentType: string): string {
  const base = contentType.split(';')[0].trim().toLowerCase();
  if (base.endsWith('/mp4')) return kind === 'audio' ? 'm4a' : 'mp4';
  if (base === 'video/quicktime') return 'mov';
  if (base === 'audio/ogg') return 'ogg';
  return kind === 'audio' ? 'weba' : 'webm';
}

export function recBlobPathname(ws: string, videoId: string, kind: RecFileKind, contentType: string): string {
  return `rec/${ws}/${videoId}/${randomBytes(9).toString('base64url')}-${kind}.${extFor(kind, contentType)}`;
}

/** Token de cliente de Blob para un solo archivo de un video (6 h: alcanza para grabaciones largas). */
export async function issueBlobToken(ws: string, videoId: string, kind: RecFileKind, contentType: string): Promise<{ pathname: string; token: string }> {
  const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client');
  const pathname = recBlobPathname(ws, videoId, kind, contentType);
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes: [contentType.split(';')[0].trim().toLowerCase()],
    maximumSizeInBytes: MAX_REC_BYTES,
    validUntil: Date.now() + 6 * 3600_000,
    addRandomSuffix: false,
  });
  return { pathname, token };
}

/** URL guardada válida para ese video: subida local propia o el Blob bajo rec/<ws>/<id>/. */
export function isOwnRecUrl(url: string, ws: string, videoId: string): boolean {
  if (url.startsWith('/uploads/rec/')) {
    const name = url.slice('/uploads/rec/'.length);
    return name.startsWith(`${videoId}-`) && /^[\w.-]+$/.test(name) && !name.includes('..');
  }
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com') && u.pathname.startsWith(`/rec/${ws}/${videoId}/`) && !u.pathname.includes('..');
  } catch {
    return false;
  }
}

function partsDir(videoId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(videoId)) throw new RecError('invalid_input');
  return path.join(uploadsRoot(), 'rec-parts', videoId);
}

/** Guarda una parte (1-based). Se puede mandar en cualquier orden (la 1 va al final, con la duración). */
export async function saveLocalPart(videoId: string, kind: RecFileKind, n: number, body: Buffer): Promise<void> {
  assertLocalStorage();
  if (!Number.isInteger(n) || n < 1 || n > MAX_REC_PARTS) throw new RecError('invalid_part');
  if (!body.length) throw new RecError('empty_part');
  const dir = partsDir(videoId);
  await mkdir(dir, { recursive: true });
  const names = await readdir(dir).catch(() => [] as string[]);
  let total = body.length;
  for (const name of names) if (name.startsWith(`${kind}-`)) total += (await stat(path.join(dir, name)).catch(() => null))?.size ?? 0;
  if (total > MAX_REC_BYTES_LOCAL) throw new RecError('file_too_large', 413);
  await writeFile(path.join(dir, `${kind}-${n}`), body);
}

/** Une las partes en orden en UPLOADS_DIR/rec y devuelve la URL /uploads/rec/<nombre> y el tamaño. */
export async function assembleLocal(videoId: string, kind: RecFileKind, contentType: string, expectedParts: number): Promise<{ url: string; size: number }> {
  assertLocalStorage();
  const dir = partsDir(videoId);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.startsWith(`${kind}-`));
  const nums = names.map((n) => Number(n.slice(kind.length + 1))).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length || nums.length !== expectedParts || nums[nums.length - 1] !== nums.length) throw new RecError('upload_incomplete', 409);
  const outDir = path.join(uploadsRoot(), 'rec');
  await mkdir(outDir, { recursive: true });
  const name = `${videoId}-${kind}-${randomBytes(6).toString('hex')}.${extFor(kind, contentType)}`;
  const out = path.join(outDir, name);
  let size = 0;
  for (const n of nums) {
    const buf = await readFile(path.join(dir, `${kind}-${n}`));
    size += buf.length;
    await appendFile(out, buf);
  }
  for (const n of nums) await unlink(path.join(dir, `${kind}-${n}`)).catch(() => undefined);
  return { url: `/uploads/rec/${name}`, size };
}

export async function deleteRecParts(videoId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(videoId)) return;
  await rm(partsDir(videoId), { recursive: true, force: true });
}

const COMMON = { 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' };

function attachment(filename: string): string {
  const safe = filename.replace(/[^\w .-]/g, '_').slice(0, 120) || 'video';
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename.slice(0, 120))}`;
}

/**
 * Sirve un archivo de Rec ya autorizado: local en stream con rangos (para
 * adelantar sin cargarlo entero); Blob, redirigido (Blob ya sirve rangos y,
 * con ?download=1, lo baja como adjunto).
 */
export async function serveRecFile(
  req: NextRequest,
  url: string,
  contentType: string,
  opts: { download?: string | null } = {},
): Promise<NextResponse> {
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });
  const type = contentType.split(';')[0] || 'application/octet-stream';
  const local = localUploadPath(url, 'rec');
  if (local) {
    const info = await stat(local).catch(() => null);
    if (!info?.isFile() || info.size === 0) return notFound();
    const range = parseRange(req.headers.get('range'), info.size);
    if (range === 'invalid') return new NextResponse(null, { status: 416, headers: { 'content-range': `bytes */${info.size}` } });
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    const stream = Readable.toWeb(createReadStream(local, { start, end })) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      status: range ? 206 : 200,
      headers: {
        ...COMMON,
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        ...(range ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
        ...(opts.download ? { 'content-disposition': attachment(opts.download) } : {}),
      },
    });
  }
  if (url.startsWith('/')) return notFound();
  if (!/^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(url)) return notFound();
  return NextResponse.redirect(opts.download ? `${url}?download=1` : url, 302);
}

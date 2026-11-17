/**
 * Servir documentos y videos del CRM desde una ruta API. Las subidas locales
 * (UPLOADS_DIR, dev y self-host) no se sirven nunca como estáticos. Las de Blob se
 * redirigen (videos) o se leen desde acá (PDF, para que pdf.js lo lea del mismo origen).
 */
import { open, stat } from 'fs/promises';
import { localUploadPath as localUpload } from './uploads';
import { NextRequest, NextResponse } from 'next/server';
import { isFileUrl } from './files/store';

const NOT_FOUND = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/** Ruta en disco de una subida local del CRM (null si no es local o se sale de la carpeta). */
export function localUploadPath(url: string): string | null {
  return localUpload(url, 'crm');
}

/** Rango pedido por el navegador ("bytes=a-b"); null si no hay o no se entiende. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Sufijo: los últimos N bytes.
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

export async function localResponse(req: NextRequest, full: string, headers: Record<string, string>): Promise<NextResponse> {
  const info = await stat(full).catch(() => null);
  if (!info?.isFile() || info.size === 0) return NOT_FOUND();
  const range = parseRange(req.headers.get('range'), info.size);
  if (range === 'invalid') {
    return new NextResponse(null, { status: 416, headers: { 'content-range': `bytes */${info.size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const length = end - start + 1;
  const fh = await open(full, 'r');
  const buf = Buffer.alloc(length);
  try {
    await fh.read(buf, 0, length, start);
  } finally {
    await fh.close();
  }
  return new NextResponse(new Uint8Array(buf), {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'accept-ranges': 'bytes',
      'content-length': String(length),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}),
    },
  });
}

function safeName(name: string, ext: string): string {
  const base = name.replace(/[^\w .-]/g, '_').slice(0, 120) || 'file';
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

const COMMON = { 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' };
/** El PDF en línea no puede ir con sandbox (el visor de Chrome no abre): nada de scripts ni de otros orígenes igual. */
const PDF_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'";
const SANDBOX_CSP = "default-src 'none'; sandbox";

/** Headers de un video: en línea solo si el tipo es de video; si no, se descarga. Siempre aislado. */
function videoHeaders(contentType: string): Record<string, string> {
  const type = contentType.split(';')[0].trim().toLowerCase() || 'video/webm';
  const video = /^video\/[\w.+-]+$/.test(type);
  return {
    ...COMMON,
    'content-type': video ? type : 'application/octet-stream',
    'content-security-policy': SANDBOX_CSP,
    ...(video ? {} : { 'content-disposition': 'attachment; filename="video"' }),
  };
}

/** PDF guardado (storage privado, local o Blob de antes), inline. `workspaceId`: el del registro (el archivo tiene que ser suyo). */
export async function servePdf(req: NextRequest, url: string, name: string, workspaceId: string): Promise<Response> {
  if (isFileUrl(url)) return (await (await import('./files/serve')).ownedFileResponse(req, url, { workspaceId })) ?? NOT_FOUND();
  const headers = { ...COMMON, 'content-type': 'application/pdf', 'content-security-policy': PDF_CSP, 'content-disposition': `inline; filename="${safeName(name, 'pdf')}"` };
  const local = localUploadPath(url);
  if (local) return localResponse(req, local, headers);
  if (url.startsWith('/')) return NOT_FOUND();
  // La URL sale de la base y solo puede ser de nuestro Blob (lib/crm-media isOwnUploadUrl).
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return NOT_FOUND();
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.length) return NOT_FOUND();
  return new NextResponse(new Uint8Array(body), { headers });
}

/**
 * Video guardado, con rangos (para adelantar): del storage privado, local o
 * del Blob de antes. Nunca se redirige a la URL del storage.
 */
export async function serveVideo(req: NextRequest, url: string, contentType: string, workspaceId: string): Promise<Response> {
  if (isFileUrl(url)) return (await (await import('./files/serve')).ownedFileResponse(req, url, { workspaceId })) ?? NOT_FOUND();
  const local = localUploadPath(url);
  if (local) return localResponse(req, local, videoHeaders(contentType));
  if (url.startsWith('/')) return NOT_FOUND();
  const { proxyPublicBlob } = await import('./files/legacy-proxy');
  return proxyPublicBlob(req, url, videoHeaders(contentType));
}

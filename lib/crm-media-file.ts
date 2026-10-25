/**
 * Servir documentos y videos del CRM desde una ruta API. Las subidas locales
 * (UPLOADS_DIR, dev y self-host) no se sirven nunca como estáticos. Las de Blob se
 * redirigen (videos) o se leen desde acá (PDF, para que pdf.js lo lea del mismo origen).
 */
import { open, stat } from 'fs/promises';
import { localUploadPath as localUpload } from './uploads';
import { NextRequest, NextResponse } from 'next/server';

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

async function localResponse(req: NextRequest, full: string, headers: Record<string, string>): Promise<NextResponse> {
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

/** PDF guardado (local o Blob), inline. */
export async function servePdf(req: NextRequest, url: string, name: string): Promise<NextResponse> {
  const headers = { ...COMMON, 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${safeName(name, 'pdf')}"` };
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

/** Video guardado: local con rangos (para adelantar); Blob, redirigido (ya sirve rangos). */
export async function serveVideo(req: NextRequest, url: string, contentType: string): Promise<NextResponse> {
  const local = localUploadPath(url);
  if (local) return localResponse(req, local, { ...COMMON, 'content-type': contentType.split(';')[0] || 'video/webm' });
  if (url.startsWith('/')) return NOT_FOUND();
  return NextResponse.redirect(url, 302);
}

/**
 * Archivos de antes en el Blob público de la suite que todavía no migró el
 * script (scripts/migrate-private-files.ts): una ruta que ya chequeó el
 * permiso los pasa en stream, con rangos, sin redirigir (la URL del storage
 * no llega al navegador). Server-only.
 */
import { NextResponse } from 'next/server';
import { MAX_RESPONSE_CHUNK, parseByteRange } from './store';

function ownBlob(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export async function proxyPublicBlob(req: Request, url: string, headers: Record<string, string>): Promise<Response> {
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ownBlob(url)) return notFound();
  const head = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  const size = Number(head?.headers.get('content-length'));
  if (!head?.ok || !Number.isFinite(size) || size <= 0) return notFound();
  const range = parseByteRange(req.headers.get('range'), size);
  if (range === 'invalid') return new NextResponse(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const start = range?.start ?? 0;
  const end = range ? Math.min(range.end, start + MAX_RESPONSE_CHUNK - 1) : size - 1;
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store' }).catch(() => null);
  if (!res?.body || (res.status !== 206 && res.status !== 200)) return notFound();
  const partial = start > 0 || end < size - 1;
  return new NextResponse(res.body, {
    status: partial ? 206 : 200,
    headers: {
      ...headers,
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      ...(partial ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

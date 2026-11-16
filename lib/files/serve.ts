/**
 * Servir archivos de lib/files/store.ts. Server-only.
 *
 * - authorizeFile: el permiso de /api/files (sesión + workspace + app, o la
 *   persona dueña, o una URL firmada; 'internal' nunca).
 * - fileResponse: la respuesta con el archivo ya autorizado, en stream, con
 *   rangos (video y audio adelantan sin bajar todo) y headers seguros: solo se
 *   muestra en línea lo que es imagen, audio, video, PDF o texto; lo demás se
 *   descarga como application/octet-stream; nosniff y CSP sandbox siempre.
 *
 * Las rutas de las apps que chequean un permiso más fino (el chat de Lines,
 * la página de Docs) llaman a fileResponse después de su chequeo.
 */
import { NextResponse } from 'next/server';
import type { ProductKey } from '../products';
import { PRODUCT_CONFIG } from '../products';
import { scopeAllows } from './scopes';
import { MAX_RESPONSE_CHUNK, fileSize, openFile, ownedFileRow, parseByteRange, verifySignature, type FileOwner, type StoredFileRow } from './store';

export type FileDecision = 'ok' | 'unauthorized' | 'not_found';

/** El permiso de /api/files para esta fila. 'not_found' también cuando existe y no es tuyo (no se dice que existe). */
export async function authorizeFile(row: StoredFileRow, search: URLSearchParams): Promise<FileDecision> {
  if (search.has('sig') || search.has('exp')) {
    return verifySignature(row, search.get('exp'), search.get('sig')) ? 'ok' : 'not_found';
  }
  if (row.access === 'public') return 'ok';
  if (row.access === 'internal') return 'not_found';
  const { getCurrentUser, realUserId, userCanUseApp } = await import('../session');
  const user = await getCurrentUser();
  if (!user) return 'unauthorized';
  if (row.access === 'user') return row.user_id && realUserId(user) === row.user_id ? 'ok' : 'not_found';
  // 'workspace': la sesión está en ese workspace y la persona tiene la app.
  if (user.id !== row.workspace_id) return 'not_found';
  if (row.app && row.app in PRODUCT_CONFIG && !userCanUseApp(user, row.app as ProductKey)) return 'not_found';
  if (row.scope && !(await scopeAllows(row.scope, user))) return 'not_found';
  return 'ok';
}

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/**
 * Respuesta con el archivo (ya autorizado). Con Range, a lo sumo
 * MAX_RESPONSE_CHUNK por respuesta (206): las funciones de Vercel cortan el
 * cuerpo en 4,5 MB y el reproductor pide el resto.
 */
export async function fileResponse(
  req: Request,
  row: StoredFileRow,
  opts: { download?: boolean; publicCache?: boolean; head?: boolean } = {},
): Promise<Response> {
  const { servingFor } = await import('../file-attachments');
  const s = servingFor(row.name, row.mime, { download: opts.download });
  // Una fila de antes registrada con tamaño 0 usa el del original: si no, el rango se ignoraría y siempre saldría desde el byte 0.
  const size = await fileSize(row);
  const range = parseByteRange(req.headers.get('range'), size);
  if (range === 'invalid' && size > 0) {
    return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' } });
  }
  const wanted = range && range !== 'invalid' ? range : null;
  const headers: Record<string, string> = {
    ...s.headers,
    'Accept-Ranges': 'bytes',
    'X-Robots-Tag': 'noindex',
    // El permiso se chequea en cada pedido: nada de caches compartidos (salvo lo público por diseño).
    'Cache-Control': opts.publicCache ? 'public, max-age=3600' : 'private, max-age=3600',
    ...(opts.publicCache ? { 'Cross-Origin-Resource-Policy': 'cross-origin' } : {}),
  };
  if (opts.head) {
    // HEAD con Range responde lo mismo que el GET (206 y el rango), sin cuerpo.
    if (wanted) {
      const end = Math.min(wanted.end, wanted.start + MAX_RESPONSE_CHUNK - 1);
      return new NextResponse(null, {
        status: 206,
        headers: { ...headers, 'Content-Length': String(end - wanted.start + 1), 'Content-Range': `bytes ${wanted.start}-${end}/${size}` },
      });
    }
    return new NextResponse(null, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  }
  const opened = await openFile({ ...row, size }, wanted, { cap: wanted ? MAX_RESPONSE_CHUNK : undefined }).catch(() => null);
  if (!opened) return notFound();
  const out: Record<string, string> = { ...headers, 'Content-Length': String(Math.max(0, opened.end - opened.start + 1)) };
  if (opened.partial) out['Content-Range'] = `bytes ${opened.start}-${opened.end}/${opened.size}`;
  return new NextResponse(opened.stream as BodyInit, { status: opened.partial ? 206 : 200, headers: out });
}

/**
 * Para las rutas de las apps que ya chequearon el permiso sobre su registro:
 * sirve la URL de /api/files guardada en él, solo si el archivo es de ese
 * workspace (o persona). null si no es una URL de /api/files, no está o es
 * ajeno (la ruta responde 404).
 */
export async function ownedFileResponse(
  req: Request,
  url: string | null | undefined,
  owner: FileOwner | null | undefined,
  opts: { download?: boolean } = {},
): Promise<Response | null> {
  const row = await ownedFileRow(url, owner).catch(() => null);
  if (!row) return null;
  return fileResponse(req, row, { download: opts.download });
}

/** Autoriza y sirve (lo que hacen /api/files/<id> y /api/files/legacy/…). */
export async function serveFileRow(req: Request, row: StoredFileRow | null, opts: { head?: boolean } = {}): Promise<Response> {
  if (!row) return notFound();
  const url = new URL(req.url);
  const decision = await authorizeFile(row, url.searchParams);
  if (decision === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  if (decision !== 'ok') return notFound();
  const signed = url.searchParams.has('sig');
  return fileResponse(req, row, {
    download: url.searchParams.get('download') === '1',
    publicCache: row.access === 'public' && !signed,
    head: opts.head,
  });
}

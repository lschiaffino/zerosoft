import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { isAllowedUpload } from '@/lib/uploads';
import { limitWrites } from '@/lib/write-limit';
import { groupsError, groupsSession } from '@/lib/groups-http';
import { WA_MEDIA_LIMITS } from '@/lib/groups-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El nombre que arma el navegador: chat/<uuid>-<nombre seguro>. */
const PATHNAME = /^chat\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/;
/** Permisos de subida por persona y minuto (cada uno deja subir un archivo). */
const TOKENS_PER_MINUTE = 30;

/**
 * Subida directa del navegador a Vercel Blob para adjuntos de Groups más
 * grandes que el tope del servidor (4,5 MB en Vercel), hasta 100 MB (el tope
 * de WhatsApp para documentos). El servidor no recibe el archivo: solo firma
 * el permiso. Con `upload('chat/<uuid>-<nombre>', file, { access: 'public',
 * handleUploadUrl: '/api/groups/upload/blob' })` de @vercel/blob/client; la
 * URL que vuelve se manda como media ({ url, mimetype, filename, size }).
 * Sin BLOB_READ_WRITE_TOKEN responde 501 client_upload_unavailable: se sube
 * por POST /api/groups/upload.
 */
export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return groupsError(501, 'client_upload_unavailable');
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== 'object' || !('type' in body)) return groupsError(400, 'invalid_input');
  // El aviso de "subida terminada" lo manda Vercel (sin sesión): no hace falta, el navegador manda la URL.
  if (body.type !== 'blob.generate-client-token') return NextResponse.json({ ok: true });

  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const limited = await limitWrites('groups:blob', s.me, TOKENS_PER_MINUTE);
  if (limited) return limited;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // La extensión (HTML, SVG, JS…) se chequea acá; el tipo, con allowedContentTypes.
        if (!PATHNAME.test(pathname) || !isAllowedUpload(pathname, '')) throw new Error('file_type_not_allowed');
        return {
          maximumSizeInBytes: WA_MEDIA_LIMITS.document,
          addRandomSuffix: false,
          allowOverwrite: false,
          // Nada que el navegador ejecute (HTML, SVG, JS, XML).
          allowedContentTypes: [
            'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/heic', 'image/heif', 'image/tiff',
            'video/*', 'audio/*', 'application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/gzip',
            'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
            'application/vnd.oasis.opendocument.presentation', 'application/rtf', 'application/epub+zip',
            'application/json', 'application/octet-stream', 'application/x-7z-compressed', 'application/vnd.rar', 'application/x-tar',
            'text/plain', 'text/csv', 'text/markdown', 'text/calendar', 'text/vcard',
          ],
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const code = err instanceof Error && err.message === 'file_type_not_allowed' ? 'file_type_not_allowed' : 'upload_failed';
    return groupsError(code === 'file_type_not_allowed' ? 415 : 400, code);
  }
}

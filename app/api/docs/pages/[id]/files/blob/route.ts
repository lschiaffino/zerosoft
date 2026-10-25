import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getCurrentUser } from '@/lib/session';
import { getDocAccess, getDocPageRow } from '@/lib/docs';
import { isAllowedUpload } from '@/lib/uploads';
import { DOCS_MAX_BLOB_UPLOAD, isDocsStoragePathname } from '@/lib/docs-files';
import { docsError, forbidden, notFound, unauthorized } from '@/lib/docs-http';
import { canWriteAccess } from '@/lib/docs-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Subida directa del navegador a Vercel Blob (archivos grandes: el servidor
 * no recibe el archivo, solo firma un permiso de subida). Hace falta poder
 * editar la página y el nombre tiene que ser el que arma el editor
 * (docs/<uuid>-<nombre>), así la URL que vuelve es una que acepta el bloque.
 * Sin BLOB_READ_WRITE_TOKEN responde 501 y el editor sube por el servidor.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return docsError(501, 'client_upload_unavailable');
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== 'object' || !('type' in body)) return docsError(400, 'invalid_input');
  // El aviso de "subida terminada" lo manda Vercel (sin sesión): no hace falta, el editor guarda la URL.
  if (body.type !== 'blob.generate-client-token') return NextResponse.json({ ok: true });

  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getDocPageRow(id);
  const access = row ? await getDocAccess(row, user) : null;
  if (!row || !access) return notFound();
  if (!canWriteAccess(access)) return forbidden();
  if (row.locked === 1) return docsError(423, 'locked');

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // La extensión (HTML, SVG, JS…) se chequea acá; el tipo, con allowedContentTypes.
        if (!isDocsStoragePathname(pathname) || !isAllowedUpload(pathname, '')) throw new Error('file_type_not_allowed');
        return {
          maximumSizeInBytes: DOCS_MAX_BLOB_UPLOAD,
          addRandomSuffix: false,
          allowOverwrite: false,
          // Nada que el navegador ejecute (HTML, SVG, JS, XML).
          allowedContentTypes: [
            'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/heic', 'image/tiff',
            'video/*', 'audio/*', 'application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/gzip',
            'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
            'application/rtf', 'application/json', 'application/octet-stream', 'application/x-7z-compressed',
            'text/plain', 'text/csv', 'text/markdown', 'font/*',
          ],
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const code = err instanceof Error && err.message === 'file_type_not_allowed' ? 'file_type_not_allowed' : 'upload_failed';
    return docsError(code === 'file_type_not_allowed' ? 415 : 400, code);
  }
}

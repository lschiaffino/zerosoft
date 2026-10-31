import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getCurrentUser } from '@/lib/session';
import { noteOwner } from '@/lib/notes';
import { resolveNoteAccess } from '@/lib/notes-shares';
import { isAllowedUpload } from '@/lib/uploads';
import { DOCS_MAX_BLOB_UPLOAD, isDocsStoragePathname } from '@/lib/docs-files';
import { jsonError } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Subida directa del navegador a Vercel Blob, como en Docs: una función de
 * Vercel no recibe más de 4.5 MB. Hace falta poder editar la nota. Sin
 * BLOB_READ_WRITE_TOKEN responde 501 y la subida va por el servidor.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return jsonError(501, 'client_upload_unavailable');
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== 'object' || !('type' in body)) return jsonError(400, 'invalid_input');
  // El aviso de "subida terminada" lo manda Vercel (sin sesión): la URL la guarda el editor.
  if (body.type !== 'blob.generate-client-token') return NextResponse.json({ ok: true });

  const user = await getCurrentUser();
  if (!user) return jsonError(401, 'unauthorized');
  const access = await resolveNoteAccess(noteOwner(user), id);
  if (!access || access.access === 'view' || access.row.trashed_at) return jsonError(404, 'not_found');

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
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
            'application/json', 'application/octet-stream', 'text/plain', 'text/csv', 'text/markdown',
          ],
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const code = err instanceof Error && err.message === 'file_type_not_allowed' ? 'file_type_not_allowed' : 'upload_failed';
    return jsonError(code === 'file_type_not_allowed' ? 415 : 400, code);
  }
}

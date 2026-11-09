import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { isAllowedUpload } from '@/lib/uploads';
import { limitWrites } from '@/lib/write-limit';
import { inboxOwner, iJson } from '@/lib/inbox/http';
import { WA_MEDIA_LIMITS } from '@/lib/groups-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El nombre que arma el navegador: inbox/<uuid>-<nombre seguro>. */
const PATHNAME = /^inbox\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/;

/**
 * Subida directa del navegador a Blob para archivos de WhatsApp de Inbox
 * más grandes que lo que entra en un pedido (4 MB). Solo firma el permiso
 * (con la sesión de la persona); el archivo se borra apenas lo baja el
 * servidor de WhatsApp (lib/inbox/wa-media.ts). Sin Blob: 501.
 */
export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return iJson({ error: 'client_upload_unavailable' }, 501);
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || typeof body !== 'object' || !('type' in body)) return iJson({ error: 'invalid_input' }, 400);
  if (body.type !== 'blob.generate-client-token') return NextResponse.json({ ok: true });
  const who = await inboxOwner();
  if ('res' in who) return who.res;
  const limited = await limitWrites('inbox:blob', who.owner, 30);
  if (limited) return limited;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!PATHNAME.test(pathname) || !isAllowedUpload(pathname, '')) throw new Error('file_type_not_allowed');
        return {
          maximumSizeInBytes: WA_MEDIA_LIMITS.document,
          addRandomSuffix: false,
          allowOverwrite: false,
          // Nada que el navegador ejecute (HTML, SVG, JS, XML).
          allowedContentTypes: [
            'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
            'video/*', 'audio/*', 'application/pdf', 'application/zip', 'application/x-zip-compressed',
            'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
            'application/rtf', 'application/epub+zip', 'application/octet-stream', 'application/vnd.rar', 'application/x-7z-compressed',
            'text/plain', 'text/csv', 'text/vcard',
          ],
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const code = err instanceof Error && err.message === 'file_type_not_allowed' ? 'file_type_not_allowed' : 'upload_failed';
    return iJson({ error: code }, code === 'file_type_not_allowed' ? 415 : 400);
  }
}

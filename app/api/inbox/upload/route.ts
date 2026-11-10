import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { iJson, inboxOwner, withOwner } from '@/lib/inbox/http';
import { MAX_IMPORT_BYTES } from '@/lib/inbox/import-jobs';
import { MAX_SCHEDULED_MEDIA } from '@/lib/inbox/schedule';
import { InboxError } from '@/lib/inbox/types';
import { limitByIp } from '@/lib/rate-limit';
import { isAllowedUpload, saveUpload, UploadError } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tipos de archivo de un mensaje programado (los que WhatsApp manda como foto, video, audio o documento). */
const MEDIA_TYPES = ['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/zip', 'text/plain', 'application/msword', 'application/vnd.*', 'application/octet-stream'];

/** Cómo subir: directo a Vercel Blob (archivos grandes) o por esta ruta (servidor propio). */
export async function GET() {
  return withOwner(async () => iJson({ mode: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'server', maxMedia: MAX_SCHEDULED_MEDIA }));
}

/**
 * Subidas de Inbox:
 * - JSON (protocolo de @vercel/blob/client): firma la subida directa del
 *   navegador a Blob: `inbox/…`, el archivo de un mensaje programado (hasta
 *   16 MB), o `inbox-import/….ndjson`, una exportación de inbox-zero (hasta
 *   2 GB, en partes). El archivo no pasa por esta función.
 * - multipart (sin Blob, servidor propio): guarda el archivo de un mensaje
 *   programado en la carpeta privada de subidas.
 */
export async function POST(req: Request) {
  const limited = await limitByIp(req, 'inbox-upload', 60, 600).catch(() => null);
  if (limited) return limited;
  if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    return withOwner(async () => {
      if (Number(req.headers.get('content-length') ?? 0) > MAX_SCHEDULED_MEDIA + 64 * 1024) throw new InboxError('too_large', 413);
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File) || file.size === 0) throw new InboxError('invalid_input', 400);
      if (file.size > MAX_SCHEDULED_MEDIA) throw new InboxError('too_large', 413);
      const type = file.type || 'application/octet-stream';
      if (!isAllowedUpload(file.name, type)) throw new InboxError('file_type_not_allowed', 415);
      try {
        const url = await saveUpload('inbox', file.name, type, Buffer.from(await file.arrayBuffer()));
        return iJson({ url, name: file.name.slice(0, 200), type }, 201);
      } catch (err) {
        if (err instanceof UploadError) throw new InboxError(err.code, err.status);
        throw err;
      }
    });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return iJson({ error: 'storage_unavailable' }, 503);
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return iJson({ error: 'invalid_input' }, 400);
  // El aviso de "subida completa" lo manda Blob (sin sesión): no se usa.
  if (body.type === 'blob.generate-client-token') {
    const who = await inboxOwner();
    if ('res' in who) return who.res;
  }
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (/^inbox-import\/[A-Za-z0-9._-]{1,120}\.ndjson$/.test(pathname)) {
          return { allowedContentTypes: ['application/x-ndjson', 'application/json', 'application/octet-stream', 'text/plain'], maximumSizeInBytes: MAX_IMPORT_BYTES, addRandomSuffix: true };
        }
        if (/^inbox\/[A-Za-z0-9._-]{1,160}$/.test(pathname) && isAllowedUpload(pathname, 'application/octet-stream')) {
          return { allowedContentTypes: MEDIA_TYPES, maximumSizeInBytes: MAX_SCHEDULED_MEDIA, addRandomSuffix: true };
        }
        throw new Error('invalid_pathname');
      },
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(result);
  } catch {
    return iJson({ error: 'upload_failed' }, 400);
  }
}

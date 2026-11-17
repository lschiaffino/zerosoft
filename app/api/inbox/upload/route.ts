import { iJson, withOwner } from '@/lib/inbox/http';
import { MAX_SCHEDULED_MEDIA } from '@/lib/inbox/schedule';
import { InboxError } from '@/lib/inbox/types';
import { limitByIp } from '@/lib/rate-limit';
import { isAllowedUpload, saveUpload, UploadError } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cómo subir: directo a Vercel Blob (archivos grandes) o por esta ruta (servidor propio). */
export async function GET() {
  // 'blob': el archivo de un programado sube directo y privado por /api/files/upload (lib/files/direct-upload.ts).
  return withOwner(async () => iJson({ mode: process.env.BLOB_READ_WRITE_TOKEN || process.env.FILES_BLOB_READ_WRITE_TOKEN ? 'blob' : 'server', maxMedia: MAX_SCHEDULED_MEDIA }));
}

/**
 * Subida por el servidor (multipart, sin subida directa): el archivo de un
 * mensaje programado, privado en el storage de archivos. Lo grande (un
 * programado o la exportación de inbox-zero) sube directo y privado por
 * /api/files/upload (lib/files/direct-upload.ts); acá ya no se firma nada.
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
  // Pestaña vieja que pide firmar una subida pública: ya no existe.
  return iJson({ error: 'client_upload_unavailable' }, 501);
}

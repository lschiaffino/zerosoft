import { NextResponse } from 'next/server';
import { MAX_UPLOAD_SIZE, UploadError, isAllowedUpload, saveUpload } from '@/lib/uploads';
import { groupsError, groupsSession } from '@/lib/groups-http';
import { imageSize } from '@/lib/groups-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Archivos por pedido (arrastrar y soltar varios). */
const MAX_FILES = 10;

interface Uploaded {
  url: string;
  mimetype: string;
  filename: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}

interface Failed {
  filename: string;
  error: 'file_too_large' | 'file_type_not_allowed' | 'invalid_input' | 'storage_unavailable' | 'upload_failed';
}

const STATUS: Record<Failed['error'], number> = {
  file_too_large: 413,
  file_type_not_allowed: 415,
  invalid_input: 400,
  storage_unavailable: 503,
  upload_failed: 500,
};

/**
 * Sube adjuntos para mandarlos por WhatsApp (multipart, campo `file`, uno o
 * varios). Cada archivo devuelve { url, mimetype, filename, size, width?,
 * height?, duration? }; la url es la que se pasa como media al mandar. Las
 * medidas de las imágenes salen del archivo; `duration` (segundos, una nota
 * de voz grabada) la manda el navegador en el campo `duration`.
 *
 * Respuesta: { files: [...], errors: [{ filename, error }] } y, con un solo
 * archivo, también sus campos arriba (como antes). Si ninguno se pudo subir,
 * el status es el del primer error y `error` su código.
 *
 * Más grandes que el tope del servidor (10 MB, y 4,5 MB en Vercel): subida
 * directa a Blob con POST /api/groups/upload/blob.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const form = await req.formData().catch(() => null);
  if (!form) return groupsError(400, 'invalid_input');
  const blobs = [...form.getAll('file'), ...form.getAll('files')].filter((f): f is File => f instanceof Blob);
  if (blobs.length === 0) return groupsError(400, 'invalid_input');
  if (blobs.length > MAX_FILES) return groupsError(400, 'too_many_files');
  const durations = form.getAll('duration').map((d) => Number(d));

  const files: Uploaded[] = [];
  const errors: Failed[] = [];
  for (const [i, file] of blobs.entries()) {
    const filename = (file.name || 'file').slice(0, 200);
    const mimetype = (file.type || 'application/octet-stream').slice(0, 100);
    if (file.size === 0) {
      errors.push({ filename, error: 'invalid_input' });
      continue;
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      errors.push({ filename, error: 'file_too_large' });
      continue;
    }
    if (!isAllowedUpload(filename, mimetype)) {
      errors.push({ filename, error: 'file_type_not_allowed' });
      continue;
    }
    try {
      const data = Buffer.from(await file.arrayBuffer());
      const url = await saveUpload('chat', filename, mimetype, data);
      const out: Uploaded = { url, mimetype, filename, size: file.size };
      if (mimetype.startsWith('image/')) {
        const dims = imageSize(data);
        if (dims && dims.width > 0 && dims.height > 0) Object.assign(out, dims);
      }
      const duration = durations[i] ?? (blobs.length === 1 ? durations[0] : NaN);
      if ((mimetype.startsWith('audio/') || mimetype.startsWith('video/')) && Number.isFinite(duration) && duration > 0 && duration <= 86_400) {
        out.duration = Math.round(duration);
      }
      files.push(out);
    } catch (err) {
      errors.push({ filename, error: err instanceof UploadError ? err.code : 'upload_failed' });
    }
  }
  if (files.length === 0) {
    const first = errors[0]?.error ?? 'upload_failed';
    return NextResponse.json({ error: first, files, errors }, { status: STATUS[first] });
  }
  return NextResponse.json({ ...(blobs.length === 1 ? files[0] : {}), files, errors }, { status: 201 });
}

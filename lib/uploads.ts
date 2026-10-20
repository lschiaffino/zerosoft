import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { del, put } from '@vercel/blob';

/**
 * Almacenamiento de archivos subidos (adjuntos de Chat, Track, tareas del CRM y
 * bloques de imagen/archivo de Docs).
 * - Con BLOB_READ_WRITE_TOKEN → Vercel Blob (lo que usa producción).
 * - Sin token y fuera de Vercel → disco local en public/uploads (dev / self-host).
 * - Sin token en Vercel → error: el filesystem es read-only y efímero.
 *
 * Los tipos que el navegador ejecuta (HTML, SVG, XML, JS) se rechazan siempre:
 * servidos desde nuestro origen serían XSS almacenado.
 */

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

const BLOCKED_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'xsl', 'js', 'mjs', 'cjs', 'php', 'swf',
]);
const BLOCKED_MIME = /(html|svg|xml|javascript|ecmascript|x-php|shockwave)/i;

export class UploadError extends Error {
  constructor(
    public code: 'file_type_not_allowed' | 'storage_unavailable',
    public status: number,
  ) {
    super(code);
  }
}

function safeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'upload';
}

export function isAllowedUpload(filename: string, contentType: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return !BLOCKED_EXTENSIONS.has(ext) && !BLOCKED_MIME.test(contentType);
}

/** Guarda el archivo y devuelve su URL pública. `folder`: chat | track | tasks | robots | docs. */
export async function saveUpload(
  folder: 'chat' | 'track' | 'tasks' | 'robots' | 'docs',
  filename: string,
  contentType: string,
  buffer: Buffer,
): Promise<string> {
  if (!isAllowedUpload(filename, contentType)) throw new UploadError('file_type_not_allowed', 415);

  const name = `${crypto.randomUUID()}-${safeFilename(filename)}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${folder}/${name}`, buffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
    });
    return blob.url;
  }

  if (process.env.VERCEL) throw new UploadError('storage_unavailable', 503);

  const dir = path.join(process.cwd(), 'public', 'uploads', folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buffer);
  return `/uploads/${folder}/${name}`;
}

/**
 * Borra archivos guardados con saveUpload (best effort: un fallo no corta el
 * borrado de las filas). Sin esto, el blob público seguía accesible con la URL
 * después de borrar el adjunto.
 */
export async function deleteUploads(urls: string[]): Promise<void> {
  const blobs = urls.filter((u) => /^https:\/\//.test(u));
  const local = urls.filter((u) => u.startsWith('/uploads/'));
  if (blobs.length > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(blobs).catch(() => undefined);
  }
  const root = path.join(process.cwd(), 'public', 'uploads');
  for (const url of local) {
    const file = path.join(process.cwd(), 'public', url);
    // Nunca fuera de public/uploads (la URL sale de la base, pero por las dudas).
    if (!file.startsWith(root + path.sep)) continue;
    await unlink(file).catch(() => undefined);
  }
}

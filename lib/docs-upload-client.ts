'use client';

import {
  cleanFileName,
  DOCS_MAX_UPLOAD,
  docsStoragePathname,
  type DocsUploadConfig,
  type DocsUploadResult,
} from './docs-files';

/**
 * Subida de un archivo del editor de Docs. Con Vercel Blob el navegador sube
 * directo al storage (hasta 5 GB, en partes si es grande) y el servidor solo
 * firma el permiso (/api/docs/pages/<id>/files/blob); sin Blob (servidor
 * propio) va por multipart a la ruta de la página, que lo guarda en disco.
 * Notes pasa su propia ruta: como no publica una config, sube por el servidor.
 */

const configs = new Map<string, Promise<DocsUploadConfig>>();

function uploadConfig(uploadUrl: string): Promise<DocsUploadConfig> {
  let p = configs.get(uploadUrl);
  if (!p) {
    p = fetch(uploadUrl, { method: 'GET' })
      .then(async (r) => (r.ok ? ((await r.json()) as DocsUploadConfig) : { mode: 'server' as const, max: DOCS_MAX_UPLOAD }))
      .catch(() => ({ mode: 'server' as const, max: DOCS_MAX_UPLOAD }));
    configs.set(uploadUrl, p);
  }
  return p;
}

export class DocsUploadError extends Error {
  constructor(public code: 'file_too_large' | 'file_type_not_allowed' | 'storage_unavailable' | 'failed') {
    super(code);
  }
}

/** Tope de tamaño para esta ruta (lo que el editor avisa antes de subir). */
export async function uploadLimit(uploadUrl: string): Promise<number> {
  return (await uploadConfig(uploadUrl)).max;
}

export async function uploadDocsFile(
  file: File,
  opts: { uploadUrl: string; onProgress?: (percent: number) => void },
): Promise<DocsUploadResult> {
  const config = await uploadConfig(opts.uploadUrl);
  if (file.size > config.max) throw new DocsUploadError('file_too_large');
  const name = cleanFileName(file.name) || 'file';
  const mime = file.type || 'application/octet-stream';
  if (config.mode === 'blob') {
    const { upload } = await import('@vercel/blob/client');
    try {
      const blob = await upload(docsStoragePathname(name, crypto.randomUUID()), file, {
        access: 'public',
        handleUploadUrl: `${opts.uploadUrl}/blob`,
        contentType: mime,
        multipart: file.size > 64 * 1024 * 1024,
        onUploadProgress: opts.onProgress ? (e) => opts.onProgress!(e.percentage) : undefined,
      });
      return { url: blob.url, name, size: file.size, mime };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/content type|file_type_not_allowed|not allowed/i.test(msg)) throw new DocsUploadError('file_type_not_allowed');
      throw new DocsUploadError('failed');
    }
  }
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(opts.uploadUrl, { method: 'POST', body });
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    if (code === 'file_type_not_allowed' || code === 'storage_unavailable' || code === 'file_too_large') throw new DocsUploadError(code);
    throw new DocsUploadError('failed');
  }
  return (await res.json()) as DocsUploadResult;
}

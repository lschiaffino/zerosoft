'use client';

import {
  cleanFileName,
  DOCS_MAX_UPLOAD,
  type DocsUploadConfig,
  type DocsUploadResult,
} from './docs-files';

/**
 * Subida de un archivo del editor de Docs. Con Vercel Blob el navegador sube
 * directo al storage, privado (hasta 100 MB, en partes si es grande;
 * lib/files/direct-upload-client.ts); sin Blob (servidor
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
  constructor(public code: 'file_too_large' | 'file_type_not_allowed' | 'storage_unavailable' | 'rate_limited' | 'failed') {
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
    // Directo al storage, privado (lib/files/direct-upload-client.ts): se sirve solo por la ruta de la página.
    const { directUpload, DirectUploadUnavailable } = await import('./files/direct-upload-client');
    try {
      const up = await directUpload(file, {
        purpose: opts.uploadUrl.startsWith('/api/notes/') ? 'notes' : 'docs',
        name,
        contentType: mime,
        onProgress: opts.onProgress ? (f) => opts.onProgress!(f * 100) : undefined,
      });
      return { url: up.url, name, size: file.size, mime };
    } catch (err) {
      if (err instanceof DirectUploadUnavailable) throw new DocsUploadError('storage_unavailable');
      const code = (err as { code?: string })?.code;
      if (code === 'file_type_not_allowed') throw new DocsUploadError('file_type_not_allowed');
      if (code === 'file_too_large') throw new DocsUploadError('file_too_large');
      if (code === 'rate_limited') throw new DocsUploadError('rate_limited');
      throw new DocsUploadError('failed');
    }
  }
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(opts.uploadUrl, { method: 'POST', body });
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    if (code === 'file_type_not_allowed' || code === 'storage_unavailable' || code === 'file_too_large' || code === 'rate_limited') throw new DocsUploadError(code);
    throw new DocsUploadError('failed');
  }
  return (await res.json()) as DocsUploadResult;
}

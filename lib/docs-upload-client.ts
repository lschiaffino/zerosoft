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
  constructor(public code: 'file_too_large' | 'file_type_not_allowed' | 'storage_unavailable' | 'rate_limited' | 'failed' | 'aborted') {
    super(code);
  }
}

/**
 * Multipart a nuestra ruta con XMLHttpRequest: fetch no informa el progreso
 * de lo que se sube, y el esqueleto del editor lo muestra.
 */
function postMultipart(
  url: string,
  file: File,
  onProgress: ((percent: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DocsUploadError('aborted'));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress((e.loaded / e.total) * 100);
      };
    }
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new DocsUploadError('failed'));
    };
    xhr.onabort = () => reject(new DocsUploadError('aborted'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/** Tope de tamaño para esta ruta (lo que el editor avisa antes de subir). */
export async function uploadLimit(uploadUrl: string): Promise<number> {
  return (await uploadConfig(uploadUrl)).max;
}

export async function uploadDocsFile(
  file: File,
  opts: { uploadUrl: string; onProgress?: (percent: number) => void; signal?: AbortSignal },
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
        // Progreso en porcentaje (lo que muestra el esqueleto de la subida) y cancelar con la X.
        onProgress: opts.onProgress ? (f) => opts.onProgress!(f * 100) : undefined,
        abortSignal: opts.signal,
      });
      return { url: up.url, name, size: file.size, mime };
    } catch (err) {
      if (opts.signal?.aborted) throw new DocsUploadError('aborted');
      if (err instanceof DirectUploadUnavailable) throw new DocsUploadError('storage_unavailable');
      const code = (err as { code?: string })?.code;
      if (code === 'file_type_not_allowed') throw new DocsUploadError('file_type_not_allowed');
      if (code === 'file_too_large') throw new DocsUploadError('file_too_large');
      if (code === 'rate_limited') throw new DocsUploadError('rate_limited');
      throw new DocsUploadError('failed');
    }
  }
  const res = await postMultipart(opts.uploadUrl, file, opts.onProgress, opts.signal);
  if (res.status < 200 || res.status >= 300) {
    const code = (res.body as { error?: string } | null)?.error;
    if (code === 'file_type_not_allowed' || code === 'storage_unavailable' || code === 'file_too_large' || code === 'rate_limited') throw new DocsUploadError(code);
    throw new DocsUploadError('failed');
  }
  if (!res.body || typeof (res.body as DocsUploadResult).url !== 'string') throw new DocsUploadError('failed');
  return res.body as DocsUploadResult;
}

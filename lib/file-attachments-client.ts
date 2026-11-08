'use client';
/**
 * Cliente de lib/file-attachments.ts: sube un archivo de cualquier tipo y
 * tamaño a las rutas de adjuntos de un registro y devuelve la fila guardada.
 *
 *   const row = await uploadAttachment<Row>(file, {
 *     uploadUrl: `/api/track/issues/${id}/attachments/upload`,
 *     finalizeUrl: `/api/track/issues/${id}/attachments/finalize`,
 *     onProgress: (loaded, total) => …,
 *     signal: controller.signal,   // cancelar
 *   });
 *
 * Primero pide la config (GET uploadUrl): en modo 'blob' sube directo al store
 * privado de Vercel Blob con upload() (multipart arriba de 8 MB) y después
 * registra el archivo con finalizeUrl; en modo 'local' manda el archivo en el
 * cuerpo de un POST a uploadUrl (XHR, para tener progreso).
 *
 * Errores: AttachmentUploadError con code 'aborted' | 'too_large' |
 * 'storage_not_configured' | 'forbidden' | 'not_found' | 'generic'.
 */

export type AttachmentUploadErrorCode = 'aborted' | 'too_large' | 'storage_not_configured' | 'forbidden' | 'not_found' | 'generic';

export class AttachmentUploadError extends Error {
  constructor(public code: AttachmentUploadErrorCode) {
    super(code);
  }
}

export interface UploadAttachmentOptions {
  uploadUrl: string;
  finalizeUrl: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

interface UploadConfig {
  mode: 'blob' | 'local';
  prefix: string;
  maxBytes: number;
}

const MULTIPART_FROM = 8 * 1024 * 1024;

function codeFor(status: number, body?: { error?: string } | null): AttachmentUploadErrorCode {
  if (body?.error === 'storage_not_configured') return 'storage_not_configured';
  if (status === 413 || body?.error === 'too_large') return 'too_large';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'generic';
}

/** "<uuid>-<nombre seguro>", igual que safeSegment del servidor. */
function segmentFor(name: string): string {
  const clean = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .slice(-120);
  return `${crypto.randomUUID()}-${clean || 'file'}`;
}

async function readJson(res: Response): Promise<{ error?: string } | null> {
  return (await res.json().catch(() => null)) as { error?: string } | null;
}

export async function uploadAttachment<Row>(file: File, o: UploadAttachmentOptions): Promise<Row> {
  if (o.signal?.aborted) throw new AttachmentUploadError('aborted');
  const cfgRes = await fetch(o.uploadUrl, { signal: o.signal, cache: 'no-store' }).catch((err: unknown) => {
    throw new AttachmentUploadError(o.signal?.aborted || (err as Error)?.name === 'AbortError' ? 'aborted' : 'generic');
  });
  const cfg = (await readJson(cfgRes)) as (UploadConfig & { error?: string }) | null;
  if (!cfgRes.ok || !cfg) throw new AttachmentUploadError(codeFor(cfgRes.status, cfg));
  if (file.size > cfg.maxBytes) throw new AttachmentUploadError('too_large');

  if (cfg.mode === 'local') return uploadLocal<Row>(file, o);

  const { upload } = await import('@vercel/blob/client');
  let blob: { pathname: string };
  try {
    blob = await upload(`${cfg.prefix}${segmentFor(file.name || 'file')}`, file, {
      access: 'private',
      handleUploadUrl: o.uploadUrl,
      contentType: file.type || 'application/octet-stream',
      multipart: file.size > MULTIPART_FROM,
      abortSignal: o.signal,
      onUploadProgress: ({ loaded, total }) => o.onProgress?.(loaded, total || file.size),
    });
  } catch (err) {
    if (o.signal?.aborted) throw new AttachmentUploadError('aborted');
    const msg = String((err as Error)?.message ?? '');
    throw new AttachmentUploadError(/too large|maximum/i.test(msg) ? 'too_large' : 'generic');
  }
  const res = await fetch(o.finalizeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pathname: blob.pathname, filename: file.name || 'file' }),
    signal: o.signal,
  }).catch(() => {
    throw new AttachmentUploadError(o.signal?.aborted ? 'aborted' : 'generic');
  });
  const body = await readJson(res);
  if (!res.ok) throw new AttachmentUploadError(codeFor(res.status, body));
  return body as Row;
}

function uploadLocal<Row>(file: File, o: UploadAttachmentOptions): Promise<Row> {
  return new Promise<Row>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const sep = o.uploadUrl.includes('?') ? '&' : '?';
    xhr.open('POST', `${o.uploadUrl}${sep}name=${encodeURIComponent(file.name || 'file')}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => o.onProgress?.(e.loaded, e.lengthComputable ? e.total : file.size);
    const onAbort = () => xhr.abort();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => o.signal?.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      const body = xhr.response as ({ error?: string } & Row) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as Row);
      else reject(new AttachmentUploadError(codeFor(xhr.status, body)));
    };
    xhr.onerror = () => {
      done();
      reject(new AttachmentUploadError('generic'));
    };
    xhr.onabort = () => {
      done();
      reject(new AttachmentUploadError('aborted'));
    };
    xhr.send(file);
  });
}

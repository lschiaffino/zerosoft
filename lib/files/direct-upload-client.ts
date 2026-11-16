'use client';

/**
 * Subida directa de un archivo grande al storage (lib/files/direct-upload.ts):
 * el navegador sube con @vercel/blob/client a la carpeta de subidas en curso y
 * después pide a /api/files/upload/finalize la URL privada de /api/files. Lo
 * que vuelve es lo único que se guarda o se manda.
 *
 * Si el servidor no tiene Blob (self-host), tira DirectUploadUnavailable: quien
 * llama sube por la ruta de su app.
 */

export type DirectPurpose = 'lines-media' | 'inbox-media' | 'inbox-schedule' | 'crm-media' | 'docs' | 'notes' | 'inbox-import' | 'import-zip';

export class DirectUploadUnavailable extends Error {
  constructor() {
    super('client_upload_unavailable');
  }
}

export class DirectUploadFailed extends Error {
  constructor(public code: string) {
    super(code);
  }
}

interface Config {
  mode: 'private' | 'sealed-blob' | 'server';
  access: 'private' | 'public';
  prefix: string;
}

let config: Promise<Config> | null = null;

function uploadConfig(): Promise<Config> {
  config ??= fetch('/api/files/upload', { cache: 'no-store' })
    .then(async (r) => (r.ok ? ((await r.json()) as Config) : { mode: 'server' as const, access: 'public' as const, prefix: '' }))
    .catch(() => ({ mode: 'server' as const, access: 'public' as const, prefix: '' }));
  return config;
}

function safeName(name: string): string {
  return (name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120) || 'file';
}

export interface DirectUploaded {
  url: string;
  size: number;
  mimetype: string;
  name: string;
}

export async function directUpload(
  file: Blob & { name?: string },
  opts: { purpose: DirectPurpose; name?: string; contentType?: string; onProgress?: (fraction: number) => void; abortSignal?: AbortSignal },
): Promise<DirectUploaded> {
  const cfg = await uploadConfig();
  if (cfg.mode === 'server' || !cfg.prefix) throw new DirectUploadUnavailable();
  const name = opts.name ?? file.name ?? 'file';
  const { upload } = await import('@vercel/blob/client');
  const pathname = `${cfg.prefix}${crypto.randomUUID()}-${safeName(name)}`;
  let uploaded: { pathname: string };
  try {
    uploaded = await upload(pathname, file, {
      access: cfg.access,
      handleUploadUrl: '/api/files/upload',
      clientPayload: JSON.stringify({ purpose: opts.purpose }),
      contentType: opts.contentType ?? (file.type || undefined),
      multipart: file.size > 32 * 1024 * 1024,
      abortSignal: opts.abortSignal,
      onUploadProgress: opts.onProgress ? (e) => opts.onProgress!(e.percentage / 100) : undefined,
    });
  } catch (err) {
    if (opts.abortSignal?.aborted) throw new DirectUploadFailed('aborted');
    const msg = err instanceof Error ? err.message : '';
    if (/content type|file_type_not_allowed|not allowed/i.test(msg)) throw new DirectUploadFailed('file_type_not_allowed');
    if (/too large|size/i.test(msg)) throw new DirectUploadFailed('file_too_large');
    throw new DirectUploadFailed('upload_failed');
  }
  const res = await fetch('/api/files/upload/finalize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pathname: uploaded.pathname, purpose: opts.purpose, name }),
    signal: opts.abortSignal,
  }).catch(() => null);
  const data = ((await res?.json().catch(() => null)) ?? {}) as Partial<DirectUploaded> & { error?: string };
  if (!res?.ok || !data.url) throw new DirectUploadFailed(data.error || 'upload_failed');
  return { url: data.url, size: data.size ?? file.size, mimetype: data.mimetype ?? file.type, name: data.name ?? name };
}

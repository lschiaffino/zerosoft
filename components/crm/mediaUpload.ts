'use client';

/**
 * Sube un documento o video del CRM. Con subida directa (Vercel Blob en
 * producción) el archivo va del navegador a Blob y después se registra; sin
 * ella, multipart al servidor (disco local en dev y self-host).
 */
export async function uploadMedia<T>(opts: {
  kind: 'document' | 'video';
  file: Blob;
  filename: string;
  direct: boolean;
  fields: Record<string, string | number | null | undefined>;
}): Promise<{ ok: true; row: T } | { ok: false; code: string }> {
  const endpoint = opts.kind === 'document' ? '/api/crm/documents' : '/api/crm/videos';
  try {
    if (opts.direct) {
      const { upload } = await import('@vercel/blob/client');
      const safe = opts.filename.replace(/[^\w.-]/g, '_').slice(-100) || (opts.kind === 'document' ? 'document.pdf' : 'video.webm');
      const blob = await upload(`crm/${safe}`, opts.file, {
        access: 'public',
        handleUploadUrl: '/api/crm/media/upload',
        clientPayload: opts.kind,
        contentType: opts.file.type || undefined,
      });
      const body =
        opts.kind === 'document'
          ? { name: opts.fields.name ?? '', filename: opts.filename, url: blob.url, size: opts.file.size }
          : {
              title: opts.fields.title ?? '',
              url: blob.url,
              contentType: opts.file.type || 'video/webm',
              size: opts.file.size,
              durationSec: Number(opts.fields.durationSec) || 0,
              contactId: opts.fields.contactId || null,
              message: opts.fields.message ?? '',
            };
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) return { ok: false, code: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic' };
      return { ok: true, row: (await res.json()) as T };
    }
    const form = new FormData();
    form.set('file', opts.file, opts.filename);
    for (const [k, v] of Object.entries(opts.fields)) if (v !== null && v !== undefined) form.set(k, String(v));
    const res = await fetch(endpoint, { method: 'POST', body: form });
    if (!res.ok) return { ok: false, code: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'generic' };
    return { ok: true, row: (await res.json()) as T };
  } catch {
    return { ok: false, code: 'generic' };
  }
}

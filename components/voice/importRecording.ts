'use client';

/**
 * Importar una grabación a una reunión: con Blob, subida directa desde el
 * navegador (el archivo no pasa por la función) y después la transcripción;
 * sin Blob (self-host), el archivo va en un multipart a la ruta.
 */
export async function importRecording(opts: {
  sessionId: string;
  file: File;
  blobPrefix: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response | null;
  if (opts.blobPrefix) {
    try {
      const { upload } = await import('@vercel/blob/client');
      const safe = opts.file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'recording.webm';
      const blob = await upload(`${opts.blobPrefix}${safe}`, opts.file, {
        access: 'public',
        handleUploadUrl: '/api/voice/upload',
        contentType: opts.file.type || 'audio/webm',
        multipart: opts.file.size > 20 * 1024 * 1024,
      });
      res = await fetch(`/api/voice/sessions/${opts.sessionId}/file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: blob.url }),
      }).catch(() => null);
    } catch {
      return { ok: false, error: 'storage_unavailable' };
    }
  } else {
    const form = new FormData();
    form.append('audio', opts.file, opts.file.name);
    res = await fetch(`/api/voice/sessions/${opts.sessionId}/file`, { method: 'POST', body: form }).catch(() => null);
  }
  if (res?.ok) return { ok: true };
  const data = (await res?.json().catch(() => null)) as { error?: string } | null;
  return { ok: false, error: data?.error ?? (res?.status === 413 ? 'audio_too_large' : 'network') };
}

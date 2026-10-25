'use client';

import { patchWebmDuration } from '@/lib/rec-webm';

/**
 * Subida por partes mientras se graba.
 *
 * Los trozos de MediaRecorder se juntan hasta el tamaño de parte (8 MB en
 * Blob, que pide 5 MB mínimo salvo la última; 3 MB al servidor local) y se
 * suben de a una, con reintentos. La parte 1 (la que tiene el header WebM)
 * se guarda hasta el final para escribirle la duración: las partes se pueden
 * subir en cualquier orden porque cada una lleva su número.
 */

type Mode = 'blob' | 'local';

interface BlobUploader {
  uploadPart(n: number, body: Blob): Promise<{ etag: string; partNumber: number }>;
  complete(parts: Array<{ etag: string; partNumber: number }>): Promise<{ url: string }>;
}

async function api<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'upload_failed';
    throw new Error(code);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

async function blobUploader(videoId: string, kind: 'video' | 'audio', contentType: string): Promise<BlobUploader> {
  const { pathname, token, access } = await api<{ pathname: string; token: string; access: 'public' | 'private' }>(`/api/rec/videos/${videoId}/upload-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, contentType }),
  });
  const { createMultipartUploader } = await import('@vercel/blob/client');
  const up = await createMultipartUploader(pathname, { access, token, contentType: contentType.split(';')[0] });
  return {
    uploadPart: (n, body) => up.uploadPart(n, body),
    complete: (parts) => up.complete(parts),
  };
}

export class LiveUpload {
  private buffer: Blob[] = [];
  private buffered = 0;
  private next = 1;
  private first: Blob | null = null;
  private queue: Promise<void> = Promise.resolve();
  private parts: Array<{ etag: string; partNumber: number }> = [];
  private uploader: BlobUploader | null = null;
  private failed: Error | null = null;
  private aborted = false;
  uploadedBytes = 0;
  pushedBytes = 0;

  constructor(
    private videoId: string,
    private mode: Mode,
    private partBytes: number,
    private contentType: string,
  ) {}

  async start(): Promise<void> {
    if (this.mode === 'blob') this.uploader = await blobUploader(this.videoId, 'video', this.contentType);
  }

  get error(): Error | null {
    return this.failed;
  }

  push(data: Blob) {
    if (this.aborted) return;
    this.buffer.push(data);
    this.buffered += data.size;
    this.pushedBytes += data.size;
    while (this.buffered >= this.partBytes) {
      const all = new Blob(this.buffer);
      const part = all.slice(0, this.partBytes);
      const rest = all.slice(this.partBytes);
      this.buffer = rest.size ? [rest] : [];
      this.buffered = rest.size;
      this.cut(part);
    }
  }

  private cut(part: Blob) {
    const n = this.next++;
    if (n === 1) {
      this.first = part;
      return;
    }
    this.enqueue(n, part);
  }

  private enqueue(n: number, part: Blob) {
    this.queue = this.queue.then(async () => {
      if (this.failed || this.aborted) return;
      try {
        await retry(() => this.send(n, part));
        this.uploadedBytes += part.size;
      } catch (err) {
        this.failed = err instanceof Error ? err : new Error('upload_failed');
      }
    });
  }

  private async send(n: number, part: Blob) {
    if (this.mode === 'blob') {
      this.parts.push(await this.uploader!.uploadPart(n, part));
      return;
    }
    await api(`/api/rec/videos/${this.videoId}/parts?kind=video&n=${n}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: part,
    });
  }

  /** Última parte, parte 1 con la duración y cierre. */
  async finish(durationMs: number): Promise<void> {
    const rest = this.buffer.length ? new Blob(this.buffer) : null;
    this.buffer = [];
    this.buffered = 0;
    if (rest?.size) this.cut(rest);
    if (!this.first) throw new Error('empty_recording');
    let first: Blob = this.first;
    if (this.contentType.startsWith('video/webm')) {
      const patched = patchWebmDuration(new Uint8Array(await first.arrayBuffer()), durationMs);
      first = new Blob([patched as Uint8Array<ArrayBuffer>]);
    }
    this.enqueue(1, first);
    await this.queue;
    if (this.failed) throw this.failed;
    const total = this.next - 1;
    if (this.mode === 'blob') {
      const sorted = [...this.parts].sort((a, b) => a.partNumber - b.partNumber);
      const blob = await this.uploader!.complete(sorted);
      await api(`/api/rec/videos/${this.videoId}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', contentType: this.contentType.split(';')[0], url: blob.url, size: this.pushedBytes }),
      });
    } else {
      await api(`/api/rec/videos/${this.videoId}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', contentType: this.contentType.split(';')[0], parts: total }),
      });
    }
  }

  abort() {
    this.aborted = true;
    this.buffer = [];
    this.first = null;
  }
}

/** Sube un archivo entero de un video (el audio para transcribir) por el mismo camino. */
export async function uploadWhole(videoId: string, kind: 'audio', blob: Blob, mode: Mode, partBytes: number): Promise<void> {
  const contentType = blob.type || 'audio/webm';
  if (mode === 'blob') {
    const up = await blobUploader(videoId, kind, contentType);
    const parts: Array<{ etag: string; partNumber: number }> = [];
    let n = 1;
    for (let off = 0; off < blob.size; off += partBytes) {
      const slice = blob.slice(off, off + partBytes);
      const num = n++;
      parts.push(await retry(() => up.uploadPart(num, slice)));
    }
    const done = await up.complete(parts);
    await api(`/api/rec/videos/${videoId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, contentType, url: done.url, size: blob.size }),
    });
    return;
  }
  let n = 0;
  for (let off = 0; off < blob.size; off += partBytes) {
    const slice = blob.slice(off, off + partBytes);
    const num = ++n;
    await retry(() =>
      api(`/api/rec/videos/${videoId}/parts?kind=${kind}&n=${num}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: slice }),
    );
  }
  await api(`/api/rec/videos/${videoId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, contentType, parts: n }),
  });
}

export async function uploadAsset(videoId: string, kind: 'thumb' | 'gif', blob: Blob): Promise<void> {
  const form = new FormData();
  form.set('file', blob, kind === 'gif' ? 'preview.gif' : 'thumb.jpg');
  await api(`/api/rec/videos/${videoId}/asset?kind=${kind}`, { method: 'POST', body: form });
}

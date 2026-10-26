'use client';

import { patchWebmDuration } from '@/lib/rec-webm';
import { extraKey, forget, loadBlob, loadMeta, partKey, recScope, saveBlob, saveMeta, type RecPendingMeta } from './recStore';

/**
 * Subida por partes mientras se graba, a prueba de cortes de red.
 *
 * - Los trozos de MediaRecorder se juntan hasta el tamaño de parte (8 MB en
 *   Blob, que pide 5 MB mínimo salvo la última; 3 MB al servidor local).
 * - Cada parte se guarda primero en IndexedDB (recStore) y recién después se
 *   sube. Si falla, se reintenta sin límite con espera creciente (hasta 30 s)
 *   y apenas el navegador vuelve a estar `online`.
 * - La parte 1 (la del header WebM) se guarda hasta el final para escribirle
 *   la duración: cada parte lleva su número, el orden de subida no importa.
 * - Lo guardado sobrevive a recargar la página: `LiveUpload.resume(id)` sigue
 *   donde quedó (con Blob, la misma subida multipart: key y uploadId quedan en
 *   IndexedDB) y `localRecording` arma el archivo para descargarlo.
 */

type Mode = 'blob' | 'local';
export type UploadState = 'idle' | 'uploading' | 'offline' | 'waiting';
export interface UploadStatus {
  state: UploadState;
  pendingParts: number;
  pendingBytes: number;
  uploadedBytes: number;
  totalBytes: number;
}

class HttpError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

async function api<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'upload_failed';
    throw new HttpError(code, res.status);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Errores que no se arreglan reintentando (el video ya no existe, no hay permiso, el archivo no vale). */
function fatal(err: unknown): boolean {
  return err instanceof HttpError && [400, 401, 403, 404, 413, 415].includes(err.status);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera `ms` o hasta que el navegador vuelva a tener red, lo que pase primero. */
function waitOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener('online', done);
  });
}

async function blobToken(videoId: string, kind: 'video' | 'audio', contentType: string, pathname?: string) {
  return api<{ pathname: string; token: string; access: 'public' | 'private' }>(`/api/rec/videos/${videoId}/upload-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, contentType, pathname }),
  });
}

export class LiveUpload {
  private buffer: Blob[] = [];
  private buffered = 0;
  private queue: number[] = [];
  private pumping: Promise<void> | null = null;
  private fatalError: Error | null = null;
  private aborted = false;
  private state: UploadState = 'idle';
  private listeners = new Set<(s: UploadStatus) => void>();
  private sizes = new Map<number, number>();
  private saving: Promise<unknown> = Promise.resolve();
  uploadedBytes = 0;

  private constructor(private meta: RecPendingMeta) {
    // Que el estado (sin conexión / subiendo) se vea apenas cambia la red, haya o no partes en cola.
    if (typeof window !== 'undefined') {
      const onNet = () => {
        this.emit();
        if (navigator.onLine) this.pump();
      };
      window.addEventListener('online', onNet);
      window.addEventListener('offline', onNet);
    }
  }

  /** Grabación nueva: guarda la ficha en IndexedDB y, con Blob, abre la subida multipart. */
  static async create(info: { videoId: string; shareId: string; title: string; mode: Mode; partBytes: number; contentType: string }): Promise<LiveUpload> {
    const owner = recScope();
    if (!owner) throw new Error('no_scope');
    const meta: RecPendingMeta = { ...info, userId: owner.userId, ws: owner.ws, createdAt: Date.now(), next: 1, uploaded: [], etags: [], done: false, bytes: 0 };
    if (info.mode === 'blob') {
      const { pathname, token, access } = await blobToken(info.videoId, 'video', info.contentType);
      const { createMultipartUpload } = await import('@vercel/blob/client');
      const { key, uploadId } = await createMultipartUpload(pathname, { access, token, contentType: info.contentType.split(';')[0] });
      meta.blob = { pathname, key, uploadId, access };
    }
    await saveMeta(meta).catch(() => undefined);
    return new LiveUpload(meta);
  }

  /** Sigue una grabación guardada en este navegador (después de recargar o de volver la red). */
  static async resume(videoId: string): Promise<LiveUpload | null> {
    const meta = await loadMeta(videoId);
    const owner = recScope();
    // Solo la persona que la grabó (por si quedó una base vieja compartida).
    if (!meta || !owner || meta.userId !== owner.userId || meta.ws !== owner.ws) return null;
    const up = new LiveUpload(meta);
    for (let n = 1; n < meta.next; n++) {
      const b = await loadBlob(partKey(videoId, n));
      if (b) up.sizes.set(n, b.size);
      if (meta.uploaded.includes(n)) up.uploadedBytes += b?.size ?? 0;
      else if (n !== 1 || meta.done) up.queue.push(n);
    }
    return up;
  }

  get videoId() {
    return this.meta.videoId;
  }
  get info(): RecPendingMeta {
    return this.meta;
  }
  get error(): Error | null {
    return this.fatalError;
  }

  onStatus(fn: (s: UploadStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status());
    return () => this.listeners.delete(fn);
  }

  status(): UploadStatus {
    let pendingBytes = 0;
    for (const n of this.queue) pendingBytes += this.sizes.get(n) ?? 0;
    pendingBytes += this.buffered;
    const totalBytes = [...this.sizes.values()].reduce((s, x) => s + x, 0) + this.buffered;
    const state: UploadState = typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : this.state === 'offline' ? 'uploading' : this.state;
    return { state, pendingParts: this.queue.length, pendingBytes, uploadedBytes: this.uploadedBytes, totalBytes };
  }

  private emit(state?: UploadState) {
    if (state) this.state = state;
    const s = this.status();
    for (const fn of this.listeners) fn(s);
  }

  push(data: Blob) {
    if (this.aborted) return;
    this.buffer.push(data);
    this.buffered += data.size;
    while (this.buffered >= this.meta.partBytes) {
      const all = new Blob(this.buffer);
      const part = all.slice(0, this.meta.partBytes);
      const rest = all.slice(this.meta.partBytes);
      this.buffer = rest.size ? [rest] : [];
      this.buffered = rest.size;
      this.cut(part);
    }
    this.emit();
  }

  private cut(part: Blob) {
    const n = this.meta.next++;
    this.meta.bytes += part.size;
    this.sizes.set(n, part.size);
    const meta = { ...this.meta };
    // Primero a IndexedDB; recién después a la cola (si se cae la red, la parte no se pierde).
    this.saving = this.saving.then(() => saveBlob(partKey(this.meta.videoId, n), part).then(() => saveMeta(meta)).catch(() => undefined));
    if (n === 1) return;
    void this.saving.then(() => this.enqueue(n));
  }

  private enqueue(n: number) {
    if (!this.queue.includes(n) && !this.meta.uploaded.includes(n)) this.queue.push(n);
    this.pump();
  }

  private pump() {
    if (this.pumping || this.aborted) return;
    this.pumping = (async () => {
      // Primero ceder: si la cola está vacía, el `pumping = null` del final no puede
      // correr antes de que se asigne esta promesa (si no, quedaba "ocupado" para siempre).
      await Promise.resolve();
      let delay = 1000;
      while (this.queue.length && !this.aborted && !this.fatalError) {
        const n = this.queue[0];
        if (!navigator.onLine) {
          this.emit('offline');
          await waitOnline(30_000);
          continue;
        }
        this.emit('uploading');
        try {
          await this.send(n);
          this.queue.shift();
          this.meta.uploaded.push(n);
          this.uploadedBytes += this.sizes.get(n) ?? 0;
          await saveMeta(this.meta).catch(() => undefined);
          delay = 1000;
        } catch (err) {
          if (fatal(err)) {
            this.fatalError = err instanceof Error ? err : new Error('upload_failed');
            break;
          }
          this.emit(navigator.onLine ? 'waiting' : 'offline');
          await waitOnline(delay);
          delay = Math.min(30_000, delay * 2);
        }
      }
      this.pumping = null;
      this.emit(this.queue.length ? this.state : 'idle');
    })();
  }

  private async send(n: number) {
    const body = await loadBlob(partKey(this.meta.videoId, n));
    if (!body) throw new HttpError('part_missing', 400);
    if (this.meta.mode === 'blob' && this.meta.blob) {
      const { uploadPart } = await import('@vercel/blob/client');
      const { pathname, key, uploadId, access } = this.meta.blob;
      const { token } = await blobToken(this.meta.videoId, 'video', this.meta.contentType, pathname);
      const part = await uploadPart(pathname, body, { access, token, key, uploadId, partNumber: n });
      this.meta.etags = [...this.meta.etags.filter((e) => e.partNumber !== n), part];
      return;
    }
    await api(`/api/rec/videos/${this.meta.videoId}/parts?kind=video&n=${n}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
  }

  /** Corta la grabación: última parte, parte 1 con la duración y los extras, todo guardado en el navegador. */
  async seal(r: { durationMs: number; width: number; height: number; audio: Blob | null; thumb: Blob | null; gif: Blob | null }): Promise<void> {
    if (!this.meta.done) {
      const rest = this.buffer.length ? new Blob(this.buffer) : null;
      this.buffer = [];
      this.buffered = 0;
      if (rest?.size) this.cut(rest);
      await this.saving;
      let first = await loadBlob(partKey(this.meta.videoId, 1));
      if (!first) throw new Error('empty_recording');
      if (this.meta.contentType.startsWith('video/webm')) {
        first = new Blob([patchWebmDuration(new Uint8Array(await first.arrayBuffer()), r.durationMs) as Uint8Array<ArrayBuffer>]);
        await saveBlob(partKey(this.meta.videoId, 1), first);
        this.sizes.set(1, first.size);
      }
      if (r.audio) await saveBlob(extraKey(this.meta.videoId, 'audio'), r.audio).catch(() => undefined);
      if (r.thumb) await saveBlob(extraKey(this.meta.videoId, 'thumb'), r.thumb).catch(() => undefined);
      if (r.gif) await saveBlob(extraKey(this.meta.videoId, 'gif'), r.gif).catch(() => undefined);
      Object.assign(this.meta, { done: true, durationMs: r.durationMs, width: r.width, height: r.height });
      await saveMeta(this.meta).catch(() => undefined);
    }
    this.enqueue(1);
  }

  /** Espera a que suba todo lo pendiente (reintentando sin límite) y cierra el archivo en el servidor. */
  async drainAndClose(): Promise<void> {
    if (!this.meta.done) throw new Error('not_sealed');
    for (let n = 1; n < this.meta.next; n++) if (!this.meta.uploaded.includes(n) && !this.queue.includes(n)) this.queue.push(n);
    this.pump();
    while (this.pumping || this.queue.length) {
      if (this.fatalError) throw this.fatalError;
      if (!this.pumping) this.pump();
      await (this.pumping ?? sleep(200));
      await sleep(0);
    }
    if (this.fatalError) throw this.fatalError;
    const total = this.meta.next - 1;
    const contentType = this.meta.contentType.split(';')[0];
    let delay = 1000;
    for (;;) {
      try {
        if (this.meta.mode === 'blob' && this.meta.blob) {
          const { completeMultipartUpload } = await import('@vercel/blob/client');
          const { pathname, key, uploadId, access } = this.meta.blob;
          const { token } = await blobToken(this.meta.videoId, 'video', this.meta.contentType, pathname);
          const parts = [...this.meta.etags].sort((a, b) => a.partNumber - b.partNumber);
          const blob = await completeMultipartUpload(pathname, parts, { access, token, key, uploadId, contentType });
          await api(`/api/rec/videos/${this.meta.videoId}/complete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'video', contentType, url: blob.url, size: this.meta.bytes }),
          });
        } else {
          await api(`/api/rec/videos/${this.meta.videoId}/complete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'video', contentType, parts: total }),
          });
        }
        return;
      } catch (err) {
        if (err instanceof HttpError && err.code === 'already_uploaded') return;
        if (fatal(err)) throw err;
        this.emit(navigator.onLine ? 'waiting' : 'offline');
        await waitOnline(delay);
        delay = Math.min(30_000, delay * 2);
      }
    }
  }

  abort() {
    this.aborted = true;
    this.buffer = [];
    this.queue = [];
    void forget(this.meta.videoId);
  }
}

/**
 * Cierra una grabación guardada: sube lo pendiente, el audio (para la
 * transcripción), la miniatura y el GIF, termina el video y la borra del
 * navegador. Sirve recién grabada o recuperada después de recargar.
 */
export async function finishRecording(up: LiveUpload, onStatus?: (s: UploadStatus) => void): Promise<void> {
  const off = onStatus ? up.onStatus(onStatus) : () => undefined;
  try {
    await up.drainAndClose();
    const m = up.info;
    const audio = await loadBlob(extraKey(m.videoId, 'audio')).catch(() => undefined);
    if (audio) await retryForever(() => uploadWhole(m.videoId, 'audio', audio, m.mode, m.partBytes)).catch(() => undefined);
    const thumb = await loadBlob(extraKey(m.videoId, 'thumb')).catch(() => undefined);
    // El grabador toma la miniatura cerca del segundo 1 y el GIF de los primeros segundos.
    if (thumb) await retryForever(() => uploadAsset(m.videoId, 'thumb', thumb, { forTrim: '0:', atSec: 1 })).catch(() => undefined);
    const gif = await loadBlob(extraKey(m.videoId, 'gif')).catch(() => undefined);
    if (gif) await retryForever(() => uploadAsset(m.videoId, 'gif', gif, { forTrim: '0:' })).catch(() => undefined);
    await retryForever(() =>
      api(`/api/rec/videos/${m.videoId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationSec: Math.round((m.durationMs ?? 0) / 100) / 10, width: m.width ?? 0, height: m.height ?? 0 }),
      }),
    );
    await forget(m.videoId);
  } finally {
    off();
  }
}

/** Reintenta lo que falle por red (no los errores definitivos) hasta que salga. */
async function retryForever<T>(fn: () => Promise<T>): Promise<T> {
  let delay = 1000;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (fatal(err) || (err instanceof HttpError && err.code === 'already_uploaded')) throw err;
      await waitOnline(delay);
      delay = Math.min(30_000, delay * 2);
    }
  }
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (fatal(err)) break;
      await sleep(500 * 2 ** i);
    }
  }
  throw last;
}

/** Sube un archivo entero de un video (el audio, la copia recortada o un video que ya tenías) por el mismo camino. */
export async function uploadWhole(
  videoId: string,
  kind: 'audio' | 'video' | 'trimmed',
  blob: Blob,
  mode: Mode,
  partBytes: number,
  extra: Record<string, unknown> = {},
  onProgress?: (pct: number) => void,
): Promise<void> {
  const contentType = blob.type || (kind === 'audio' ? 'audio/webm' : 'video/webm');
  const count = Math.max(1, Math.ceil(blob.size / partBytes));
  if (mode === 'blob') {
    const tokenKind = kind === 'audio' ? 'audio' : 'video';
    const first = await blobToken(videoId, tokenKind, contentType);
    const { createMultipartUpload, uploadPart, completeMultipartUpload } = await import('@vercel/blob/client');
    const { key, uploadId } = await createMultipartUpload(first.pathname, { access: first.access, token: first.token, contentType });
    const parts: Array<{ etag: string; partNumber: number }> = [];
    for (let i = 0; i < count; i++) {
      const slice = blob.slice(i * partBytes, (i + 1) * partBytes);
      parts.push(
        await retry(async () => {
          const { token } = await blobToken(videoId, tokenKind, contentType, first.pathname);
          return uploadPart(first.pathname, slice, { access: first.access, token, key, uploadId, partNumber: i + 1 });
        }),
      );
      onProgress?.(Math.round(((i + 1) / count) * 100));
    }
    const { token } = await blobToken(videoId, tokenKind, contentType, first.pathname);
    const done = await completeMultipartUpload(first.pathname, parts, { access: first.access, token, key, uploadId, contentType });
    await api(`/api/rec/videos/${videoId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, contentType, url: done.url, size: blob.size, ...extra }),
    });
    return;
  }
  for (let i = 0; i < count; i++) {
    const slice = blob.slice(i * partBytes, (i + 1) * partBytes);
    await retry(() =>
      api(`/api/rec/videos/${videoId}/parts?kind=${kind}&n=${i + 1}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: slice }),
    );
    onProgress?.(Math.round(((i + 1) / count) * 100));
  }
  await api(`/api/rec/videos/${videoId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, contentType, parts: count, ...extra }),
  });
}

/**
 * Miniatura o GIF. `forTrim`: para qué recorte se armó ("0:" = el video
 * entero); `atSec`: segundo del original de donde sale la miniatura. Con eso
 * el servidor sabe si se le puede mostrar a quien no administra el video.
 */
export async function uploadAsset(videoId: string, kind: 'thumb' | 'gif', blob: Blob, opts: { forTrim?: string; atSec?: number } = {}): Promise<void> {
  const form = new FormData();
  form.set('file', blob, kind === 'gif' ? 'preview.gif' : 'thumb.jpg');
  const q = new URLSearchParams({ kind });
  if (opts.forTrim !== undefined) q.set('for', opts.forTrim);
  if (opts.atSec !== undefined) q.set('at', String(Math.round(opts.atSec * 10) / 10));
  await api(`/api/rec/videos/${videoId}/asset?${q}`, { method: 'POST', body: form });
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Un archivo esperando para mandarse: se sube enseguida (con progreso) y se manda con el mensaje. */
export interface TrayItem {
  key: string;
  file: File;
  name: string;
  type: string;
  size: number;
  /** Vista previa local (imágenes y videos). */
  preview: string;
  progress: number;
  status: 'uploading' | 'ready' | 'error';
  url?: string;
  error?: string;
  uploaded?: UploadedFile;
  /** Comentario de este archivo (como en WhatsApp, uno por archivo). */
  caption?: string;
}

/** Hasta cuántos archivos van juntos (como WhatsApp, que deja 30). */
export const MAX_TRAY = 30;

let seq = 0;

/** Lo que devuelve la subida: lo que se manda como media. */
export interface UploadedFile {
  url: string;
  mimetype: string;
  filename: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}

/** Hasta este tamaño va por la ruta común; más grande, directo a Blob desde el navegador. */
export const SMALL_UPLOAD = 4.5 * 1024 * 1024;
export const MAX_FILE = 100 * 1024 * 1024;

function uploadSmall(file: File, onProgress: (p: number) => void): { done: Promise<UploadedFile>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<UploadedFile>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.open('POST', '/api/groups/upload');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: Partial<UploadedFile> & { error?: string; files?: UploadedFile[]; errors?: Array<{ error: string }> } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Respuesta sin JSON: error genérico.
      }
      const f = data.files?.[0] ?? (data.url ? (data as UploadedFile) : null);
      if (xhr.status >= 200 && xhr.status < 300 && f?.url) resolve({ ...f, mimetype: f.mimetype || file.type, filename: f.filename || file.name, size: f.size || file.size });
      else reject(new Error(data.errors?.[0]?.error || data.error || 'upload_failed'));
    };
    xhr.onerror = () => reject(new Error('upload_failed'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(form);
  });
  return { done, abort: () => xhr.abort() };
}

/** Archivo grande: sube directo a Blob (con progreso); si el servidor no lo permite, por la ruta común. */
function uploadLarge(file: File, onProgress: (p: number) => void): { done: Promise<UploadedFile>; abort: () => void } {
  const ctrl = new AbortController();
  let fallback: { abort: () => void } | null = null;
  const done = (async () => {
    const { upload } = await import('@vercel/blob/client');
    const safe = (file.name || 'file').replace(/[^\w.-]+/g, '_').slice(-120);
    try {
      const blob = await upload(`chat/${crypto.randomUUID()}-${safe}`, file, {
        access: 'public',
        handleUploadUrl: '/api/groups/upload/blob',
        abortSignal: ctrl.signal,
        onUploadProgress: (e) => onProgress(e.percentage / 100),
      });
      return { url: blob.url, mimetype: file.type || 'application/octet-stream', filename: file.name, size: file.size };
    } catch (err) {
      if (ctrl.signal.aborted) throw new Error('aborted');
      const msg = String((err as Error)?.message ?? '');
      if (/client_upload_unavailable|501/.test(msg)) {
        // Sin Blob en el servidor: hasta 4,5 MB por la ruta común; más, un aviso claro.
        if (file.size > SMALL_UPLOAD) throw new Error('file_too_large_local');
        const small = uploadSmall(file, onProgress);
        fallback = small;
        return small.done;
      }
      throw new Error(/too large|size/i.test(msg) ? 'file_too_large' : 'upload_failed');
    }
  })();
  return { done, abort: () => (ctrl.abort(), fallback?.abort()) };
}

function uploadWithProgress(file: File, onProgress: (p: number) => void) {
  if (file.size > MAX_FILE) return { done: Promise.reject(new Error('file_too_large')), abort: () => {} };
  return file.size > SMALL_UPLOAD ? uploadLarge(file, onProgress) : uploadSmall(file, onProgress);
}

/**
 * Bandeja de adjuntos del composer: agregar (botón, arrastrar o pegar),
 * subir con progreso, reintentar, quitar. Las vistas previas locales se
 * liberan al sacar el archivo o al salir.
 */
export function useAttachTray() {
  const [items, setItems] = useState<TrayItem[]>([]);
  const aborts = useRef(new Map<string, () => void>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = useCallback((key: string, p: Partial<TrayItem>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it))), []);

  const start = useCallback(
    (it: TrayItem) => {
      const up = uploadWithProgress(it.file, (p) => patch(it.key, { progress: p }));
      aborts.current.set(it.key, up.abort);
      up.done
        .then((r) => patch(it.key, { status: 'ready', progress: 1, url: r.url, type: r.mimetype || it.type, name: r.filename || it.name, uploaded: r }))
        .catch((err: Error) => err.message !== 'aborted' && patch(it.key, { status: 'error', error: err.message }))
        .finally(() => aborts.current.delete(it.key));
    },
    [patch],
  );

  const add = useCallback(
    (files: File[]) => {
      const room = MAX_TRAY - itemsRef.current.length;
      const next = files.slice(0, Math.max(0, room)).map<TrayItem>((file) => ({
        key: `a${++seq}`,
        file,
        name: file.name || 'file',
        type: file.type || 'application/octet-stream',
        size: file.size,
        preview: /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : '',
        progress: 0,
        status: 'uploading',
      }));
      if (next.length === 0) return;
      setItems((list) => [...list, ...next]);
      next.forEach(start);
    },
    [start],
  );

  const retry = useCallback(
    (key: string) => {
      const it = itemsRef.current.find((x) => x.key === key);
      if (!it) return;
      patch(key, { status: 'uploading', progress: 0, error: undefined });
      start({ ...it, status: 'uploading', progress: 0 });
    },
    [patch, start],
  );

  const remove = useCallback((key: string) => {
    aborts.current.get(key)?.();
    setItems((list) => {
      const it = list.find((x) => x.key === key);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      return list.filter((x) => x.key !== key);
    });
  }, []);

  const setCaption = useCallback((key: string, caption: string) => patch(key, { caption }), [patch]);

  const clear = useCallback(() => {
    aborts.current.forEach((a) => a());
    setItems((list) => {
      list.forEach((it) => it.preview && URL.revokeObjectURL(it.preview));
      return [];
    });
  }, []);

  useEffect(
    () => () => {
      aborts.current.forEach((a) => a());
      itemsRef.current.forEach((it) => it.preview && URL.revokeObjectURL(it.preview));
    },
    [],
  );

  return { items, add, retry, remove, clear, setCaption };
}

/** Archivos de un evento de arrastre o de pegado. */
export function filesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  if (dt.files && dt.files.length) return [...dt.files];
  return [...(dt.items ?? [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => Boolean(f));
}

export function hasFiles(dt: DataTransfer | null): boolean {
  return Boolean(dt && [...(dt.types ?? [])].includes('Files'));
}

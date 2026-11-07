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
}

/** Hasta cuántos archivos van juntos (como WhatsApp, que deja 30). */
export const MAX_TRAY = 30;

let seq = 0;

function uploadWithProgress(file: File, onProgress: (p: number) => void): { done: Promise<{ url: string; mimetype: string; filename: string }>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<{ url: string; mimetype: string; filename: string }>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.open('POST', '/api/groups/upload');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { url?: string; mimetype?: string; filename?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Respuesta sin JSON: error genérico.
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.url) resolve({ url: data.url, mimetype: data.mimetype || file.type, filename: data.filename || file.name });
      else reject(new Error(data.error || 'upload_failed'));
    };
    xhr.onerror = () => reject(new Error('upload_failed'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(form);
  });
  return { done, abort: () => xhr.abort() };
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
        .then((r) => patch(it.key, { status: 'ready', progress: 1, url: r.url, type: r.mimetype || it.type, name: r.filename || it.name }))
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

  return { items, add, retry, remove, clear };
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

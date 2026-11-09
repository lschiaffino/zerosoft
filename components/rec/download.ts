'use client';

import { saveFile } from './recStore';

/**
 * Leer un video servido por partes: la ruta responde hasta 4 MB por pedido
 * (las Vercel Functions cortan en 4,5 MB), así que se piden los rangos en
 * orden y se arma el archivo en el navegador.
 */
export async function fetchInParts(url: string, onProgress?: (pct: number) => void, onPreparing?: () => void): Promise<{ blob: Blob; name: string | null }> {
  const parts: Blob[] = [];
  let start = 0;
  let total = Infinity;
  let name: string | null = null;
  let type = '';
  // La descarga en MP4 se arma la primera vez: la ruta responde 202 hasta que está (hasta 20 minutos).
  const until = Date.now() + 20 * 60_000;
  while (start < total) {
    const res = await fetch(url, { headers: { range: `bytes=${start}-` } });
    if (res.status === 202 && start === 0) {
      if (Date.now() > until) throw new Error('download_failed');
      onPreparing?.();
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!res.ok) throw new Error(res.status === 403 ? 'download_disabled' : 'download_failed');
    const disp = res.headers.get('content-disposition') ?? '';
    const m = /filename\*=UTF-8''([^;]+)/.exec(disp) ?? /filename="([^"]+)"/.exec(disp);
    if (m) name = decodeURIComponent(m[1]);
    type = res.headers.get('content-type') ?? type;
    const body = await res.blob();
    if (res.status === 200) {
      parts.splice(0, parts.length, body);
      break;
    }
    const cr = /bytes (\d+)-(\d+)\/(\d+)/.exec(res.headers.get('content-range') ?? '');
    if (!cr) throw new Error('download_failed');
    parts.push(body);
    total = Number(cr[3]);
    start = Number(cr[2]) + 1;
    onProgress?.(Math.round((start / total) * 100));
  }
  return { blob: new Blob(parts, { type: type || 'video/webm' }), name };
}

/** Descargar: arma el archivo de a partes y lo guarda. */
export async function downloadInParts(url: string, fallbackName = 'video.mp4', onProgress?: (pct: number) => void, onPreparing?: () => void): Promise<void> {
  const { blob, name } = await fetchInParts(url, onProgress, onPreparing);
  saveFile(blob, name ?? fallbackName);
}

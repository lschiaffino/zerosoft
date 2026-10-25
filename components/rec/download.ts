'use client';

import { saveFile } from './recStore';

/**
 * Leer un video servido por partes: la ruta responde hasta 4 MB por pedido
 * (las Vercel Functions cortan en 4,5 MB), así que se piden los rangos en
 * orden y se arma el archivo en el navegador.
 */
export async function fetchInParts(url: string, onProgress?: (pct: number) => void): Promise<{ blob: Blob; name: string | null }> {
  const parts: Blob[] = [];
  let start = 0;
  let total = Infinity;
  let name: string | null = null;
  let type = '';
  while (start < total) {
    const res = await fetch(url, { headers: { range: `bytes=${start}-` } });
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
export async function downloadInParts(url: string, fallbackName = 'video.webm', onProgress?: (pct: number) => void): Promise<void> {
  const { blob, name } = await fetchInParts(url, onProgress);
  saveFile(blob, name ?? fallbackName);
}

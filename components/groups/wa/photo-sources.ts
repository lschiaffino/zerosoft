/**
 * Las versiones de la foto que usa el editor (components/groups/wa/ImageEditor.tsx) y el envío
 * (AttachPreview): la foto con su filtro de color, a un tamaño dado, y una copia desenfocada para
 * el pincel de desenfoque. Solo en el navegador (canvas).
 */
import { FILTER_MATRIX, applyColorMatrix, type FilterId } from '@/lib/wa-image-filters';

type Source = CanvasImageSource & { width: number; height: number };

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * La foto con el filtro, con el lado largo hasta `maxSide` px (nunca más grande que la original).
 * Sin filtro devuelve la foto tal cual (se dibuja escalada donde haga falta).
 */
export function filteredPhoto(photo: CanvasImageSource, natural: { w: number; h: number }, filter: FilterId | undefined, maxSide: number): CanvasImageSource {
  const m = FILTER_MATRIX[filter ?? 'none'];
  if (!m) return photo;
  const k = Math.min(1, maxSide / Math.max(natural.w, natural.h));
  const c = canvasOf(natural.w * k, natural.h * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return photo;
  ctx.drawImage(photo, 0, 0, c.width, c.height);
  try {
    const px = ctx.getImageData(0, 0, c.width, c.height);
    applyColorMatrix(px.data, m);
    ctx.putImageData(px, 0, 0);
  } catch {
    // Un canvas "sucio" (no debería: la foto es local) queda sin filtro.
    return photo;
  }
  return c;
}

/**
 * Copia desenfocada (fuerte, para tapar caras o datos): achicada a unos 28 px de lado largo y
 * agrandada de nuevo con suavizado, en dos pasos para que no se vean bloques.
 */
export function blurredPhoto(photo: CanvasImageSource, natural: { w: number; h: number }): Source | null {
  const long = Math.max(natural.w, natural.h);
  const tiny = canvasOf((natural.w * 28) / long, (natural.h * 28) / long);
  const mid = canvasOf((natural.w * 220) / long, (natural.h * 220) / long);
  const a = tiny.getContext('2d');
  const b = mid.getContext('2d');
  if (!a || !b) return null;
  a.imageSmoothingQuality = 'high';
  a.drawImage(photo, 0, 0, tiny.width, tiny.height);
  b.imageSmoothingQuality = 'high';
  b.drawImage(tiny, 0, 0, mid.width, mid.height);
  return mid;
}

/** Miniatura cuadrada de un filtro (la foto recortada al centro). */
export function filterThumb(photo: CanvasImageSource, natural: { w: number; h: number }, filter: FilterId, size: number): string {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  const side = Math.min(natural.w, natural.h);
  ctx.drawImage(photo, (natural.w - side) / 2, (natural.h - side) / 2, side, side, 0, 0, size, size);
  const m = FILTER_MATRIX[filter];
  if (m) {
    try {
      const px = ctx.getImageData(0, 0, size, size);
      applyColorMatrix(px.data, m);
      ctx.putImageData(px, 0, 0);
    } catch {
      // Sin filtro en la miniatura.
    }
  }
  return c.toDataURL('image/jpeg', 0.8);
}

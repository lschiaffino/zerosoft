'use client';

import { DESIGN_MAX_UPLOAD_BYTES } from '@/lib/design-image';

const LIMIT = DESIGN_MAX_UPLOAD_BYTES - 64 * 1024;

/**
 * Las funciones de Vercel no aceptan cuerpos de más de 4.5 MB: una foto
 * grande se achica en el navegador (lado máximo 4096 px y, si hace falta,
 * menos) antes de subirla. PNG sigue en PNG (puede tener transparencia); JPEG
 * y WebP pasan a JPEG. Un GIF no se toca (puede ser animado).
 */
export async function shrinkForUpload(file: File): Promise<File> {
  if (file.size <= LIMIT || !/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  let scale = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
  for (let i = 0; i < 6; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.88));
    if (blob && blob.size <= LIMIT) {
      bmp.close();
      return new File([blob], `${base}.${type === 'image/png' ? 'png' : 'jpg'}`, { type });
    }
    scale *= 0.75;
  }
  bmp.close();
  return file;
}

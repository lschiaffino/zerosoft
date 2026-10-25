import { COVER_COLOR_PREFIX, isDocsUploadUrl, pageImageHref } from './docs-files';

/**
 * Portadas de página: imagen subida (storage de Docs, servida por
 * /api/docs/files/<página>/cover), link a una imagen, o un color/degradé de
 * la galería ("color:<clave>", los colores salen de styles/docs.css).
 */

export const COVER_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray', 'sunset', 'ocean', 'forest', 'dusk'] as const;

/** Fotos de la galería (Unsplash, libres de uso). */
export const COVER_PHOTOS = [
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1600&q=80',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1600&q=80',
  'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1600&q=80',
  'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1600&q=80',
];

export function coverColorKey(value: string | null | undefined): string | null {
  if (!value?.startsWith(COVER_COLOR_PREFIX)) return null;
  const key = value.slice(COVER_COLOR_PREFIX.length);
  return (COVER_COLORS as readonly string[]).includes(key) ? key : null;
}

/** src de una portada de imagen (null si es un color o no es una URL válida). */
export function coverImageSrc(pageId: string, value: string): string | null {
  if (coverColorKey(value)) return null;
  if (isDocsUploadUrl(value)) return pageImageHref(pageId, 'cover', value);
  return /^https?:\/\//i.test(value) ? value : null;
}

/** Valor de portada aceptable (lo que se guarda en cover_url). */
export function isValidCover(value: string): boolean {
  return Boolean(coverColorKey(value) || isDocsUploadUrl(value) || /^https?:\/\/\S+$/i.test(value));
}

import { hashString } from './art';

/**
 * URLs de las tarjetas para compartir. Cada una lleva `?v=<hash>`: el hash
 * sale de la versión del diseño y del contenido de la página (título,
 * descripción), así la imagen se sirve como inmutable y cambia de URL cuando
 * cambia lo que muestra. `f=sq` pide la versión cuadrada (1200×1200).
 *
 * Subir OG_VERSION cuando cambia el diseño: todas las URLs se renuevan y
 * WhatsApp, Slack y LinkedIn vuelven a pedir la imagen.
 */
export const OG_VERSION = '3';

export const OG_WIDE = { width: 1200, height: 630 } as const;
export const OG_SQUARE = { width: 1200, height: 1200 } as const;

/** Hash corto (base 36) del diseño y el contenido. */
export function ogHash(parts: readonly unknown[]): string {
  return hashString(`${OG_VERSION}\u0000${JSON.stringify(parts)}`).toString(36);
}

/** "/api/og/product/crm/es" + contenido → "/api/og/product/crm/es?v=1x2y3z". */
export function ogUrl(path: string, parts: readonly unknown[] = [], square = false): string {
  if (/^https?:\/\//.test(path) || !path.startsWith('/api/og/')) return path;
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('v', ogHash([base, ...parts]));
  if (square) params.set('f', 'sq');
  else params.delete('f');
  return `${base}?${params.toString()}`;
}

/** ¿Es una de nuestras tarjetas (y no una imagen propia, como la foto de un producto de Shop)? */
export function isOgCard(url: string): boolean {
  return /(^|\/\/[^/]+)\/api\/og\//.test(url);
}

export interface OgImageMeta {
  url: string;
  width: number;
  height: number;
  alt: string;
  type: 'image/png';
}

/**
 * Las dos imágenes de una página para og:image: primero la ancha (la que
 * usan X, LinkedIn, Slack, Facebook) y después la cuadrada (el recorte de
 * WhatsApp y los chats que muestran miniatura).
 */
export function ogImages(path: string, alt: string, parts: readonly unknown[] = []): OgImageMeta[] {
  return [
    { url: ogUrl(path, parts), ...OG_WIDE, alt, type: 'image/png' },
    { url: ogUrl(path, parts, true), ...OG_SQUARE, alt, type: 'image/png' },
  ];
}

/**
 * openGraph.images + twitter de una página que no usa pageMetadata (contenido
 * de un workspace). `card` es summary_large_image siempre: la tarjeta tiene
 * el título adentro.
 */
export function ogMeta(path: string, title: string, description: string | undefined, parts: readonly unknown[] = []) {
  const images = ogImages(path, title, parts);
  return {
    images,
    twitter: { card: 'summary_large_image' as const, title, ...(description ? { description } : {}), images: [{ url: images[0].url, alt: title }] },
  };
}

/** Las mismas URLs, absolutas (páginas fuera del layout del sitio, sin metadataBase). */
export function ogMetaAbsolute(base: string, ...args: Parameters<typeof ogMeta>) {
  const og = ogMeta(...args);
  const abs = (u: string) => `${base.replace(/\/$/, '')}${u}`;
  return {
    images: og.images.map((i) => ({ ...i, url: abs(i.url) })),
    twitter: { ...og.twitter, images: og.twitter.images.map((i) => ({ ...i, url: abs(i.url) })) },
  };
}

/**
 * Tamaño de una foto o un video en la burbuja (Inbox y Lines), como en
 * WhatsApp: hasta el ancho de media (300 por defecto, --wa-media-w en
 * Visualización), con la proporción real recortada entre 3:4 (las de
 * teléfono, altas) y 2,4:1 (las panorámicas). Una foto de teléfono ocupa el
 * ancho entero y el texto de abajo se lee en renglones normales.
 *
 * El mismo cálculo da el lugar de la media que todavía no cargó o no está
 * disponible: con medidas, el de la foto; sin medidas, un lugar estándar.
 * Así la burbuja nunca queda del ancho de un texto corto.
 */

/** Ancho de referencia (el de --wa-media-w por defecto). */
export const MEDIA_W = 300;
/** La más angosta que se dibuja (como .wa-image img min-width). */
export const MEDIA_MIN_W = 100;
/** Lugar estándar sin medidas: el ancho entero en 4:3. */
export const PLACEHOLDER_BOX = { width: MEDIA_W, height: 225 } as const;

const MIN_RATIO = 0.75;
const MAX_RATIO = 2.4;

export interface MediaBox {
  width: number;
  height: number;
}

/**
 * Caja de la foto desde su ancho y alto reales; null sin medidas. Con texto
 * abajo (`caption`) la caja ocupa siempre el ancho entero, como WhatsApp: una
 * foto angosta o chica no deja la burbuja angosta con el texto cortado cada
 * dos o tres palabras; la foto se recorta al centro (o, si es muy chica, se
 * centra sin agrandarla, ver mediaFit).
 */
export function mediaBox(width?: number, height?: number, opts: { caption?: boolean } = {}): MediaBox | null {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return null;
  const boxW = opts.caption ? MEDIA_W : Math.round(Math.max(MEDIA_MIN_W, Math.min(MEDIA_W, w)));
  const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, w / h));
  return { width: boxW, height: Math.round(boxW / ratio) };
}

/**
 * Cómo se dibuja la foto en su caja: recortada al centro (cover) salvo una
 * muy chica con texto, que queda centrada sobre el fondo sin agrandarse
 * (contain), como WhatsApp.
 */
export function mediaFit(width?: number, height?: number, caption = false): 'cover' | 'contain' {
  const w = Number(width) || 0;
  return caption && w > 0 && Number(height) > 0 && w < MEDIA_W / 2 ? 'contain' : 'cover';
}

/**
 * El lugar de una media que no cargó (o no se pudo bajar): el ancho de la foto si se saben las medidas, si no el
 * estándar. Con la miniatura de WhatsApp de fondo lleva la proporción de la foto; sin ella no pasa de 4:3 de alto
 * (una foto vertical no deja un cuadro gris enorme).
 */
export function placeholderBox(width?: number, height?: number, withThumb = false): MediaBox {
  const box = mediaBox(width, height);
  if (!box) return { ...PLACEHOLDER_BOX };
  return withThumb ? box : { width: box.width, height: Math.min(box.height, Math.round(box.width * 0.75)) };
}

/**
 * Estilo de la caja: el ancho en proporción a --wa-media-w (Visualización lo
 * cambia a chico o grande) y la proporción de la caja.
 */
export function mediaBoxStyle(box: MediaBox | null): { width: string; aspectRatio: string } | undefined {
  return box ? { width: `calc(var(--wa-media-w, ${MEDIA_W}px) * ${+(box.width / MEDIA_W).toFixed(4)})`, aspectRatio: `${box.width} / ${box.height}` } : undefined;
}

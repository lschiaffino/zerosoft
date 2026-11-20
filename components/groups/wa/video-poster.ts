/**
 * La portada de un video en la burbuja (Inbox y Lines), como en WhatsApp: el
 * primer cuadro del video, nítido, del tamaño real del video. La miniatura que
 * manda WhatsApp (un JPEG chiquito) queda solo de lugar, borrosa, hasta que el
 * navegador dibuja el cuadro.
 */
import { mediaBox, placeholderBox, type MediaBox } from './media-box';

export type PosterState = 'frame' | 'thumb' | 'none';

/**
 * Caja del video: con las medidas del mensaje, o las que leyó el navegador del
 * archivo (loadedmetadata) cuando el mensaje no las trae; sin ninguna, el lugar
 * estándar. Siempre la proporción del video (recortada como las fotos): sin
 * bandas negras arriba y abajo.
 */
export function videoBox(width?: number, height?: number, natural?: { w: number; h: number } | null): MediaBox {
  const hasOwn = Number(width) > 0 && Number(height) > 0;
  return (hasOwn ? mediaBox(width, height) : mediaBox(natural?.w, natural?.h)) ?? placeholderBox();
}

/** Lo que se ve: el cuadro si ya se dibujó; si no, la miniatura borrosa; si no hay, el fondo oscuro. */
export function posterState(frameReady: boolean, thumbnail?: string): PosterState {
  if (frameReady) return 'frame';
  return thumbnail ? 'thumb' : 'none';
}


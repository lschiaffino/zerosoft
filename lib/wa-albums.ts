/**
 * Álbumes de fotos y videos, como WhatsApp: varias fotos o videos seguidos de
 * la misma persona, mandados juntos, se dibujan en una sola burbuja con una
 * grilla. Ni Evolution ni el proveedor falso nos pasan un id de álbum, así que
 * se agrupan acá: mismo remitente, uno detrás del otro, con no más de
 * ALBUM_GAP_MS entre cada uno, sin cita y sin texto salvo en el último.
 *
 * Puro (sin React): Lines e Inbox le pasan sus mensajes y cómo leerlos.
 */

/** Lo que hace falta saber de un mensaje para agruparlo. */
export interface AlbumInfo {
  /** Foto o video con archivo para mostrar (no sticker, no "ver una vez", no borrado ni fallido, sin cita). */
  media: boolean;
  /** Quién lo mandó y en qué día (cambia de remitente o de día: corta el álbum). Incluye también "reenviado". */
  key: string;
  /** Cuándo (ms). */
  at: number;
  /** Lleva texto: puede cerrar un álbum, nunca seguirlo. */
  caption: boolean;
  /** Empieza algo nuevo antes de este (el separador de no leídos): no se pega al anterior. */
  start?: boolean;
}

/** Hasta cuánto pueden separarse dos fotos seguidas del mismo álbum. */
export const ALBUM_GAP_MS = 60_000;

/** Cuántos lugares tiene la grilla; con más, el último lleva encima el "+N". */
export const ALBUM_MAX_TILES = 4;

/**
 * Parte la lista en tandas: cada mensaje suelto es una tanda de uno, y cada
 * álbum (dos o más fotos o videos que van juntos) una tanda con todos. El
 * orden no cambia.
 */
export function groupAlbums<T>(list: readonly T[], info: (item: T) => AlbumInfo): T[][] {
  const out: T[][] = [];
  let run: T[] = [];
  let last: AlbumInfo | null = null;
  const flush = () => {
    if (run.length) out.push(run);
    run = [];
    last = null;
  };
  for (const item of list) {
    const i = info(item);
    if (!i.media) {
      flush();
      out.push([item]);
      continue;
    }
    const joins = last !== null && !last.caption && !i.start && last.key === i.key && i.at >= last.at && i.at - last.at <= ALBUM_GAP_MS;
    if (!joins) flush();
    run.push(item);
    last = i;
    if (i.caption) flush();
  }
  flush();
  return out;
}

export type AlbumShape = 'two' | 'three' | 'grid';

/** Cómo se arma la grilla: 2 lado a lado, 3 una alta y dos apiladas, 4 o más en 2×2 con "+N" en la cuarta. */
export function albumLayout(count: number): { shape: AlbumShape; shown: number; more: number } {
  if (count <= 2) return { shape: 'two', shown: count, more: 0 };
  if (count === 3) return { shape: 'three', shown: 3, more: 0 };
  // Como WhatsApp: la cuarta queda tapada por el "+N", así que cuenta entre las que faltan (5 fotos: "+2").
  return { shape: 'grid', shown: ALBUM_MAX_TILES, more: count > ALBUM_MAX_TILES ? count - ALBUM_MAX_TILES + 1 : 0 };
}

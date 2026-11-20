/**
 * Las secciones de la pestaña Stickers (components/groups/wa/StickerPanel.tsx),
 * aparte para probarlas sin la pantalla. Sirve en el navegador y en el servidor.
 */

/** Lo que hace falta de un sticker para ubicarlo (StickerItem / StickerDto). */
export interface SectionSticker {
  usedAt: string | null;
  favorite: boolean;
  created?: boolean;
}

export type SectionKey = 'recent' | 'favorites' | 'created' | 'chats';

/**
 * En qué sección va cada sticker, como en WhatsApp: lo suyo arriba (los recientes, que son los que mandó desde esta
 * línea, el más nuevo primero; sus favoritos; los que creó) y lo que solo recibió aparte, en "De tus chats". Uno que
 * manda o marca favorito sale de ahí y sube. Un sticker puede estar en reciente y en favoritos a la vez (WhatsApp
 * también). Las secciones vacías no se devuelven.
 */
export function stickerSections<T extends SectionSticker>(list: T[]): Array<{ key: SectionKey; list: T[] }> {
  const recent = list.filter((s) => s.usedAt).sort((a, b) => String(b.usedAt).localeCompare(String(a.usedAt)));
  const out: Array<{ key: SectionKey; list: T[] }> = [
    { key: 'recent', list: recent },
    { key: 'favorites', list: list.filter((s) => s.favorite) },
    { key: 'created', list: list.filter((s) => s.created) },
    { key: 'chats', list: list.filter((s) => !s.usedAt && !s.favorite && !s.created) },
  ];
  return out.filter((s) => s.list.length > 0);
}

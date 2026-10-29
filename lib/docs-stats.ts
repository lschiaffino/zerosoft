import type { DocsBlock } from './docs-types';
import { blockSearchText } from './docs-search';

/** Palabras por minuto para el tiempo de lectura (promedio de lectura en silencio). */
const WORDS_PER_MINUTE = 200;

export interface DocsPageStats {
  words: number;
  characters: number;
  minutes: number;
}

/** Conteo de palabras, caracteres y minutos de lectura de una página (título y bloques; las bases de datos no cuentan). */
export function pageStats(title: string, blocks: DocsBlock[]): DocsPageStats {
  const parts = [title];
  for (const b of blocks) {
    if (b.type === 'database') continue;
    parts.push(blockSearchText(b));
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  return {
    words,
    characters: text.length,
    minutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

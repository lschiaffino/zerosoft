import { withDatabaseBodies, type DocsBlock } from './docs-types';
import { inlineHtmlToText } from './docs-markdown';
import { databaseSearchText } from './docs-database';

/**
 * Búsqueda de Docs por título y por contenido de los bloques. Puro: lo usa
 * searchDocPagesContent (lib/docs.ts) después de un prefiltro en SQL, y el
 * switcher Cmd+P para resaltar el fragmento.
 */

export interface DocsSearchHit {
  id: string;
  title: string;
  icon: string | null;
  parent_id: string | null;
  updated_at: string;
  /** Dónde matcheó: el título gana sobre el contenido al ordenar. */
  match: 'title' | 'content';
  /** Fragmento del texto alrededor del match (null si matcheó solo el título). */
  snippet: string | null;
  /** Hit de una fila de una base: id de la fila (se abre con ?row=) y título de su página. */
  row_id?: string | null;
  page_title?: string | null;
}

/** Minúsculas y sin tildes: "Canción" y "cancion" matchean igual. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Palabras de la query (todas tienen que aparecer). */
export function searchTokens(query: string): string[] {
  return normalizeSearch(query)
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Término para el prefiltro SQL (LIKE): la palabra más larga hecha solo de
 * letras y números ASCII. El contenido se guarda como JSON de HTML-lite, así
 * que comillas, "&" o "<" quedan escapados y no sirven para un LIKE; con tildes
 * el LIKE de SQLite no matchea sin acento. Sin un término así no hay prefiltro.
 */
export function prefilterTerm(query: string): string | null {
  const words = query.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 2);
  if (words.length === 0) return null;
  return words.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Texto plano de un bloque (incluye celdas, columnas y nombres de archivo). */
export function blockSearchText(block: DocsBlock): string {
  switch (block.type) {
    case 'table':
      return (block.rows ?? []).map((r) => r.join(' ')).join(' ');
    case 'database':
      return databaseSearchText(block);
    case 'image':
    case 'file':
      return block.name ?? '';
    case 'divider':
    case 'board':
      return '';
    default:
      return inlineHtmlToText(block.content ?? '');
  }
}

/** Texto corrido de la página, acotado (alcanza para buscar y armar el snippet). */
export function pageSearchText(blocks: DocsBlock[], maxChars = 50_000): string {
  const out: string[] = [];
  let len = 0;
  for (const b of withDatabaseBodies(blocks)) {
    const text = blockSearchText(b).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push(text);
    len += text.length + 1;
    if (len >= maxChars) break;
  }
  return out.join(' ').slice(0, maxChars);
}

/** true si todas las palabras aparecen en el texto (normalizado). */
export function matchesAll(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const hay = normalizeSearch(text);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Fragmento de ~`radius` caracteres a cada lado de la primera palabra que
 * aparece, cortado en espacios, con "…" si se recortó. La normalización no
 * cambia largos para texto latino común (NFD + quitar marcas deja 1 a 1 las
 * letras), así que los índices sirven sobre el original; si no coinciden, se
 * busca en minúsculas como respaldo.
 */
export function buildSnippet(text: string, tokens: string[], radius = 60): string | null {
  if (!text || tokens.length === 0) return null;
  const norm = normalizeSearch(text);
  const sameLength = norm.length === text.length;
  const hay = sameLength ? norm : text.toLowerCase();
  let at = -1;
  let len = 0;
  for (const t of tokens) {
    const i = hay.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) {
      at = i;
      len = t.length;
    }
  }
  if (at === -1) return null;
  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + len + radius);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < at) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > at + len) end = sp;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Partes del texto para resaltar las palabras buscadas sin innerHTML:
 * [{ text, hit }]. Mismo criterio de normalización que la búsqueda.
 */
export function highlightParts(text: string, tokens: string[]): Array<{ text: string; hit: boolean }> {
  if (!text) return [];
  const norm = normalizeSearch(text);
  const hay = norm.length === text.length ? norm : text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of tokens) {
    if (!t) continue;
    let i = hay.indexOf(t);
    while (i !== -1) {
      for (let k = i; k < i + t.length && k < text.length; k++) marks[k] = true;
      i = hay.indexOf(t, i + t.length);
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}

/** Título primero, después contenido; dentro de cada grupo, lo más reciente arriba. */
export function rankHits(hits: DocsSearchHit[], limit = 20): DocsSearchHit[] {
  return [...hits]
    .sort((a, b) => {
      if (a.match !== b.match) return a.match === 'title' ? -1 : 1;
      return b.updated_at.localeCompare(a.updated_at);
    })
    .slice(0, limit);
}

/** Atajo del switcher de páginas: Cmd+P / Ctrl+P (sin Shift ni Alt). */
export function isPageSwitcherHotkey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p';
}

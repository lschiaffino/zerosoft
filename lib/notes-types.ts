/**
 * Notes — tipos y helpers puros (sin DB): los usan el servidor y el cliente.
 */
import type { DocsBlock } from './docs-types';

export type NotesSort = 'updated' | 'created' | 'title';
export const NOTES_SORTS: readonly NotesSort[] = ['updated', 'created', 'title'];

/** Vista del panel izquierdo. */
export type NotesView = 'all' | 'pinned' | 'trash';

export interface NoteSummary {
  id: string;
  notebook_id: string | null;
  title: string;
  snippet: string;
  tags: string[];
  pinned: boolean;
  trashed: boolean;
  source_url: string | null;
  shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface NoteDetail extends NoteSummary {
  content: DocsBlock[];
  share_token: string | null;
}

export interface NotebookInfo {
  id: string;
  name: string;
  count: number;
}

export interface TagInfo {
  tag: string;
  count: number;
}

export const NOTE_TAG_MAX = 40;
export const NOTE_TAGS_PER_NOTE = 20;

/** Normaliza un tag: minúsculas, sin '#', espacios colapsados a '-'. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, NOTE_TAG_MAX);
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

/** HTML-lite (subset de Docs) → texto plano, sin DOM (sirve en el servidor). */
export function htmlLiteToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

/** Bloques → texto plano (búsqueda, snippets y contexto para la AI). */
export function blocksToText(blocks: DocsBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'divider') continue;
    if (b.type === 'table' || b.type === 'database') {
      for (const row of b.rows ?? []) lines.push(row.join(' · '));
      continue;
    }
    const text = htmlLiteToText(b.content);
    if (b.type === 'todo') lines.push(`${b.checked ? '[x]' : '[ ]'} ${text}`);
    else if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') lines.push(`- ${text}`);
    else lines.push(text);
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Snippet de una línea para la lista de notas. */
export function makeSnippet(body: string, max = 140): string {
  const flat = body
    // Las tareas van como texto plano en el extracto.
    .replace(/^\[[ x]\] (.*)$/gm, '$1,')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,$/, '');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Snippet centrado en el primer término encontrado (resultados de búsqueda). */
export function snippetAround(body: string, terms: string[], max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || flat.length <= max) return makeSnippet(flat, max);
  const start = Math.max(0, at - 40);
  const slice = flat.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${slice}${start + max < flat.length ? '…' : ''}`;
}

/** Términos de búsqueda (letras/números unicode, sin operadores FTS). */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 0).slice(0, 12);
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Bloques de una nota recortada: link a la fuente + la selección como cita. */
export function clipBlocks(url: string, selection: string): DocsBlock[] {
  const id = () => crypto.randomUUID();
  const blocks: DocsBlock[] = [
    { id: id(), type: 'paragraph', content: `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` },
  ];
  const paragraphs = selection
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 50);
  for (const p of paragraphs) blocks.push({ id: id(), type: 'quote', content: esc(p) });
  blocks.push({ id: id(), type: 'paragraph', content: '' });
  return blocks;
}

/** Bookmarklet de captura: abre /app/notes/clip con url, título y selección. */
export function clipBookmarklet(origin: string, locale: string): string {
  const base = `${origin}/${locale}/app/notes/clip`;
  return (
    'javascript:(function(){var s=window.getSelection?String(window.getSelection()):"";' +
    `window.open("${base}?url="+encodeURIComponent(location.href)+"&title="+encodeURIComponent(document.title)+"&selection="+encodeURIComponent(s.slice(0,4000)),"zsclip","width=520,height=600");})();`
  );
}

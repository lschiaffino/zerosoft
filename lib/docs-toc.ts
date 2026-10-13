import type { DocsBlock } from './docs-types';

/**
 * Índice (ToC) de una página: headings con un id de ancla estable y único.
 * Puro: lo usan el render de solo lectura (DocsBlocksView) y el centro de ayuda.
 */

export interface TocEntry {
  blockId: string;
  anchor: string;
  text: string;
  level: 1 | 2 | 3;
}

function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function anchorBase(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  );
}

export function buildToc(blocks: DocsBlock[]): TocEntry[] {
  const used = new Map<string, number>();
  const out: TocEntry[] = [];
  for (const b of blocks) {
    if (b.type !== 'heading') continue;
    const text = plain(b.content);
    if (!text) continue;
    const base = anchorBase(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    out.push({ blockId: b.id, anchor: n === 0 ? base : `${base}-${n + 1}`, text, level: b.level ?? 1 });
  }
  return out;
}

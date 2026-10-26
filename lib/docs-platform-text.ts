/**
 * Docs: contenido de una página como texto o Markdown y de vuelta, para la
 * API pública, el MCP, Flow, la IA y Agents. Las bases viajan como tabla en
 * Markdown (solo lectura); el resto de los bloques ida y vuelta. Server-only
 * (usa el saneado del servidor).
 */
import type { DocsBlock } from './docs-types';
import { markdownToBlocks } from './docs-import';
import { blocksToMarkdown } from './docs-markdown';
import { pageSearchText } from './docs-search';
import { sanitizeDocsHtml } from './docs-sanitize';

/** Texto corrido de los bloques (para la IA, eventos y snippets). */
export function blocksToPlainText(blocks: DocsBlock[], maxChars = 50_000): string {
  return pageSearchText(blocks, maxChars);
}

/** Bloques → Markdown (sin el título salvo que se pase). */
export function blocksToMd(blocks: DocsBlock[], title?: string): string {
  return blocksToMarkdown(blocks, title);
}

/** Markdown (o texto) → bloques saneados con ids nuevos. Tope de 2000 bloques. */
export function mdToBlocks(md: string): DocsBlock[] {
  const text = md.replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];
  return markdownToBlocks(text.slice(0, 400_000), { sanitize: sanitizeDocsHtml }).slice(0, 2000);
}

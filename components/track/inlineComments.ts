'use client';

import { useEffect } from 'react';

/**
 * Comentarios en línea sobre la descripción de un issue (como Linear): el
 * comentario guarda el texto elegido y acá se lo vuelve a encontrar en la
 * descripción para resaltarlo con la API de resaltados de CSS (no toca el
 * DOM del editor ni el Markdown guardado). Si el texto ya no está (se editó),
 * el comentario queda con su cita y sin resaltado.
 */

export interface InlineAnchor {
  /** Id del comentario raíz. */
  id: string;
  quote: string;
}

/** Nombre del resaltado (styles/track-issue.css: ::highlight(track-inline-comment)). */
export const INLINE_HIGHLIGHT = 'track-inline-comment';

/** Texto de la selección tal como se guarda: espacios y saltos colapsados, con tope. */
export function normalizeQuote(text: string, max = 1000): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Rango del primer lugar de `root` donde aparece `quote`, sin mirar espacios
 * ni saltos de línea (una cita que cruza dos párrafos también se encuentra).
 */
export function findQuoteRange(root: Node, quote: string): Range | null {
  const needle = quote.replace(/\s+/g, '');
  if (!needle) return null;
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // Texto sin espacios y, por cada carácter, de qué nodo y posición viene.
  let squashed = '';
  const at: Array<{ node: Text; offset: number }> = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const s = t.data;
    for (let i = 0; i < s.length; i++) {
      if (/\s/.test(s[i])) continue;
      squashed += s[i];
      at.push({ node: t, offset: i });
    }
  }
  const start = squashed.indexOf(needle);
  if (start < 0) return null;
  const first = at[start];
  const last = at[start + needle.length - 1];
  const range = doc.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

type HighlightRegistry = Map<string, unknown> & { set(name: string, h: unknown): void; delete(name: string): boolean };

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function' ? css.highlights : null;
}

/**
 * Resalta en `getRoot()` el texto de cada comentario en línea abierto y
 * devuelve, para un clic, a qué comentario apunta ese punto. Se recalcula
 * cuando cambian los comentarios o el texto (`version`).
 */
export function useInlineHighlights(
  getRoot: () => HTMLElement | null,
  anchors: InlineAnchor[],
  version: unknown,
  onOpen: (commentId: string) => void,
) {
  const key = anchors.map((a) => `${a.id}:${a.quote}`).join('\u0000');
  useEffect(() => {
    const root = getRoot();
    const reg = registry();
    if (!root) return;
    const ranges: Array<{ id: string; range: Range }> = [];
    for (const a of anchors) {
      const range = findQuoteRange(root, a.quote);
      if (range) ranges.push({ id: a.id, range });
    }
    if (reg) {
      if (ranges.length) {
        const HighlightCtor = (globalThis as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
        reg.set(INLINE_HIGHLIGHT, new HighlightCtor(...ranges.map((r) => r.range)));
      } else reg.delete(INLINE_HIGHLIGHT);
    }
    root.dataset.inlineComments = String(ranges.length);
    // Un clic (sin arrastrar) sobre un texto comentado lleva a su hilo.
    const onClick = (e: MouseEvent) => {
      const sel = root.ownerDocument.getSelection();
      if (sel && !sel.isCollapsed) return;
      const doc = root.ownerDocument as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      let node: Node | null = null;
      let offset = 0;
      const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
      if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
      } else {
        const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
        if (r) {
          node = r.startContainer;
          offset = r.startOffset;
        }
      }
      if (!node) return;
      const hit = ranges.find((r) => {
        try {
          return r.range.isPointInRange(node!, offset) && r.range.comparePoint(node!, offset) === 0 && !r.range.collapsed;
        } catch {
          return false;
        }
      });
      if (hit) onOpen(hit.id);
    };
    root.addEventListener('click', onClick);
    return () => {
      root.removeEventListener('click', onClick);
      reg?.delete(INLINE_HIGHLIGHT);
      delete root.dataset.inlineComments;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

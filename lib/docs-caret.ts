/**
 * Utilidades de caret para contentEditable.
 * El "offset" es la posición dentro del TEXTO PLANO del bloque (los tags del
 * HTML-lite no cuentan): se mide caminando text nodes, así que funciona igual
 * con o sin marcas en línea.
 */

/** Offset (en caracteres) del caret dentro de `el`, caminando los text nodes. */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Coloca el caret en el offset `n` (en caracteres) dentro de `el`. */
export function setCaretOffset(el: HTMLElement, n: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, n);
  let node = walker.nextNode();
  while (node) {
    const len = (node.textContent ?? '').length;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  // Sin text nodes (bloque vacío) u offset más allá del final: al final.
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Offsets de texto plano [start, end) de la selección dentro de `el`. */
export function getSelectionOffsets(el: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}

function resolveTextPoint(el: HTMLElement, n: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, n);
  let node = walker.nextNode();
  while (node) {
    const len = (node.textContent ?? '').length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    node = walker.nextNode();
  }
  return null;
}

/** Selecciona el rango [start, end) de texto plano dentro de `el`. */
export function setSelectionOffsets(el: HTMLElement, start: number, end: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const s = resolveTextPoint(el, start);
  const e = resolveTextPoint(el, end);
  if (!s || !e) {
    setCaretOffset(el, end);
    return;
  }
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  sel.removeAllRanges();
  sel.addRange(range);
}

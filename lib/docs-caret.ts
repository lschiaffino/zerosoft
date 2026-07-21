/**
 * Utilidades de caret para contentEditable de texto plano.
 * El contenido de cada bloque es un string plano (sin nodos ricos), así que
 * el "offset" es simplemente la posición del caret dentro de ese string.
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

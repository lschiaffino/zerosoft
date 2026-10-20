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

/**
 * Rect (coordenadas de viewport) del caret de la selección actual. Con el
 * rango colapsado los browsers devuelven un rect de ancho 0 en la posición del
 * caret; con selección activa se toma el primer rect del rango. Devuelve null
 * si no hay selección o el rect es degenerado (ej. bloque vacío sin texto):
 * el caller decide el fallback (típicamente el rect del bloque).
 */
export function getCaretViewportRect(): { left: number; top: number; bottom: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect) return null;
  if (rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.right === 0) return null;
  return { left: rect.left, top: rect.top, bottom: rect.bottom || rect.top };
}

// ---------- Flechas ↑/↓ entre bloques (como Notion) ----------

interface LineRect {
  top: number;
  bottom: number;
}

/**
 * ¿Dos rects están en la misma línea visual? Se comparan los centros
 * verticales contra media altura de línea (mínimo 4px): el rect del caret y el
 * de un carácter de la misma línea pueden diferir unos px según la fuente.
 */
export function isSameVisualLine(a: LineRect, b: LineRect): boolean {
  const ca = (a.top + a.bottom) / 2;
  const cb = (b.top + b.bottom) / 2;
  const half = Math.max(4, Math.max(a.bottom - a.top, b.bottom - b.top) / 2);
  return Math.abs(ca - cb) < half;
}

/**
 * Índice del bloque al que va el foco con ↑ (dir -1) / ↓ (dir 1): el vecino
 * más cercano que se puede enfocar (texto, imagen o archivo). Divider, tabla
 * y base se saltean (sus celdas tienen su propio teclado). -1 si no hay.
 */
export function findVerticalTarget(types: string[], index: number, dir: -1 | 1): number {
  for (let i = index + dir; i >= 0 && i < types.length; i += dir) {
    const t = types[i];
    if (t !== 'divider' && t !== 'table' && t !== 'database') return i;
  }
  return -1;
}

/** Rect del primer (dir -1) o último (dir 1) carácter del texto de `el`. */
function edgeCharRect(el: HTMLElement, dir: -1 | 1): LineRect | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let first: Text | null = null;
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if ((node.textContent ?? '').length > 0) {
      if (!first) first = node;
      last = node;
    }
    node = walker.nextNode() as Text | null;
  }
  const target = dir === -1 ? first : last;
  if (!target) return null;
  const len = target.textContent?.length ?? 0;
  const range = document.createRange();
  if (dir === -1) {
    range.setStart(target, 0);
    range.setEnd(target, Math.min(1, len));
  } else {
    range.setStart(target, Math.max(0, len - 1));
    range.setEnd(target, len);
  }
  const rects = range.getClientRects();
  const rect = dir === -1 ? rects[0] : rects[rects.length - 1];
  return rect ? { top: rect.top, bottom: rect.bottom } : null;
}

/**
 * ¿El caret (colapsado) está en la primera (dir -1) o última (dir 1) línea
 * visual del bloque? Bloque vacío, caret en el extremo del texto o sin rect
 * medible: sí (se puede salir del bloque).
 */
export function isCaretOnEdgeLine(el: HTMLElement, dir: -1 | 1): boolean {
  const text = el.textContent ?? '';
  if (!text.length) return true;
  const offset = getCaretOffset(el);
  if (dir === -1 && offset === 0) return true;
  if (dir === 1 && offset >= text.length) return true;
  const caret = getCaretViewportRect();
  const edge = edgeCharRect(el, dir);
  if (!caret || !edge) return true;
  return isSameVisualLine(caret, edge);
}

interface CaretPoint {
  node: Node;
  offset: number;
}

/** Posición del texto bajo un punto del viewport (Chrome/Safari y Firefox). */
function caretFromPoint(x: number, y: number): CaretPoint | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

/** x clampeada al ancho del bloque (1px adentro de cada borde). */
export function clampCaretX(x: number, left: number, right: number): number {
  if (right - left <= 2) return left;
  return Math.min(Math.max(x, left + 1), right - 1);
}

/**
 * Enfoca `el` y pone el caret en su primera (edge 'top') o última ('bottom')
 * línea, lo más cerca posible de la x dada (la x que tenía el caret en el
 * bloque de origen). Si el browser no puede resolver el punto, va al
 * principio o al final del texto.
 */
export function placeCaretAtX(el: HTMLElement, x: number, edge: 'top' | 'bottom'): void {
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'nearest' });
  const rect = el.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
  const inset = Math.min(lineHeight / 2, rect.height / 2);
  const y = edge === 'top' ? rect.top + inset : rect.bottom - inset;
  const point = caretFromPoint(clampCaretX(x, rect.left, rect.right), y);
  const sel = window.getSelection();
  if (point && sel && el.contains(point.node)) {
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  setCaretOffset(el, edge === 'top' ? 0 : (el.textContent ?? '').length);
}

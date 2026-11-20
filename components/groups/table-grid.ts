'use client';

/**
 * Las tablas de Lines como una planilla (Grupos y Contactos, en Lines y en
 * Inbox): la tabla scrollea en su propia caja, con la cabecera arriba y las
 * primeras columnas (casilla y nombre) fijas mientras se mueve en los dos
 * sentidos, y las flechas pasan de una celda a otra. Los estilos son
 * .gr-grid-wrap, .gr-grid y .gr-grid-pin (styles/lines-groups-table.css).
 */
import { useLayoutEffect, type KeyboardEvent, type RefObject } from 'react';

export type GridDir = 'up' | 'down' | 'left' | 'right';

const KEYS: Record<string, GridDir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Lo que recibe el foco en una celda: su control (botón, link, casilla) o la celda misma. */
export function cellFocusTarget(cell: HTMLElement): HTMLElement {
  return cell.querySelector<HTMLElement>('[data-grid-focus]') ?? cell.querySelector<HTMLElement>(FOCUSABLE) ?? cell;
}

/**
 * Lleva la celda a la vista dentro de su caja sin que la tapen la cabecera ni
 * las columnas fijas (scrollIntoView no sabe de lo que está fijo).
 */
export function revealCell(cell: HTMLElement): void {
  const wrap = cell.closest<HTMLElement>('.gr-grid-wrap');
  if (!wrap) {
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const w = wrap.getBoundingClientRect();
  const r = cell.getBoundingClientRect();
  if (cell.closest('tbody')) {
    const head = wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const top = r.top - w.top - wrap.clientTop;
    const bottom = r.bottom - w.top - wrap.clientTop;
    if (top < head) wrap.scrollTop -= head - top;
    else if (bottom > wrap.clientHeight) wrap.scrollTop += bottom - wrap.clientHeight;
  }
  if (!cell.classList.contains('gr-grid-pin')) {
    const pins = wrap.querySelectorAll<HTMLElement>('thead .gr-grid-pin');
    const last = pins[pins.length - 1];
    const pinned = last ? last.getBoundingClientRect().right - w.left - wrap.clientLeft : 0;
    const left = r.left - w.left - wrap.clientLeft;
    const right = r.right - w.left - wrap.clientLeft;
    if (left < pinned) wrap.scrollLeft -= pinned - left;
    else if (right > wrap.clientWidth) wrap.scrollLeft += right - wrap.clientWidth;
  }
  // La caja misma, dentro de la página (debajo de la banda de arriba).
  const after = cell.getBoundingClientRect();
  const band = 56;
  if (after.top < band) window.scrollBy({ top: after.top - band });
  else if (after.bottom > window.innerHeight) window.scrollBy({ top: after.bottom - window.innerHeight + 8 });
}

/** Pone el foco en una celda (en su control, si tiene) y la muestra. */
export function focusCell(cell: HTMLElement): void {
  const target = cellFocusTarget(cell);
  if (target === cell && !cell.hasAttribute('tabindex')) cell.tabIndex = -1;
  target.focus({ preventScroll: true });
  revealCell(cell);
}

/** La celda vecina de la que tiene `from` adentro; null en el borde de la tabla. */
export function neighborCell(from: Element, dir: GridDir): HTMLTableCellElement | null {
  const cell = from.closest<HTMLTableCellElement>('td, th');
  const table = cell?.closest('table');
  const tr = cell?.parentElement as HTMLTableRowElement | null | undefined;
  if (!cell || !table || !tr) return null;
  let r = tr.rowIndex;
  let c = cell.cellIndex;
  if (dir === 'up') r--;
  else if (dir === 'down') r++;
  else if (dir === 'left') c--;
  else c++;
  if (r < 0 || r >= table.rows.length) return null;
  const row = table.rows[r];
  if (dir === 'up' || dir === 'down') c = Math.min(c, row.cells.length - 1);
  if (c < 0 || c >= row.cells.length) return null;
  return row.cells[c] ?? null;
}

/** Mueve el foco a la celda vecina. Devuelve si se movió. */
export function moveCell(from: Element, dir: GridDir): boolean {
  const next = neighborCell(from, dir);
  if (!next) return false;
  focusCell(next);
  return true;
}

/**
 * Las flechas en la tabla: pasan de celda en celda (como en una planilla).
 * No se meten con un campo de texto, una lista, un editor abierto ni con
 * Alt, Ctrl, Cmd o Shift.
 */
export function onGridKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const dir = KEYS[e.key];
  if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const target = e.target as HTMLElement;
  if (target.closest('[role="dialog"]')) return;
  if (target.matches('input:not([type="checkbox"]):not([type="radio"]), select, textarea, [contenteditable="true"]')) return;
  if (!target.closest('td, th')) return;
  if (moveCell(target, dir)) e.preventDefault();
}

/**
 * Alto de la caja de la tabla: lo que queda de la pantalla debajo de donde
 * empieza (con la página arriba de todo), así la cabecera fija queda a la vista
 * y la página casi no scrollea. También mide cuánto corre la segunda columna
 * fija (el ancho de la primera). Se vuelve a medir al cambiar el tamaño de la
 * ventana o lo que cambie `deps`.
 */
export function useGridBox(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.setProperty('--grid-max-h', `${Math.max(360, Math.round(window.innerHeight - top - 16))}px`);
      const first = el.querySelector<HTMLElement>('thead .gr-grid-pin');
      if (first) el.style.setProperty('--grid-pin-1', `${first.offsetWidth}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const head = el.querySelector('thead');
    if (ro && head) ro.observe(head);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

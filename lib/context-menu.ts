/**
 * Cuentas del menú contextual (clic derecho sobre un chat, como WhatsApp):
 * dónde se abre el menú y su submenú. Puro, sin DOM: lo usa
 * components/ui/ContextMenu.tsx.
 */

/** Distancia mínima (px) al borde de la ventana. */
export const MENU_MARGIN = 8;

export interface MenuBox {
  left: number;
  top: number;
  /** Alto máximo: si no entra en la ventana, la lista se corre por dentro. */
  maxHeight: number;
}

/**
 * Menú en el puntero: abajo a la derecha del punto; si no entra a la
 * derecha, se abre hacia la izquierda; si no entra abajo, hacia arriba. Nunca
 * sale de la ventana (si es más alto que la ventana, se achica).
 */
export function placeMenu(o: { x: number; y: number; w: number; h: number; vw: number; vh: number; margin?: number }): MenuBox {
  const m = o.margin ?? MENU_MARGIN;
  const maxHeight = Math.max(0, o.vh - m * 2);
  const h = Math.min(o.h, maxHeight);
  let left = o.x + o.w > o.vw - m ? o.x - o.w : o.x;
  let top = o.y + h > o.vh - m ? o.y - h : o.y;
  left = Math.min(Math.max(left, m), Math.max(o.vw - o.w - m, m));
  top = Math.min(Math.max(top, m), Math.max(o.vh - h - m, m));
  return { left: Math.round(left), top: Math.round(top), maxHeight };
}

/**
 * Submenú al lado del ítem que lo abre: a la derecha del menú si entra; si
 * no, a la izquierda. Arriba alineado con el ítem, corrido para no salir de
 * la ventana. Si no entra a ningún lado (un teléfono), va debajo del ítem,
 * un poco hacia adentro: el ítem que lo abrió sigue a la vista.
 */
export function placeSubmenu(o: {
  parent: { left: number; right: number };
  item: { top: number; bottom: number };
  w: number;
  h: number;
  vw: number;
  vh: number;
  margin?: number;
}): MenuBox & { side: 'right' | 'left' | 'below' } {
  const m = o.margin ?? MENU_MARGIN;
  const maxHeight = Math.max(0, o.vh - m * 2);
  const h = Math.min(o.h, maxHeight);
  const fitsRight = o.parent.right + o.w <= o.vw - m;
  const fitsLeft = o.parent.left - o.w >= m;
  const clampLeft = (x: number) => Math.min(Math.max(x, m), Math.max(o.vw - o.w - m, m));
  const clampTop = (y: number) => Math.min(Math.max(y, m), Math.max(o.vh - h - m, m));
  if (!fitsRight && !fitsLeft) {
    const below = o.item.bottom + h <= o.vh - m;
    const top = below ? o.item.bottom : o.item.top - h;
    return { left: Math.round(clampLeft(o.parent.left + 16)), top: Math.round(clampTop(top)), maxHeight, side: 'below' };
  }
  const side: 'right' | 'left' = fitsRight ? 'right' : 'left';
  const left = clampLeft(side === 'right' ? o.parent.right : o.parent.left - o.w);
  return { left: Math.round(left), top: Math.round(clampTop(o.item.top)), maxHeight, side };
}

/**
 * Próximo ítem al moverse con las flechas o Inicio/Fin, salteando los
 * deshabilitados y dando la vuelta. `from` -1 es "ninguno" (abajo va al
 * primero, arriba al último). Devuelve -1 si no hay ninguno habilitado.
 */
export function nextIndex(from: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End', disabled: readonly boolean[]): number {
  const n = disabled.length;
  if (!n || disabled.every(Boolean)) return -1;
  if (key === 'Home') return disabled.findIndex((d) => !d);
  if (key === 'End') {
    for (let i = n - 1; i >= 0; i--) if (!disabled[i]) return i;
    return -1;
  }
  const step = key === 'ArrowDown' ? 1 : -1;
  let i = from < 0 ? (step > 0 ? -1 : n) : from;
  for (let k = 0; k < n; k++) {
    i = (i + step + n) % n;
    if (!disabled[i]) return i;
  }
  return -1;
}

/** ¿Esta tecla abre el menú contextual de lo que tiene el foco? (la tecla de menú o Shift+F10). */
export function isMenuKey(e: { key: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

/**
 * Las teclas que abren otra ventana o pestaña con un link en la app de
 * escritorio (desktop/src-tauri/src/lib.rs): ⌘⌥ en Mac, Ctrl+Alt en
 * Windows.
 */
export function newWindowModifiers(platform: string): { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean } {
  const mac = platform === 'darwin';
  return { metaKey: mac, ctrlKey: !mac, altKey: true, shiftKey: false };
}

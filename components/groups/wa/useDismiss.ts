'use client';

import { useEffect, useId, useRef } from 'react';

/** Lo que cuenta como "adentro": un ref, una función que devuelve el elemento, o un selector (con `closest`). */
export type DismissInside = { current: Element | null } | (() => Element | null | undefined) | string;

/** El overlay abierto ahora (barra de reacciones, menú, bandeja de emojis, cuadro de reacciones): uno a la vez. */
let current: { id: string; close: () => void } | null = null;

function elementOf(inside: DismissInside): Element | null | undefined {
  if (typeof inside === 'string') return null;
  return typeof inside === 'function' ? inside() : inside.current;
}

function contains(inside: DismissInside, target: Element): boolean {
  if (typeof inside === 'string') return Boolean(target.closest(inside));
  const el = elementOf(inside);
  return Boolean(el && el.contains(target));
}

/**
 * Cierre de los overlays pasajeros del chat (Inbox y Lines), todos igual:
 * - un toque o clic afuera (pointerdown, así sirve con mouse y con el dedo);
 * - Esc (en captura: lo cierra a él solo, no a lo de atrás, como un borrador o la respuesta);
 * - abrir otro overlay cierra este.
 * `inside` es el overlay y su botón: un toque en el botón no cuenta como afuera, así el
 * botón lo cierra (alterna) y el mismo toque no lo vuelve a abrir.
 */
export function useDismiss(open: boolean, onDismiss: (reason: 'outside' | 'escape' | 'other') => void, inside: DismissInside[], opts: { escape?: boolean } = {}) {
  const id = useId();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const insideRef = useRef(inside);
  insideRef.current = inside;
  const escape = opts.escape ?? true;

  useEffect(() => {
    if (!open) return;
    const me = { id, close: () => dismissRef.current('other') };
    if (current && current.id !== id) current.close();
    current = me;
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (insideRef.current.some((x) => contains(x, target))) return;
      // Un diálogo modal encima (una confirmación que abrió el overlay) no es "afuera" de lo que quedó atrás.
      const dlg = target.closest('dialog[open]');
      if (dlg && !insideRef.current.some((x) => dlg.contains(elementOf(x) ?? null))) return;
      dismissRef.current('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (!escape || e.key !== 'Escape' || e.defaultPrevented) return;
      // Solo el último que se abrió.
      if (current !== me) return;
      e.preventDefault();
      e.stopPropagation();
      dismissRef.current('escape');
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      if (current === me) current = null;
    };
  }, [open, id, escape]);
}

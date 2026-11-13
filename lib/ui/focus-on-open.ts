'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Lines e Inbox: abrir un chat con un clic deja el cursor en el campo de
 * mensaje, como WhatsApp. Solo con un clic reciente del mouse: con el teclado
 * (j/k, flechas) el foco queda en la lista para seguir navegando, y en el
 * teléfono (puntero grueso) no se abre el teclado en pantalla.
 */

/** Cuánto vale un clic para el chat que se abre después (la navegación y la carga del chat). */
export const CLICK_WINDOW_MS = 2500;

let lastPointerAt = 0;
let lastKeyAt = 0;
let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') lastPointerAt = Date.now();
  }, true);
  window.addEventListener('keydown', () => {
    lastKeyAt = Date.now();
  }, true);
}

// Arranca al cargar el módulo (lo importan las listas): el primer clic llega antes de que exista el campo.
listen();

/** ¿El chat se está abriendo por un clic del mouse (y no por el teclado)? */
export function openedByClick(now = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.matchMedia?.('(pointer: fine)').matches) return false;
  return lastPointerAt > lastKeyAt && now - lastPointerAt < CLICK_WINDOW_MS;
}

/** Con `key` nuevo (el chat abierto), enfoca `ref` si se abrió con un clic y nada más tiene el foco. */
export function useFocusOnOpen(ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>, key: string, enabled = true) {
  useEffect(() => {
    if (!enabled || !openedByClick()) return;
    let frame = 0;
    let tries = 0;
    const tryFocus = () => {
      const el = ref.current;
      const active = document.activeElement as HTMLElement | null;
      // Un diálogo abierto, o un campo que ya tiene el foco (la búsqueda, otro input): no se lo saca.
      const busy = document.querySelector('[role="dialog"][aria-modal="true"]') || (active && active !== el && active.matches('input, textarea, select, [contenteditable="true"]'));
      if (busy) return;
      if (el && !el.disabled) {
        el.focus({ preventScroll: true });
        const end = el.value.length;
        el.setSelectionRange?.(end, end);
        return;
      }
      // El campo aparece cuando carga el chat: se reintenta unos cuadros.
      if (++tries < 60) frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
  }, [ref, key, enabled]);
}

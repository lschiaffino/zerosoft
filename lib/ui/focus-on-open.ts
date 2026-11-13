'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Lines e Inbox: abrir un chat con un clic deja el cursor en el campo de mensaje, como WhatsApp.
 *
 * Un clic del mouse en una fila de chat deja un pedido pendiente ("enfocar al abrir"); el campo lo
 * toma cuando aparece, aunque el chat tarde en cargar (red lenta). Una tecla antes lo cancela: con
 * el teclado (j/k, flechas) el foco queda en la lista. En el teléfono (puntero grueso) no se abre el
 * teclado en pantalla. El pedido vence a los 15 s.
 */

/** Cuánto espera el pedido a que aparezca el campo del chat. */
export const PENDING_MS = 15_000;
/** Filas de chat de Lines e Inbox. */
const ROW_SELECTOR = '[data-chat-row], .ib-item, .gr-row';

let pendingAt = 0;
let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const row = (e.target as Element | null)?.closest?.(ROW_SELECTOR);
      // Los botones de la fila (opciones, seleccionar) no abren el chat.
      const control = (e.target as Element | null)?.closest?.('input, [aria-haspopup], [data-row-menu]');
      pendingAt = row && !control ? Date.now() : 0;
    },
    true,
  );
  window.addEventListener('keydown', () => (pendingAt = 0), true);
}

// Arranca al cargar el módulo (lo importan las listas): el primer clic llega antes de que exista el campo.
listen();

/** ¿Hay un clic en una fila esperando que se abra su chat? */
export function openedByClick(now = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.matchMedia?.('(pointer: fine)').matches) return false;
  return pendingAt > 0 && now - pendingAt < PENDING_MS;
}

/** Con `key` nuevo (el chat abierto), enfoca `ref` si se abrió con un clic y nada más tiene el foco. */
export function useFocusOnOpen(ref: RefObject<HTMLTextAreaElement | HTMLInputElement | null>, key: string, enabled = true) {
  useEffect(() => {
    if (!enabled || !openedByClick()) return;
    let frame = 0;
    const tryFocus = () => {
      if (!openedByClick()) return;
      const el = ref.current;
      const active = document.activeElement as HTMLElement | null;
      // Un diálogo abierto, o un campo que ya tiene el foco (la búsqueda, otro input): no se lo saca.
      const busy = document.querySelector('[role="dialog"][aria-modal="true"]') || (active && active !== el && active.matches('input, textarea, select, [contenteditable="true"]'));
      if (busy) return;
      if (el && !el.disabled) {
        pendingAt = 0;
        el.focus({ preventScroll: true });
        const end = el.value.length;
        el.setSelectionRange?.(end, end);
        return;
      }
      // El campo aparece cuando carga el chat: se reintenta mientras el pedido siga vigente.
      frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
  }, [ref, key, enabled]);
}

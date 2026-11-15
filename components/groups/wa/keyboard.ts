'use client';

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * El teclado del teléfono en el chat (Lines e Inbox), como WhatsApp.
 */

/**
 * En el botón de enviar (y los que van al lado del campo): tocarlo no le saca el foco al campo, así el teclado
 * queda abierto después de mandar. El clic sigue llegando.
 */
export const keepFocus = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') e.preventDefault();
  },
  onMouseDown: (e: ReactMouseEvent<HTMLElement>) => e.preventDefault(),
};

/**
 * Tocar la conversación (no un link, un botón ni un campo) cierra el teclado. Con el mouse no hace nada: en la
 * computadora el campo sigue con el foco.
 */
export function tapClosesKeyboard(e: ReactMouseEvent<HTMLElement>) {
  if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
  const target = e.target as HTMLElement;
  if (target.closest('a, button, input, textarea, select, video, audio, [role="button"], [contenteditable="true"]')) return;
  const active = document.activeElement as HTMLElement | null;
  if (active && active.matches('textarea, input') && active.closest('.wa-composer')) active.blur();
}

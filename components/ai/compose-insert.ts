'use client';

import { useEffect, useRef } from 'react';

/**
 * Poner un texto en el campo de un chat desde afuera del composer (la respuesta sugerida de la pestaña AI del panel).
 * Nunca manda nada: el composer lo inserta con Deshacer, como "Ayudame a escribir". `chatKey` es el chat (Lines) o el
 * hilo (Inbox): solo lo toma el composer de ese chat.
 */
export const COMPOSE_INSERT_EVENT = 'zs:compose-insert';

export interface ComposeInsertDetail {
  chatKey: string;
  text: string;
  /** Lo pone el composer que lo insertó (si no hay uno abierto, o está editando, queda en false). */
  handled?: boolean;
}

/** Pide insertar; devuelve si un composer de ese chat lo tomó. */
export function requestComposeInsert(chatKey: string, text: string): boolean {
  const detail: ComposeInsertDetail = { chatKey, text, handled: false };
  window.dispatchEvent(new CustomEvent<ComposeInsertDetail>(COMPOSE_INSERT_EVENT, { detail }));
  return detail.handled === true;
}

/**
 * El composer de `chatKey` escucha los pedidos de insertar (un texto vacío no hace nada). `onInsert` devuelve false
 * si no pudo (está editando un mensaje, el chat está en pausa): el que pidió lo sabe y lo dice.
 */
export function useComposeInsert(chatKey: string, onInsert: (text: string) => boolean): void {
  const handler = useRef(onInsert);
  handler.current = onInsert;
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ComposeInsertDetail>).detail;
      if (!d || d.chatKey !== chatKey || !d.text?.trim() || d.handled) return;
      d.handled = handler.current(d.text) === true;
    };
    window.addEventListener(COMPOSE_INSERT_EVENT, on);
    return () => window.removeEventListener(COMPOSE_INSERT_EVENT, on);
  }, [chatKey]);
}

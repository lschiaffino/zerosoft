'use client';

import { useEffect, useRef } from 'react';

/**
 * Poner un texto en el campo de un chat desde afuera del composer (la respuesta sugerida de la pestaña AI del panel,
 * el borrador que deja el asistente). Nunca manda nada: el composer lo inserta con Deshacer, como "Ayudame a escribir".
 * `chatKey` es el chat (Lines) o el hilo (Inbox): solo lo toma el composer de ese chat.
 */
export const COMPOSE_INSERT_EVENT = 'zs:compose-insert';

export interface ComposeInsertDetail {
  chatKey: string;
  text: string;
}

export function requestComposeInsert(chatKey: string, text: string): void {
  window.dispatchEvent(new CustomEvent<ComposeInsertDetail>(COMPOSE_INSERT_EVENT, { detail: { chatKey, text } }));
}

/** El composer de `chatKey` escucha los pedidos de insertar (un texto vacío no hace nada). */
export function useComposeInsert(chatKey: string, onInsert: (text: string) => void): void {
  const handler = useRef(onInsert);
  handler.current = onInsert;
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ComposeInsertDetail>).detail;
      if (!d || d.chatKey !== chatKey || !d.text?.trim()) return;
      handler.current(d.text);
    };
    window.addEventListener(COMPOSE_INSERT_EVENT, on);
    return () => window.removeEventListener(COMPOSE_INSERT_EVENT, on);
  }, [chatKey]);
}

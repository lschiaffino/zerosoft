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
  /** Lo pone el composer que lo insertó (si no hay uno abierto, o está editando, queda en false). */
  handled?: boolean;
}

/** Pide insertar; devuelve si un composer de ese chat lo tomó. */
export function requestComposeInsert(chatKey: string, text: string): boolean {
  const detail: ComposeInsertDetail = { chatKey, text, handled: false };
  window.dispatchEvent(new CustomEvent<ComposeInsertDetail>(COMPOSE_INSERT_EVENT, { detail }));
  return detail.handled === true;
}

/** El borrador que dejó el asistente para un chat que todavía no está abierto (lo toma su composer al abrir). */
const stashKey = (chatKey: string) => `zs-compose-draft:${chatKey}`;

function readStash(chatKey: string): string | null {
  try {
    return window.sessionStorage.getItem(stashKey(chatKey));
  } catch {
    return null;
  }
}

function dropStash(chatKey: string): void {
  try {
    window.sessionStorage.removeItem(stashKey(chatKey));
  } catch {
    /* sin almacenamiento */
  }
}

/**
 * Un borrador confirmado en el asistente: si el chat está abierto va ya al campo; si no (o el campo está ocupado
 * editando), queda guardado en esta pestaña del navegador (sessionStorage) y lo toma el composer de ese chat cuando
 * puede. Nunca se manda. Devuelve si ya quedó en el campo.
 */
export function deliverComposeDraft(chatKey: string, text: string): boolean {
  if (!text.trim()) return false;
  if (requestComposeInsert(chatKey, text)) return true;
  try {
    window.sessionStorage.setItem(stashKey(chatKey), text);
  } catch {
    /* sin almacenamiento: solo con el chat abierto */
  }
  return false;
}

/**
 * El composer de `chatKey` escucha los pedidos de insertar (un texto vacío no hace nada) y, al abrir, toma el borrador
 * guardado del asistente. `onInsert` devuelve false si no pudo (está editando un mensaje, el chat está en pausa): el
 * que pidió lo sabe y lo dice, y el borrador guardado queda para la próxima.
 */
export function useComposeInsert(chatKey: string, onInsert: (text: string) => boolean): void {
  const handler = useRef(onInsert);
  handler.current = onInsert;
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ComposeInsertDetail>).detail;
      if (!d || d.chatKey !== chatKey || !d.text?.trim() || d.handled) return;
      d.handled = handler.current(d.text) === true;
      if (d.handled) dropStash(chatKey);
    };
    window.addEventListener(COMPOSE_INSERT_EVENT, on);
    // Un borrador del asistente que llegó con el chat cerrado: después del primer dibujo (con el borrador propio del
    // composer ya puesto, así Deshacer lo devuelve). Solo se borra si entró.
    let frame = 0;
    if (readStash(chatKey)?.trim()) {
      // Dos cuadros: el primero deja que el composer termine de poner su borrador propio.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          const saved = readStash(chatKey);
          if (saved?.trim() && handler.current(saved) === true) dropStash(chatKey);
        });
      });
    }
    return () => {
      window.removeEventListener(COMPOSE_INSERT_EVENT, on);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [chatKey]);
}

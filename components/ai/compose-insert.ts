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

/** El borrador que dejó el asistente para un chat que todavía no está abierto (lo toma su composer al abrir). */
const stashKey = (chatKey: string) => `zs-compose-draft:${chatKey}`;

function takeStash(chatKey: string): string | null {
  try {
    const v = window.sessionStorage.getItem(stashKey(chatKey));
    if (v !== null) window.sessionStorage.removeItem(stashKey(chatKey));
    return v;
  } catch {
    return null;
  }
}

/**
 * Un borrador confirmado en el asistente: si el chat está abierto va ya al campo; si no, queda guardado en esta
 * pestaña del navegador (sessionStorage) y lo toma el composer de ese chat al abrirlo. Nunca se manda.
 */
export function deliverComposeDraft(chatKey: string, text: string): void {
  if (!text.trim()) return;
  try {
    window.sessionStorage.setItem(stashKey(chatKey), text);
  } catch {
    /* sin almacenamiento: solo si el chat está abierto */
  }
  requestComposeInsert(chatKey, text);
}

/** El composer de `chatKey` escucha los pedidos de insertar (un texto vacío no hace nada) y toma el borrador guardado al abrir. */
export function useComposeInsert(chatKey: string, onInsert: (text: string) => void): void {
  const handler = useRef(onInsert);
  handler.current = onInsert;
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ComposeInsertDetail>).detail;
      if (!d || d.chatKey !== chatKey || !d.text?.trim()) return;
      takeStash(chatKey);
      handler.current(d.text);
    };
    window.addEventListener(COMPOSE_INSERT_EVENT, on);
    // Un borrador del asistente que llegó con el chat cerrado.
    const saved = takeStash(chatKey);
    if (saved?.trim()) requestAnimationFrame(() => handler.current(saved));
    return () => window.removeEventListener(COMPOSE_INSERT_EVENT, on);
  }, [chatKey]);
}

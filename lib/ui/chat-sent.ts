'use client';

import { useEffect, useRef } from 'react';

/**
 * Lines e Inbox: se mandó un mensaje de WhatsApp desde el chat abierto. Como WhatsApp, la lista
 * sale de la búsqueda y vuelve a la bandeja (con ese chat arriba). Un aviso en la ventana: el chat
 * y la lista son componentes separados.
 */
export const CHAT_SENT_EVENT = 'zs:chat-sent';

export function notifyChatSent(chatId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<string>(CHAT_SENT_EVENT, { detail: chatId }));
}

export function useOnChatSent(cb: (chatId: string) => void) {
  const live = useRef(cb);
  live.current = cb;
  useEffect(() => {
    const on = (e: Event) => live.current((e as CustomEvent<string>).detail);
    window.addEventListener(CHAT_SENT_EVENT, on);
    return () => window.removeEventListener(CHAT_SENT_EVENT, on);
  }, []);
}

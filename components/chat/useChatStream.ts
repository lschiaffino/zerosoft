'use client';

import { useEffect, useRef } from 'react';

/**
 * Escucha el aviso SSE de Chat (/api/chat/stream) y llama a onChange cuando
 * algo cambió. Devuelve una ref "live": con el stream conectado el polling de
 * respaldo se puede espaciar; si se cae, EventSource reintenta solo y el
 * polling vuelve a su ritmo.
 */
export function useChatStream(url: string, onChange: () => void) {
  const live = useRef(false);
  const handler = useRef(onChange);
  handler.current = onChange;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(url);
    es.addEventListener('ready', () => {
      live.current = true;
    });
    es.addEventListener('events', () => handler.current());
    es.onerror = () => {
      live.current = false;
    };
    return () => {
      live.current = false;
      es.close();
    };
  }, [url]);
  return live;
}

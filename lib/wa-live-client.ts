'use client';

/**
 * Inbox y Lines (navegador): escucha el aviso en vivo de la lista de chats
 * (lib/wa-live.ts) y llama a `onChange` con los chats que cambiaron, juntando
 * los avisos de un momento en una sola llamada. Al reconectar o con un hueco
 * grande llama con [] (releer todo). SSE con polling corto de respaldo
 * (lib/realtime-client.ts).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useRealtime, type RealtimeMode } from './realtime-client';

interface LiveEvent {
  id: number;
  chatId: string;
}

/** Espera para juntar avisos seguidos (una tanda de mensajes) en una sola relectura. */
const GATHER_MS = 120;

/** `mode`: lo elige la página del servidor (WA_LIVE=poll fuerza el polling, para los tests). */
export function useWaLive(app: 'inbox' | 'groups', onChange: (chatIds: string[]) => void, mode?: RealtimeMode) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const pending = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useCallback((ids: string[]) => {
    const set = (pending.current ??= new Set());
    // Un aviso sin chat (o la reconexión) pide releer todo: se marca con ''.
    if (!ids.length) set.add('');
    for (const id of ids) set.add(id);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const got = pending.current;
      pending.current = null;
      if (!got) return;
      cb.current(got.has('') ? [] : [...got]);
    }, GATHER_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useRealtime<LiveEvent>({
    streamUrl: `/api/${app}/live`,
    pollUrl: `/api/${app}/live?poll=1`,
    cursor: 0,
    mode,
    // Con polling (de respaldo o forzado), cada 1,5 s con la pestaña visible.
    pollMs: 1500,
    onEvents: (events) => queue(events.some((e) => !e.chatId) ? [] : events.map((e) => e.chatId)),
    onConnect: () => queue([]),
    onReset: () => queue([]),
  });
}

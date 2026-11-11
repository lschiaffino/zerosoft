'use client';

/**
 * Inbox y Lines (navegador): consulta el aviso en vivo de la lista de chats
 * (lib/wa-live.ts) cada 3 s con la pestaña visible (oculta, casi nada; al
 * volver, en el acto) y llama a `onChange` con los chats que cambiaron,
 * juntando los avisos de un momento en una sola llamada. Con un hueco grande o
 * al volver de un corte llama con [] (releer todo). `live`: la consulta anda,
 * así la pantalla deja de consultar la lista cada pocos segundos.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useRealtime } from './realtime-client';

interface LiveEvent {
  id: number;
  chatId: string;
}

/** Cada cuánto se consulta con la pestaña visible. */
export const LIVE_POLL_MS = 3000;
/** Oculta: casi nunca (al volver a la pestaña se consulta en el acto). */
const HIDDEN_POLL_MS = 10 * 60_000;
/** Espera para juntar avisos seguidos (una tanda de mensajes) en una sola relectura. */
const GATHER_MS = 120;

export function useWaLive(app: 'inbox' | 'groups', onChange: (chatIds: string[]) => void): { live: boolean } {
  const cb = useRef(onChange);
  cb.current = onChange;
  const pending = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useCallback((ids: string[]) => {
    const set = (pending.current ??= new Set());
    // Un aviso sin chat (o la vuelta de un corte) pide releer todo: se marca con ''.
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
  const { status } = useRealtime<LiveEvent>({
    streamUrl: `/api/${app}/live`,
    pollUrl: `/api/${app}/live`,
    cursor: 0,
    // Polling por índice, sin SSE (ver lib/wa-live.ts).
    mode: 'poll',
    pollMs: LIVE_POLL_MS,
    hiddenPollMs: HIDDEN_POLL_MS,
    onEvents: (events) => queue(events.some((e) => !e.chatId) ? [] : events.map((e) => e.chatId)),
    onConnect: () => queue([]),
    onReset: () => queue([]),
  });
  return { live: status === 'polling' };
}

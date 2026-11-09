'use client';

import { useEffect, useRef, useState } from 'react';
import { offlineOwner, pendingWrites, type PendingWrite } from '@/lib/offline-fetch';

/**
 * Cambios de esta persona que esperan en la cola del service worker y cumplen
 * `match` (lib/offline-fetch.ts pendingWrites). Se vuelve a leer cada vez que
 * el worker avisa que la cola cambió (se encoló algo o se sincronizó).
 * `key` identifica el filtro: si cambia, se vuelve a leer.
 */
export function usePendingWrites(key: string, match: (pathname: string, method: string) => boolean): PendingWrite[] {
  const [rows, setRows] = useState<PendingWrite[]>([]);
  const matchRef = useRef(match);
  matchRef.current = match;
  useEffect(() => {
    let alive = true;
    const read = () =>
      void pendingWrites(offlineOwner(), (p, m) => matchRef.current(p, m)).then((next) => {
        if (alive) setRows((prev) => (prev.length === 0 && next.length === 0 ? prev : next));
      });
    read();
    const onMessage = (e: MessageEvent) => {
      const type = (e.data as { type?: string } | null)?.type;
      if (type === 'zs-queue' || type === 'zs-sync-done') read();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      alive = false;
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [key]);
  return rows;
}

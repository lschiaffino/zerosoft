'use client';

/** El tablero en el cliente: arranca con lo del servidor y se relee con cada cambio del feed o con "Actualizar". */
import { useCallback, useRef, useState } from 'react';
import type { RealtimeMode } from '@/lib/realtime-client';
import type { BoardData } from '@/lib/fleet/board';
import { useFleetLive } from './useFleetLive';

export function useBoard(initial: BoardData, mode?: RealtimeMode) {
  const [board, setBoard] = useState(initial);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const inflight = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const res = await fetch('/api/fleet/board', { cache: 'no-store' });
        if (res.ok) setBoard((await res.json()) as BoardData);
      } catch {
        /* sin red: queda lo que había */
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, []);

  const live = useFleetLive({ cursor: initial.cursor, mode, onChange: () => void reload() });

  const sync = useCallback(async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/fleet/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = (await res.json().catch(() => ({}))) as { board?: BoardData; error?: string };
      if (!res.ok) setError(body.error ?? 'sync_failed');
      else if (body.board) setBoard(body.board);
    } catch {
      setError('network');
    } finally {
      setSyncing(false);
    }
  }, []);

  return { board, setBoard, reload, sync, syncing, error, live };
}

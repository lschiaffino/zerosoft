'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimerView, VotingView } from '@/lib/board-workshop';
import type { BoardTrackCard } from '@/lib/board-track';

/** Sondeo del taller: más seguido con un timer o una votación en curso. */
const WORKSHOP_ACTIVE_MS = 4_000;
const WORKSHOP_IDLE_MS = 15_000;
/** Tarjetas de Track: el estado de un issue no cambia cada segundo. */
const TRACK_MS = 30_000;

export interface WorkshopState {
  timer: TimerView | null;
  voting: VotingView | null;
  /** Diferencia reloj del servidor − reloj local (ms), para la cuenta regresiva. */
  skew: number;
}

/** Corre `fn` cada `ms` mientras la pestaña está visible (y una vez al volver). */
export function usePoll(fn: () => Promise<void>, ms: number, enabled: boolean) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = () => {
      if (alive && document.visibilityState === 'visible') void fnRef.current();
    };
    tick();
    const h = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      clearInterval(h);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms, enabled]);
}

export function useWorkshop(boardId: string, enabled: boolean) {
  const [state, setState] = useState<WorkshopState>({ timer: null, voting: null, skew: 0 });
  const [error, setError] = useState(false);

  const apply = useCallback((data: { now: number; timer: TimerView | null; voting: VotingView | null }) => {
    setState({ timer: data.timer, voting: data.voting, skew: data.now - Date.now() });
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/boards/${boardId}/workshop`).catch(() => null);
    if (res?.ok) apply(await res.json());
  }, [boardId, apply]);

  const active = state.timer?.status === 'running' || state.timer?.status === 'paused' || state.voting?.status === 'open';
  usePoll(load, active ? WORKSHOP_ACTIVE_MS : WORKSHOP_IDLE_MS, enabled);

  /** Manda una acción ({ timer } o { vote }) y aplica el estado que vuelve. */
  const send = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setError(false);
      try {
        const res = await fetch(`/api/boards/${boardId}/workshop`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        apply(await res.json());
        return true;
      } catch {
        setError(true);
        void load();
        return false;
      }
    },
    [boardId, apply, load],
  );

  return { ...state, error, send, reload: load };
}

export function useTrackCards(boardId: string, enabled: boolean) {
  const [cards, setCards] = useState<BoardTrackCard[]>([]);
  const load = useCallback(async () => {
    const res = await fetch(`/api/boards/${boardId}/track`).catch(() => null);
    if (res?.ok) setCards(((await res.json()) as { cards: BoardTrackCard[] }).cards);
  }, [boardId]);
  usePoll(load, TRACK_MS, enabled);
  return { cards, setCards, reload: load };
}

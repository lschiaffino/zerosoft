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
  /** Modo privado: cada uno ve solo sus stickies hasta que se revelan. */
  privateMode: boolean;
  /** En modo privado: lo propio (completo) y dónde hay notas de los demás (sin texto). */
  drafts: { mine: Array<Record<string, unknown> & { id: string }>; others: Array<{ x: number; y: number; width: number; height: number }> } | null;
  /** Diferencia reloj del servidor − reloj local (ms), para la cuenta regresiva. */
  skew: number;
}

/** Corre `fn` cada `ms` mientras la pestaña está visible (y una vez al volver). */
export function usePoll(fn: () => Promise<void>, ms: number, enabled: boolean, skipFirst = false) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  /** El dato ya vino con la página: la primera vuelta no pide nada. */
  const skipRef = useRef(skipFirst);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = () => {
      if (alive && document.visibilityState === 'visible') void fnRef.current();
    };
    if (skipRef.current) skipRef.current = false;
    else tick();
    const h = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      clearInterval(h);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms, enabled]);
}

/**
 * `guestToken`: link de invitado con edición. Lee el timer, el modo privado y la
 * votación, y vota con `guestKey` (la clave de su navegador); nada más.
 */
export function useWorkshop(
  boardId: string,
  enabled: boolean,
  guestToken: string | null = null,
  guestKey: string | null = null,
  /** Estado que vino con la página (no se vuelve a pedir al abrir). */
  initial: { now: number; timer: TimerView | null; voting: VotingView | null; privateMode?: boolean; drafts?: WorkshopState['drafts'] } | null = null,
) {
  const base = guestToken ? `/api/boards/guest/${encodeURIComponent(guestToken)}/workshop` : `/api/boards/${boardId}/workshop`;
  const readUrl = guestToken && guestKey ? `${base}?k=${encodeURIComponent(guestKey)}` : base;
  const [state, setState] = useState<WorkshopState>(() =>
    initial
      ? { timer: initial.timer, voting: initial.voting, privateMode: Boolean(initial.privateMode), drafts: initial.drafts ?? null, skew: initial.now - Date.now() }
      : { timer: null, voting: null, privateMode: false, drafts: null, skew: 0 },
  );
  const [error, setError] = useState(false);

  const apply = useCallback((data: { now: number; timer: TimerView | null; voting: VotingView | null; privateMode?: boolean; drafts?: WorkshopState['drafts'] }) => {
    setState({ timer: data.timer, voting: data.voting, privateMode: Boolean(data.privateMode), drafts: data.drafts ?? null, skew: data.now - Date.now() });
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(readUrl).catch(() => null);
    if (res?.ok) apply(await res.json());
  }, [readUrl, apply]);

  const active = state.timer?.status === 'running' || state.timer?.status === 'paused' || state.voting?.status === 'open' || state.privateMode;
  usePoll(load, active ? WORKSHOP_ACTIVE_MS : WORKSHOP_IDLE_MS, enabled, Boolean(initial));

  /** Manda una acción ({ timer } o { vote }) y aplica el estado que vuelve. */
  const send = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setError(false);
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(guestToken ? { ...body, k: guestKey } : body),
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
    [base, guestToken, guestKey, apply, load],
  );

  return { ...state, error, send, reload: load };
}

export function useTrackCards(boardId: string, enabled: boolean, initial: BoardTrackCard[] | null = null) {
  const [cards, setCards] = useState<BoardTrackCard[]>(initial ?? []);
  const load = useCallback(async () => {
    const res = await fetch(`/api/boards/${boardId}/track`).catch(() => null);
    if (res?.ok) setCards(((await res.json()) as { cards: BoardTrackCard[] }).cards);
  }, [boardId]);
  usePoll(load, TRACK_MS, enabled, Boolean(initial));
  return { cards, setCards, reload: load };
}

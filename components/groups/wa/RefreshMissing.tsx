'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle, Close, Retry } from './icons';
import { finalState, replyState, type RefreshProgress, type RefreshReply, type RefreshState } from './refresh-state';

export type { RefreshProgress, RefreshReply, RefreshState };

/**
 * "Traer mensajes que faltan" (menú del chat, Inbox y Lines). Le pide al
 * teléfono lo anterior a los huecos y a los días antes del último mensaje
 * (lib/wa-history-gaps.ts, refreshChatHistory) y va mirando qué llegó
 * (refreshStatus) hasta poder decir qué pasó: cuántos trajo, que no faltaba
 * nada, que el teléfono no respondió, que la línea está desconectada, que la
 * línea llegó a su tope o que el gateway necesita la actualización.
 */

/** Entre miradas (ms). Unos 45 s en total: lo que espera el servidor (REFRESH_WAIT_MS) y un poco más. */
const POLLS = [1500, 2500, 3500, 5000, 6000, 8000, 9000, 10000];
/** Después de que el teléfono respondió, miradas más hasta que deja de llegar (Evolution manda una tanda por pedido). */
const SETTLE = [2500, 3000];
/** Lo que salió bien se va solo después de un rato. */
const HIDE_MS = 12_000;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * El pedido y su estado. `request` pide, `progress` mira cómo va, `reload` vuelve a traer los mensajes del chat
 * cuando llegaron nuevos. `chatKey` cambia con el chat: el estado no pasa de uno a otro.
 */
export function useRefreshMissing(chatKey: string, request: () => Promise<RefreshReply>, progress: () => Promise<RefreshProgress | null>, reload: () => void) {
  const [state, setState] = useState<RefreshState>('idle');
  const [count, setCount] = useState(0);
  const run_ = useRef(0);
  const fns = useRef({ request, progress, reload });
  fns.current = { request, progress, reload };
  useEffect(() => {
    run_.current++;
    setState('idle');
    setCount(0);
  }, [chatKey]);
  useEffect(
    () => () => {
      run_.current++;
    },
    [],
  );
  // Lo que salió bien se va solo.
  useEffect(() => {
    if (state !== 'done' && state !== 'none') return;
    const id = window.setTimeout(() => setState('idle'), HIDE_MS);
    return () => window.clearTimeout(id);
  }, [state]);

  const dismiss = useCallback(() => {
    run_.current++;
    setState('idle');
  }, []);

  const run = useCallback(async () => {
    const mine = ++run_.current;
    const still = () => run_.current === mine;
    setState('loading');
    setCount(0);
    const r = await fns.current.request().catch((): RefreshReply => ({ status: 0 }));
    if (!still()) return;
    const early = replyState(r);
    if (early) return setState(early);
    let added = 0;
    let answered = !!r.answered;
    const look = async (): Promise<boolean> => {
      const p = await fns.current.progress().catch(() => null);
      if (!still()) return false;
      if (p && p.state !== 'idle') {
        answered ||= !!p.answered;
        const n = Math.max(0, p.added ?? 0);
        if (n > added) {
          added = n;
          setCount(n);
          fns.current.reload();
        }
      }
      return true;
    };
    // El proveedor ya respondió (o lo trajo en el momento): una mirada y listo.
    const waits = answered ? [0] : POLLS;
    for (const ms of waits) {
      if (ms) await sleep(ms);
      if (!still() || !(await look())) return;
      if (answered) break;
    }
    // Respondió: se espera un poco por si llegan más tandas (una por ancla).
    if (answered) {
      for (const ms of SETTLE) {
        const before = added;
        await sleep(ms);
        if (!still() || !(await look())) return;
        if (added === before) break;
      }
    }
    if (still()) setState(finalState(added, answered));
  }, []);

  return { state, count, run, dismiss };
}

/** La franja con lo que está pasando (arriba de la conversación). Nada mientras no se pidió. */
export default function RefreshMissingBar({ state, count, onRetry, onDismiss }: { state: RefreshState; count: number; onRetry: () => void; onDismiss: () => void }) {
  const tw = useTranslations('groups.wa');
  if (state === 'idle') return null;
  const text =
    state === 'loading'
      ? tw('refreshLoading')
      : state === 'done'
        ? tw('refreshDone', { count })
        : state === 'none'
          ? tw('refreshNone')
          : state === 'noanswer'
            ? tw('refreshNoAnswer')
            : state === 'offline'
              ? tw('refreshOffline')
              : state === 'limited'
                ? tw('refreshLimited')
                : state === 'outdated'
                  ? tw('refreshOutdated')
                  : tw('refreshError');
  const retry = state === 'noanswer' || state === 'error';
  const bad = state === 'noanswer' || state === 'error' || state === 'outdated' || state === 'offline' || state === 'limited';
  return (
    <div className={`gr-banner wa-strip wa-refresh is-${state}${bad ? ' is-warn' : ''}`} role="status" aria-live="polite" data-testid="wa-refresh-missing" data-state={state}>
      <span className="wa-refresh-text">
        {state === 'loading' ? <Retry size={14} className="is-spinning" /> : state === 'done' || state === 'none' ? <CheckCircle size={14} /> : null}
        <span>{text}</span>
      </span>
      <span className="wa-refresh-actions">
        {retry && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            {tw('refreshRetry')}
          </button>
        )}
        {state !== 'loading' && (
          <button type="button" className="wa-icon-btn wa-refresh-close" onClick={onDismiss} aria-label={tw('refreshDismiss')} title={tw('refreshDismiss')}>
            <Close size={16} />
          </button>
        )}
      </span>
    </div>
  );
}

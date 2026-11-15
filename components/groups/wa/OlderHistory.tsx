'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Retry } from './icons';

/**
 * "Cargar mensajes anteriores" (Inbox y Lines): arriba de la conversación,
 * cuando lo que tenemos guardado se terminó. Le pide al teléfono los mensajes
 * anteriores de ese chat (lib/wa-history-gaps.ts); llegan como historial y se
 * suman arriba sin mover lo que se está leyendo.
 */

/** Sin pedir, pidiendo, el teléfono no tiene más, falló (se puede reintentar), hay que esperar, o la línea está desvinculada. */
export type OlderState = 'idle' | 'loading' | 'none' | 'error' | 'limited' | 'offline';

/** Lo que respondió el servidor al pedido. */
export interface OlderReply {
  status: number;
  /** Lo que ya llegó (un proveedor que responde en el momento). */
  delivered?: number;
  /** Lo trae el webhook: hay que esperar a que aparezca. */
  pending?: boolean;
  /** El teléfono no tiene mensajes anteriores. */
  none?: boolean;
  /** Hay un pedido recién hecho de este chat: el próximo puede salir en `retryInMs`. */
  recent?: boolean;
  retryInMs?: number;
}

/** Cada cuánto se mira si llegó lo pedido (ms desde el pedido). Unos 25 s en total. */
const WAITS = [1200, 2500, 4000, 6000, 8000, 12000];

/**
 * El pedido y su estado. `request` le pide al servidor; `loadStored` trae de
 * nuestra base lo anterior a lo que hay en pantalla y devuelve cuántos sumó.
 * `chatKey` cambia con el chat: el estado no pasa de uno a otro.
 */
export function useOlderHistory(chatKey: string, request: () => Promise<OlderReply>, loadStored: () => Promise<number>) {
  const [state, setState] = useState<OlderState>('idle');
  const busy = useRef(false);
  const key = useRef(chatKey);
  const fns = useRef({ request, loadStored });
  fns.current = { request, loadStored };
  useEffect(() => {
    key.current = chatKey;
    busy.current = false;
    setState('idle');
  }, [chatKey]);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = key.current;
    const still = () => key.current === mine;
    setState('loading');
    try {
      let r = await fns.current.request().catch((): OlderReply => ({ status: 0 }));
      // Dos toques seguidos: el servidor espacia los pedidos de un chat. Se espera lo que diga y se pide de nuevo
      // (lo que ya haya llegado del pedido anterior entra igual, abajo).
      for (let i = 0; i < 2 && still() && r.recent && r.retryInMs && r.retryInMs <= 20_000; i++) {
        await new Promise((res) => setTimeout(res, (r.retryInMs ?? 0) + 150));
        if (!still()) return;
        if ((await fns.current.loadStored().catch(() => 0)) > 0) return setState('idle');
        r = await fns.current.request().catch((): OlderReply => ({ status: 0 }));
      }
      if (!still()) return;
      if (r.status === 409) return setState('offline');
      if (r.status === 429) return setState('limited');
      if (r.status < 200 || r.status >= 300) return setState('error');
      // Lo que ya llegó (o lo que otro pedido dejó guardado) entra enseguida; si viene por el webhook, se espera.
      const waits = r.none || !r.pending ? [0] : WAITS;
      for (const ms of waits) {
        if (ms) await new Promise((res) => setTimeout(res, ms));
        if (!still()) return;
        const added = await fns.current.loadStored().catch(() => 0);
        if (!still()) return;
        if (added > 0) return setState('idle');
      }
      setState('none');
    } finally {
      if (still()) busy.current = false;
    }
  }, []);

  return { state, run };
}

export default function OlderHistoryChip({ state, offline, onLoad }: { state: OlderState; /** La línea está desvinculada (no se puede pedir). */ offline?: boolean; onLoad: () => void }) {
  const tw = useTranslations('groups.wa');
  const shown: OlderState = offline ? 'offline' : state;
  const label =
    shown === 'loading'
      ? tw('olderLoading')
      : shown === 'none'
        ? tw('olderNone')
        : shown === 'error'
          ? tw('olderError')
          : shown === 'limited'
            ? tw('olderLimited')
            : shown === 'offline'
              ? tw('olderOffline')
              : tw('olderLoad');
  return (
    <div className="wa-older-history" data-testid="wa-older-history" data-state={shown} aria-live="polite">
      {shown === 'none' ? (
        // No hay más: un aviso, no un botón (no hay nada que apretar).
        <span className="wa-older-chip is-note">{label}</span>
      ) : (
        <button type="button" className={`wa-older-chip is-${shown}`} onClick={onLoad} disabled={shown === 'loading' || shown === 'offline'} aria-busy={shown === 'loading' || undefined}>
          <Retry size={14} className={shown === 'loading' ? 'is-spinning' : undefined} />
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}

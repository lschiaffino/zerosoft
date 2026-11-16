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

/**
 * Sin pedir, pidiendo, el teléfono no tiene más, falló (se puede reintentar),
 * el teléfono no contestó a tiempo (se puede reintentar), la línea llegó a su
 * tope de pedidos, o la línea está desvinculada.
 */
export type OlderState = 'idle' | 'loading' | 'none' | 'error' | 'noanswer' | 'limited' | 'offline';

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

/** Cada cuánto se mira si llegó lo pedido (ms entre miradas). Unos 34 s en total. */
const WAITS = [1200, 2500, 4000, 6000, 8000, 12000];

/**
 * El pedido y su estado. `request` le pide al servidor; `loadStored` trae de
 * nuestra base lo anterior a lo que hay en pantalla. `firstId` es el mensaje
 * más viejo en pantalla: si cambia, llegaron anteriores (por este pedido o por
 * la relectura periódica del chat), y eso es lo que decide que el pedido
 * trajo algo. `chatKey` cambia con el chat: el estado no pasa de uno a otro.
 */
export function useOlderHistory(chatKey: string, firstId: string, request: () => Promise<OlderReply>, loadStored: () => Promise<number>) {
  const [state, setState] = useState<OlderState>('idle');
  const busy = useRef(false);
  const alive = useRef(true);
  const key = useRef(chatKey);
  const first = useRef(firstId);
  first.current = firstId;
  const fns = useRef({ request, loadStored });
  fns.current = { request, loadStored };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    key.current = chatKey;
    busy.current = false;
    setState('idle');
  }, [chatKey]);
  // Entraron mensajes anteriores (por donde sea): lo que decía la ficha ("no hay más", un error) ya no vale.
  useEffect(() => {
    if (!busy.current) setState((s) => (s === 'none' || s === 'error' || s === 'noanswer' ? 'idle' : s));
  }, [firstId]);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = key.current;
    const start = first.current;
    const still = () => alive.current && key.current === mine;
    /** ¿Hay mensajes anteriores a los que había al tocar? Los trae de lo guardado si todavía no están en pantalla. */
    const arrived = async () => {
      if (first.current !== start) return true;
      const added = await fns.current.loadStored().catch(() => 0);
      return added > 0 || first.current !== start;
    };
    setState('loading');
    try {
      let r = await fns.current.request().catch((): OlderReply => ({ status: 0 }));
      // Dos toques seguidos: el servidor espacia los pedidos de un chat. Se espera lo que diga y se pide de nuevo
      // (lo que ya haya llegado del pedido anterior entra igual).
      for (let i = 0; i < 2 && still() && r.recent && r.retryInMs && r.retryInMs <= 20_000; i++) {
        await new Promise((res) => setTimeout(res, (r.retryInMs ?? 0) + 150));
        if (!still()) return;
        if (await arrived()) return void (still() && setState('idle'));
        if (!still()) return;
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
        if (await arrived()) return void (still() && setState('idle'));
        if (!still()) return;
      }
      // "No hay más" solo cuando lo dijo el servidor o el proveedor contestó en el momento sin nada. Si había que
      // esperar al teléfono y no llegó nada, no contestó (apagado, sin señal): se puede reintentar.
      setState(r.none || !r.pending ? 'none' : 'noanswer');
    } finally {
      if (key.current === mine) busy.current = false;
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
          : shown === 'noanswer'
            ? tw('olderNoAnswer')
            : shown === 'limited'
              ? tw('olderLimited')
              : shown === 'offline'
                ? tw('olderOffline')
                : tw('olderLoad');
  // Siempre el mismo botón (el foco del teclado no se pierde al cambiar de estado). Cuando no hay nada que apretar
  // ("no hay más", línea desvinculada) queda como aviso: aria-disabled, sin acción, y el texto dice por qué.
  const inert = shown === 'none' || shown === 'offline' || shown === 'loading';
  return (
    <div className="wa-older-history" data-testid="wa-older-history" data-state={shown}>
      <button
        type="button"
        className={`wa-older-chip is-${shown}`}
        onClick={inert ? undefined : onLoad}
        aria-disabled={inert || undefined}
        aria-busy={shown === 'loading' || undefined}
      >
        {shown !== 'none' && <Retry size={14} className={shown === 'loading' ? 'is-spinning' : undefined} />}
        <span>{label}</span>
      </button>
    </div>
  );
}

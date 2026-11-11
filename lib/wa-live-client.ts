'use client';

/**
 * Inbox y Lines (navegador): el aviso en vivo de los chats (lib/wa-live.ts).
 *
 * Una sola conexión por app y por pestaña, compartida por la lista y el chat
 * abierto: un stream SSE que avisa en el momento qué chat cambió (solo ids; el
 * contenido se relee por las rutas de siempre). Si el stream no anda (un proxy
 * que lo corta, el servidor que no lo sostiene), cae sola a consultar el mismo
 * aviso cada LIVE_POLL_MS y cada tanto vuelve a probar el stream. Con la
 * pestaña oculta más de un minuto se cierra; al volver se reabre desde su
 * cursor y trae lo que pasó mientras tanto (lib/realtime-client.ts).
 *
 * - useWaLive: la lista. Junta los avisos de un momento en una sola relectura.
 * - useWaLiveChat: el chat abierto. Sin espera: relee apenas llega su aviso.
 *
 * Al conectar por primera vez y al reconectar se pide releer todo: lo que pasó
 * entre que se cargó la página y que se abrió la conexión no se pierde.
 */
import { useEffect, useRef, useState } from 'react';
import { RealtimeClient, type RealtimeStatus } from './realtime-client';

interface LiveEvent {
  id: number;
  chatId: string;
}

export type WaLiveApp = 'inbox' | 'groups';

/** Cada cuánto se consulta si el stream no anda (pestaña visible): lo mismo que antes de tener stream. */
export const LIVE_POLL_MS = 3000;
/** Oculta: casi nunca (al volver a la pestaña se consulta en el acto). */
const HIDDEN_POLL_MS = 10 * 60_000;
/** Espera para juntar avisos seguidos (una tanda de mensajes) en una sola relectura de la lista. */
export const GATHER_MS = 80;

/** Lo que recibe quien escucha: los chats que cambiaron; [] = releer todo. */
type Listener = (chatIds: string[]) => void;

interface Hub {
  client: RealtimeClient<LiveEvent>;
  listeners: Set<Listener>;
  statusListeners: Set<(s: RealtimeStatus) => void>;
  status: RealtimeStatus;
  /** Ya conectó alguna vez (la primera conexión también pide releer). */
  primed: boolean;
}

const hubs = new Map<WaLiveApp, Hub>();

function emit(hub: Hub, ids: string[]) {
  for (const fn of [...hub.listeners]) fn(ids);
}

function openHub(app: WaLiveApp): Hub {
  const hub: Hub = { listeners: new Set(), statusListeners: new Set(), status: 'connecting', primed: false } as unknown as Hub;
  hub.client = new RealtimeClient<LiveEvent>({
    streamUrl: `/api/${app}/live`,
    pollUrl: `/api/${app}/live`,
    cursor: 0,
    pollMs: LIVE_POLL_MS,
    hiddenPollMs: HIDDEN_POLL_MS,
    heartbeatMs: 15_000,
    onEvents: (events) => emit(hub, events.some((e) => !e.chatId) ? [] : [...new Set(events.map((e) => e.chatId))]),
    onConnect: () => emit(hub, []),
    onReset: () => emit(hub, []),
    onStatus: (s) => {
      hub.status = s;
      // Primera vez que anda: lo que pasó desde que se cargó la página se trae ahora.
      if ((s === 'live' || s === 'polling') && !hub.primed) {
        hub.primed = true;
        emit(hub, []);
      }
      for (const fn of [...hub.statusListeners]) fn(s);
    },
  });
  hub.client.start();
  return hub;
}

/** Se suma a la conexión de la app (la abre si no había); al salir el último, se cierra. Exportada para los tests. */
export function joinWaLive(app: WaLiveApp, onChange: Listener, onStatus: (s: RealtimeStatus) => void): () => void {
  let hub = hubs.get(app);
  if (!hub) {
    hub = openHub(app);
    hubs.set(app, hub);
  }
  const h = hub;
  h.listeners.add(onChange);
  h.statusListeners.add(onStatus);
  onStatus(h.status);
  return () => {
    h.listeners.delete(onChange);
    h.statusListeners.delete(onStatus);
    if (h.listeners.size === 0) {
      h.client.stop();
      if (hubs.get(app) === h) hubs.delete(app);
    }
  };
}

const isLive = (s: RealtimeStatus) => s === 'live' || s === 'polling';

/**
 * La lista: llama a `onChange` con los chats que cambiaron, juntando los
 * avisos de un momento en una sola llamada ([] = releer todo). `live`: el
 * aviso anda (por stream o por consulta), así la pantalla deja de consultar la
 * lista cada pocos segundos.
 */
export function useWaLive(app: WaLiveApp, onChange: (chatIds: string[]) => void): { live: boolean } {
  const cb = useRef(onChange);
  cb.current = onChange;
  const [live, setLive] = useState(false);
  useEffect(() => {
    let pending: Set<string> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const leave = joinWaLive(
      app,
      (ids) => {
        const set = (pending ??= new Set());
        // Un aviso sin chat (o la vuelta de un corte) pide releer todo: se marca con ''.
        if (!ids.length) set.add('');
        for (const id of ids) set.add(id);
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          const got = pending;
          pending = null;
          if (got) cb.current(got.has('') ? [] : [...got]);
        }, GATHER_MS);
      },
      (s) => setLive(isLive(s)),
    );
    return () => {
      leave();
      if (timer) clearTimeout(timer);
    };
  }, [app]);
  return { live };
}

/**
 * El chat abierto: llama a `onChange` apenas llega un aviso de ese chat (o un
 * pedido de releer todo), sin espera. Si llegan varios mientras una relectura
 * está en curso, corre una sola más al terminar. `live`: el aviso anda, así el
 * chat deja de consultarse cada pocos segundos.
 */
export function useWaLiveChat(app: WaLiveApp, chatId: string | null | undefined, onChange: () => void | Promise<unknown>): { live: boolean } {
  const cb = useRef(onChange);
  cb.current = onChange;
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!chatId) return;
    const run = coalesced(() => cb.current());
    return joinWaLive(
      app,
      (ids) => {
        if (!ids.length || ids.includes(chatId)) run();
      },
      (s) => setLive(isLive(s)),
    );
  }, [app, chatId]);
  return { live: live && !!chatId };
}

/**
 * Corre `fn` ya; si la llaman mientras corre, corre una vez más al terminar
 * (nunca dos a la vez, nunca se pierde el último pedido).
 */
export function coalesced(fn: () => void | Promise<unknown>): () => void {
  let running = false;
  let again = false;
  const go = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void Promise.resolve()
      .then(fn)
      .catch(() => undefined)
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          go();
        }
      });
  };
  return go;
}

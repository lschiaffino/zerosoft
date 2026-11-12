'use client';

/**
 * Inbox y Lines (navegador): el aviso en vivo de los chats (lib/wa-live.ts).
 *
 * Una sola conexión por app y por pestaña, compartida por la lista y el chat
 * abierto. Si el servidor tiene el stream habilitado para este dueño, es un
 * stream SSE que avisa en el momento qué chat cambió (solo ids; el contenido
 * se relee por las rutas de siempre); si no, o si el stream no anda (un proxy
 * que lo corta), consulta el mismo aviso cada LIVE_POLL_MS. Con la
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

/** 'chat': cambió algo que la lista muestra. 'msg': algo de adentro del chat (tildes, reacciones…) que la lista no. */
export type WaLiveKind = 'chat' | 'msg';

interface LiveEvent {
  id: number;
  chatId: string;
  kind?: WaLiveKind;
}

export type WaLiveApp = 'inbox' | 'groups';

/** Cada cuánto se consulta si no hay stream (pestaña visible): lo mismo que antes de tener stream. */
export const LIVE_POLL_MS = 3000;
/** Oculta: casi nunca (al volver a la pestaña se consulta en el acto). */
const HIDDEN_POLL_MS = 10 * 60_000;
/** Espera para juntar avisos seguidos (el del mensaje y el de su chat) en una sola relectura de la lista. */
export const GATHER_MS = 80;
/** Piso entre dos relecturas de la lista: con muchos avisos seguidos, a lo sumo una por segundo. */
export const LIST_FLOOR_MS = 1000;

/** Un cambio: qué chat y si mueve la lista. null = releer todo (primera conexión, vuelta de un corte, hueco grande). */
export type WaLiveChange = Array<{ chatId: string; kind: WaLiveKind }> | null;
type Listener = (change: WaLiveChange) => void;

interface Hub {
  client: RealtimeClient<LiveEvent> | null;
  listeners: Set<Listener>;
  statusListeners: Set<(s: RealtimeStatus) => void>;
  status: RealtimeStatus;
  /** Ya conectó alguna vez (la primera conexión también pide releer). */
  primed: boolean;
  closed: boolean;
  boot: ReturnType<typeof setTimeout> | null;
}

const hubs = new Map<WaLiveApp, Hub>();

/** Un id por pestaña (por carga de la página): el servidor reemplaza la conexión anterior de la misma pestaña. */
const TAB = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

function emit(hub: Hub, change: WaLiveChange) {
  for (const fn of [...hub.listeners]) fn(change);
}

function setStatus(hub: Hub, s: RealtimeStatus) {
  hub.status = s;
  // Primera vez que anda: lo que pasó desde que se cargó la página se trae ahora.
  if ((s === 'live' || s === 'polling') && !hub.primed) {
    hub.primed = true;
    emit(hub, null);
  }
  for (const fn of [...hub.statusListeners]) fn(s);
}

function connect(hub: Hub, app: WaLiveApp, cursor: number, stream: boolean) {
  hub.client = new RealtimeClient<LiveEvent>({
    streamUrl: `/api/${app}/live?tab=${TAB}`,
    pollUrl: `/api/${app}/live`,
    cursor,
    // Sin stream habilitado para este dueño no se lo intenta: consulta, y nada más.
    mode: stream ? undefined : 'poll',
    pollMs: LIVE_POLL_MS,
    hiddenPollMs: HIDDEN_POLL_MS,
    heartbeatMs: 15_000,
    // El servidor cierra cada 4 minutos y dice hasta dónde mandó: se sigue desde ahí sin releer todo.
    resumeOnBye: true,
    onEvents: (events) => {
      if (events.some((e) => !e.chatId)) return emit(hub, null);
      const byChat = new Map<string, WaLiveKind>();
      for (const e of events) byChat.set(e.chatId, byChat.get(e.chatId) === 'chat' || e.kind !== 'msg' ? 'chat' : 'msg');
      emit(hub, [...byChat].map(([chatId, kind]) => ({ chatId, kind })));
    },
    onConnect: () => emit(hub, null),
    onReset: () => emit(hub, null),
    onStatus: (s) => setStatus(hub, s),
  });
  hub.client.start();
}

/**
 * Abre la conexión de la app. Primero una consulta: trae el cursor y si este
 * dueño tiene el stream habilitado (el servidor lo decide; apagado por
 * defecto). Con stream, sigue por ahí desde ese cursor; sin él, consulta.
 */
function openHub(app: WaLiveApp): Hub {
  const hub: Hub = { client: null, listeners: new Set(), statusListeners: new Set(), status: 'connecting', primed: false, closed: false, boot: null };
  let wait = 2000;
  const boot = async () => {
    hub.boot = null;
    if (hub.closed) return;
    try {
      const res = await fetch(`/api/${app}/live?cursor=0`, { cache: 'no-store', ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(15_000) } : {}) });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { cursor?: number; stream?: boolean };
      if (hub.closed) return;
      connect(hub, app, typeof data.cursor === 'number' ? data.cursor : 0, data.stream === true && typeof EventSource !== 'undefined');
    } catch {
      if (hub.closed) return;
      // Sin red o sin sesión todavía: se reintenta con espera creciente (hasta 30 s).
      setStatus(hub, 'offline');
      hub.boot = setTimeout(() => void boot(), wait);
      wait = Math.min(30_000, wait * 2);
    }
  };
  void boot();
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
      h.closed = true;
      if (h.boot) clearTimeout(h.boot);
      h.client?.stop();
      if (hubs.get(app) === h) hubs.delete(app);
    }
  };
}

const isLive = (s: RealtimeStatus) => s === 'live' || s === 'polling';

/**
 * La lista: llama a `onChange` cuando cambió algo que la lista muestra (un
 * mensaje nuevo, sin leer, asignación, fijar, archivar, escribiendo…) o hay
 * que releer todo. Lo de adentro de un chat (tildes de un mensaje que no es el
 * último, reacciones, votos) no la toca. Nunca corre dos relecturas a la vez
 * ni corta una en curso: si llegan avisos mientras relee, corre una más al
 * terminar, y entre el arranque de una y el de la siguiente pasa al menos un
 * segundo. `live`: el aviso anda (por stream o por consulta), así la pantalla
 * deja de consultar la lista cada pocos segundos.
 */
export function useWaLive(app: WaLiveApp, onChange: (chatIds: string[]) => void | Promise<unknown>): { live: boolean } {
  const cb = useRef(onChange);
  cb.current = onChange;
  const [live, setLive] = useState(false);
  useEffect(() => {
    let pending: Set<string> | null = null;
    const run = paced(
      () => {
        const got = pending;
        pending = null;
        if (!got) return;
        return cb.current(got.has('') ? [] : [...got]);
      },
      LIST_FLOOR_MS,
      GATHER_MS,
    );
    const leave = joinWaLive(
      app,
      (change) => {
        const ids = change === null ? [''] : change.filter((c) => c.kind === 'chat').map((c) => c.chatId);
        if (!ids.length) return;
        const set = (pending ??= new Set());
        for (const id of ids) set.add(id);
        run();
      },
      (s) => setLive(isLive(s)),
    );
    return () => {
      leave();
      run.cancel();
    };
  }, [app]);
  return { live };
}

/**
 * El chat abierto: llama a `onChange` apenas llega un aviso de ese chat (de la
 * lista o de adentro) o un pedido de releer todo, sin espera. Si llegan varios
 * mientras una relectura está en curso, corre una sola más al terminar.
 * `live`: el aviso anda, así el chat deja de consultarse cada pocos segundos.
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
      (change) => {
        if (change === null || change.some((c) => c.chatId === chatId)) run();
      },
      (s) => setLive(isLive(s)),
    );
  }, [app, chatId]);
  return { live: live && !!chatId };
}

/**
 * "Escribiendo…" no puede quedar pegado: el servidor avisa cuando empieza y
 * cada tanto mientras sigue, pero no cuando la otra persona simplemente deja
 * de escribir. Pasados `ms` desde la última vez que se supo (`stamp`), la
 * pantalla lo apaga sola.
 */
export function useExpiry(active: boolean, stamp: unknown, ms: number, onExpire: () => void): void {
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => cb.current(), ms);
    return () => clearTimeout(id);
  }, [active, stamp, ms]);
}

/** Cuánto dura "escribiendo…" en pantalla sin que llegue otro aviso (lo mismo que le da el servidor). */
export const PRESENCE_EXPIRY_MS = 25_000;

/**
 * Corre `fn` ya; si la llaman mientras corre, corre una vez más al terminar
 * (nunca dos a la vez, nunca se pierde el último pedido).
 */
export function coalesced(fn: () => void | Promise<unknown>): () => void {
  return paced(fn, 0, 0);
}

/**
 * Como `coalesced`, con ritmo: espera `leadMs` antes de arrancar (junta lo que
 * llega pegado) y deja pasar al menos `floorMs` entre el arranque de una
 * corrida y el de la siguiente. Nunca dos a la vez, nunca corta una en curso,
 * y lo último que se pidió siempre termina corriendo.
 */
export function paced(fn: () => void | Promise<unknown>, floorMs: number, leadMs: number): (() => void) & { cancel: () => void } {
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastStart = -Infinity;
  let cancelled = false;
  const start = () => {
    timer = null;
    if (cancelled) return;
    running = true;
    again = false;
    lastStart = Date.now();
    void Promise.resolve()
      .then(fn)
      .catch(() => undefined)
      .finally(() => {
        running = false;
        if (again) schedule();
      });
  };
  const schedule = () => {
    if (cancelled || timer) return;
    const wait = Math.max(leadMs, lastStart + floorMs - Date.now());
    if (wait <= 0) start();
    else timer = setTimeout(start, wait);
  };
  const go = () => {
    if (running) {
      again = true;
      return;
    }
    schedule();
  };
  go.cancel = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return go;
}

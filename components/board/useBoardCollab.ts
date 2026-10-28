'use client';

/**
 * Multiplayer de la pizarra en el navegador. Sobre el tiempo real de
 * lib/realtime-client.ts (SSE con polling de respaldo):
 *  - manda, como mucho cada ~100 ms y solo si algo cambió, el cursor, la
 *    selección, la parte del lienzo que se ve y los elementos editados;
 *  - aplica lo que manda el resto (merge por elemento de Excalidraw, sin
 *    entrar al deshacer de esta pestaña) y dibuja sus cursores con nombre;
 *  - seguir a alguien (clic en su avatar o "traer a todos") mueve la vista a
 *    la que ve esa persona;
 *  - avisa cuando otro guarda (`onSaved`) para traer la versión guardada.
 * La persistencia sigue siendo el autosave con versión de BoardEditor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtime, type RealtimeStatus } from '@/lib/realtime-client';
import {
  markReceived,
  newSocketId,
  prunePeers,
  takeChangedBytes,
  toCollaborator,
  uniquePeople,
  visibleBounds,
  withoutGenerated,
  type Broadcasted,
  type CollabEl,
  type Peer,
  type PeerUser,
} from '@/lib/board-collab';
import type { CanvasApi } from './ExcalidrawCanvas';

const SEND_EVERY_MS = 100;
const HEARTBEAT_MS = 10_000;

interface LiveEvent {
  id: number;
  kind: 'update' | 'presence' | 'summon' | 'leave' | 'saved' | 'access';
  socketId: string;
  user: PeerUser | null;
  payload: {
    presence?: { pointer?: Peer['pointer']; button?: Peer['button']; selected?: string[]; bounds?: Peer['bounds']; idle?: boolean };
    elements?: CollabEl[];
    version?: number;
    presenting?: boolean;
  };
}

export interface Summon {
  socketId: string;
  name: string;
  presenting: boolean;
}

export function useBoardCollab(opts: {
  boardId: string;
  guestToken: string | null;
  api: CanvasApi | null;
  canEdit: boolean;
  guestLabel: string;
  /** Lo que cambió en el lienzo por otro ya se aplicó: el editor recalcula su firma (no cuenta como edición local). */
  onRemoteApplied: () => void;
  /** Otro guardó la versión `version`. */
  onSaved: (version: number, by: string | null) => void;
  /** Reconexión o hueco grande: conviene traer la escena guardada. */
  onResync: () => void;
  /** Se perdió el acceso a la pizarra (lo sacaron o la borraron). */
  onRevoked: () => void;
}) {
  const { boardId, guestToken, api, canEdit, guestLabel } = opts;
  const handlers = useRef(opts);
  handlers.current = opts;
  /** Id de pestaña que elige el navegador; el servidor lo ata a quien lo manda y devuelve el definitivo. */
  const socketId = useMemo(() => newSocketId(), []);
  const boundRef = useRef<string | null>(null);
  /** ¿El evento es de esta pestaña? (antes de saber el id atado, por el sufijo). */
  const isMine = useCallback((sid: string) => sid === boundRef.current || sid.endsWith(`-${socketId}`), [socketId]);
  const query = guestToken ? `guest=${encodeURIComponent(guestToken)}` : `board=${encodeURIComponent(boardId)}`;
  const url = `/api/boards/live?${query}`;

  const peersRef = useRef<Map<string, Peer>>(new Map());
  const [people, setPeople] = useState<Peer[]>([]);
  const [summon, setSummon] = useState<Summon | null>(null);
  /** A quién se sigue ahora (socket), espejo de appState.userToFollow. */
  const followRef = useRef<string | null>(null);
  const [following, setFollowing] = useState<{ socketId: string; name: string } | null>(null);
  const sentRef = useRef<Broadcasted>(new Map());
  const presenceRef = useRef<NonNullable<LiveEvent['payload']['presence']>>({});
  const dirtyPresence = useRef(false);
  const dirtyElements = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const lastSent = useRef(0);
  const stopped = useRef(false);

  const guestLabelRef = useRef(guestLabel);
  guestLabelRef.current = guestLabel;

  /** Pasa los colaboradores a Excalidraw (cursores, selección, avatares arriba a la derecha). */
  const renderPeers = useCallback(() => {
    const a = handlers.current.api;
    const map = new Map<string, Record<string, unknown>>();
    for (const p of peersRef.current.values()) map.set(p.socketId, toCollaborator(p, guestLabelRef.current));
    setPeople(uniquePeople(peersRef.current.values()));
    a?.updateScene({ collaborators: map as never, captureUpdate: 'NEVER' as never });
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ socketId, ...body }),
      }).catch(() => null);
      if (res?.ok) {
        const data = (await res.json().catch(() => null)) as { socketId?: string } | null;
        if (data?.socketId) boundRef.current = data.socketId;
      }
      return res?.ok ?? false;
    },
    [url, socketId],
  );

  /** Manda lo pendiente (presencia y/o elementos) en un solo POST, en orden. */
  const flush = useCallback(async () => {
    timerRef.current = null;
    if (stopped.current) return;
    if (inFlight.current) {
      timerRef.current = setTimeout(() => void flush(), SEND_EVERY_MS);
      return;
    }
    const a = handlers.current.api;
    const body: Record<string, unknown> = {};
    if (dirtyElements.current && a && handlers.current.canEdit) {
      dirtyElements.current = false;
      // Hasta ~30 KB por tick (el servidor corta en 32 KB); lo que queda sale en el próximo.
      const changed = takeChangedBytes(a.getSceneElementsIncludingDeleted() as CollabEl[], sentRef.current);
      if (changed.elements.length) body.elements = changed.elements;
      if (changed.rest) dirtyElements.current = true;
    }
    if (dirtyPresence.current || body.elements) {
      dirtyPresence.current = false;
      body.presence = presenceRef.current;
    }
    if (!body.presence && !body.elements) return;
    inFlight.current = true;
    lastSent.current = Date.now();
    const ok = await post(body);
    inFlight.current = false;
    if (!ok && body.elements && !stopped.current) {
      // No llegó: se vuelve a mandar (el guardado igual lo persiste).
      for (const el of body.elements as CollabEl[]) sentRef.current.delete(el.id);
      dirtyElements.current = true;
    }
    if (dirtyPresence.current || dirtyElements.current) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  const schedule = useCallback(() => {
    if (timerRef.current || stopped.current) return;
    const wait = Math.max(0, SEND_EVERY_MS - (Date.now() - lastSent.current));
    timerRef.current = setTimeout(() => void flush(), wait);
  }, [flush]);

  /** Cursor (Excalidraw lo avisa en cada movimiento). */
  const onPointer = useCallback(
    (p: { pointer: { x: number; y: number; tool: 'pointer' | 'laser' }; button: 'down' | 'up' }) => {
      presenceRef.current = { ...presenceRef.current, pointer: p.pointer, button: p.button, idle: false };
      dirtyPresence.current = true;
      schedule();
    },
    [schedule],
  );

  /** Cambio del lienzo (local): elementos editados y selección. */
  const onCanvasChange = useCallback(
    (appState: Record<string, unknown>) => {
      const selected = Object.keys((appState.selectedElementIds as Record<string, boolean>) ?? {});
      const prev = presenceRef.current.selected ?? [];
      if (selected.length !== prev.length || selected.some((id, i) => id !== prev[i])) {
        presenceRef.current = { ...presenceRef.current, selected };
        dirtyPresence.current = true;
      }
      if (handlers.current.canEdit) dirtyElements.current = true;
      schedule();
    },
    [schedule],
  );

  /** Aplica lo de otro al lienzo: merge por elemento, sin deshacer, sin contarlo como edición local. */
  const applyRemote = useCallback(async (elements: CollabEl[]) => {
    const a = handlers.current.api;
    if (!a || !elements.length) return;
    const { reconcile, REMOTE } = await import('./ExcalidrawCanvas');
    markReceived(elements, sentRef.current);
    const merged = reconcile(a.getSceneElementsIncludingDeleted(), withoutGenerated(elements), a.getAppState());
    a.updateScene({ elements: merged, captureUpdate: REMOTE });
    handlers.current.onRemoteApplied();
  }, []);

  const followBounds = useCallback(async (bounds: Peer['bounds']) => {
    const a = handlers.current.api;
    if (!a || !bounds) return;
    const { fitBounds } = await import('./ExcalidrawCanvas');
    fitBounds(a, bounds);
  }, []);

  const onEvents = useCallback(
    (events: LiveEvent[]) => {
      let peersChanged = false;
      const now = Date.now();
      for (const e of events) {
        if (isMine(e.socketId)) continue;
        if (e.kind === 'saved') {
          if (typeof e.payload.version === 'number') handlers.current.onSaved(e.payload.version, e.user?.name ?? null);
          continue;
        }
        if (e.kind === 'access') continue;
        if (e.kind === 'leave') {
          peersChanged = peersRef.current.delete(e.socketId) || peersChanged;
          continue;
        }
        const prev = peersRef.current.get(e.socketId);
        // Un socket es siempre de la misma persona: si llega con otra, se descarta.
        if (prev && (prev.user?.id ?? null) !== (e.user?.id ?? null)) continue;
        const presence = e.payload.presence ?? {};
        const peer: Peer = {
          socketId: e.socketId,
          user: e.user,
          pointer: presence.pointer ?? prev?.pointer,
          button: presence.button ?? prev?.button,
          selected: presence.selected ?? prev?.selected,
          bounds: presence.bounds ?? prev?.bounds,
          idle: presence.idle ?? false,
          lastSeen: now,
        };
        peersRef.current.set(e.socketId, peer);
        peersChanged = true;
        // Llegó alguien nuevo: se le contesta enseguida con la presencia de acá (si no, esperaría el latido).
        if (!prev) {
          dirtyPresence.current = true;
          schedule();
        }
        if (e.kind === 'update' && e.payload.elements?.length) void applyRemote(e.payload.elements);
        if (e.kind === 'summon') {
          const name = e.user?.guest || !e.user ? guestLabelRef.current : e.user.name || guestLabelRef.current;
          setSummon({ socketId: e.socketId, name, presenting: Boolean(e.payload.presenting) });
          // Traer a todos: se empieza a seguir a quien llamó (Esc o mover el lienzo lo corta).
          handlers.current.api?.updateScene({ appState: { userToFollow: { socketId: e.socketId, username: name } } as never, captureUpdate: 'NEVER' as never });
          followRef.current = e.socketId;
          setFollowing({ socketId: e.socketId, name });
        }
        if (followRef.current === e.socketId && presence.bounds) void followBounds(presence.bounds);
      }
      if (peersChanged) renderPeers();
    },
    [isMine, applyRemote, followBounds, renderPeers, schedule],
  );

  const { status } = useRealtime<LiveEvent>({
    streamUrl: url,
    pollUrl: `${url}&poll=1`,
    cursor: 0,
    pollMs: 700,
    hiddenPollMs: 5000,
    onEvents,
    onConnect: () => handlers.current.onResync(),
    onReset: () => handlers.current.onResync(),
    onRevoked: () => handlers.current.onRevoked(),
    enabled: Boolean(api),
  });

  // Vista (para quien me sigue), seguir a alguien y presencia al conectarse.
  useEffect(() => {
    if (!api) return;
    stopped.current = false;
    const updateBounds = () => {
      const s = api.getAppState() as { scrollX: number; scrollY: number; width: number; height: number; zoom: { value: number } };
      if (!s || typeof s.width !== 'number') return;
      presenceRef.current = { ...presenceRef.current, bounds: visibleBounds(s) };
      dirtyPresence.current = true;
      schedule();
    };
    updateBounds();
    const offScroll = api.onScrollChange(updateBounds);
    const offFollow = api.onUserFollow(({ userToFollow, action }) => {
      if (action === 'FOLLOW') {
        followRef.current = userToFollow.socketId;
        setFollowing({ socketId: userToFollow.socketId, name: userToFollow.username });
        void followBounds(peersRef.current.get(userToFollow.socketId)?.bounds);
      } else if (followRef.current === userToFollow.socketId) {
        followRef.current = null;
        setFollowing(null);
        setSummon(null);
      }
    });
    // Latido: sin moverse, los demás siguen viendo a esta pestaña (y si está oculta, como ausente).
    const beat = setInterval(() => {
      presenceRef.current = { ...presenceRef.current, idle: document.visibilityState === 'hidden' };
      dirtyPresence.current = true;
      schedule();
      if (prunePeers(peersRef.current, Date.now())) renderPeers();
    }, HEARTBEAT_MS);
    const onVisibility = () => {
      presenceRef.current = { ...presenceRef.current, idle: document.visibilityState === 'hidden' };
      dirtyPresence.current = true;
      schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const leave = () => {
      try {
        navigator.sendBeacon?.(url, new Blob([JSON.stringify({ socketId, leave: true })], { type: 'text/plain' }));
      } catch {
        /* sin beacon: los demás lo dan por ido a los 30 s */
      }
    };
    window.addEventListener('pagehide', leave);
    return () => {
      stopped.current = true;
      offScroll();
      offFollow();
      clearInterval(beat);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [api, url, socketId, schedule, renderPeers, followBounds]);

  // Lo que ya está en el lienzo al abrir no se vuelve a mandar.
  useEffect(() => {
    if (api) markReceived(api.getSceneElementsIncludingDeleted() as CollabEl[], sentRef.current);
  }, [api]);

  /** Traer a todos a mi vista (y, presentando, que me sigan). */
  const summonAll = useCallback(
    async (presenting = false) => {
      const a = handlers.current.api;
      if (!a) return false;
      const s = a.getAppState() as { scrollX: number; scrollY: number; width: number; height: number; zoom: { value: number } };
      presenceRef.current = { ...presenceRef.current, bounds: visibleBounds(s) };
      return post({ summon: true, presenting, presence: presenceRef.current });
    },
    [post],
  );

  const stopFollowing = useCallback(() => {
    handlers.current.api?.updateScene({ appState: { userToFollow: null } as never, captureUpdate: 'NEVER' as never });
    followRef.current = null;
    setFollowing(null);
    setSummon(null);
  }, []);

  /** Seguir a una persona desde la lista propia (mismo efecto que el avatar de Excalidraw). */
  const follow = useCallback((peer: Peer) => {
    const name = peer.user?.guest || !peer.user ? guestLabelRef.current : peer.user.name || guestLabelRef.current;
    handlers.current.api?.updateScene({ appState: { userToFollow: { socketId: peer.socketId, username: name } } as never, captureUpdate: 'NEVER' as never });
  }, []);

  return {
    socketId,
    status: status as RealtimeStatus,
    people,
    following,
    summon,
    onPointer,
    onCanvasChange,
    summonAll,
    follow,
    stopFollowing,
    canEdit,
  };
}

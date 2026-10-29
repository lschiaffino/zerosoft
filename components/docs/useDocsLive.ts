'use client';

/**
 * Pulso en vivo de una página de Docs (ver lib/docs-live.ts): manda dónde
 * está el cursor, trae a las demás personas y, si la página cambió, la
 * versión nueva. Más rápido con más gente, más lento a solas y casi quieto
 * con la pestaña oculta. Al salir avisa (sendBeacon) para desaparecer ya.
 */
import { useEffect, useRef, useState } from 'react';
import type { DocsPeer } from '@/lib/docs-live';
import type { DocsAccess, DocsPage } from '@/lib/docs-types';
import { getSelectionOffsets } from '@/lib/docs-caret';

export interface LivePulse {
  updated_at: string;
  /** Última edición de los sincronizados de la página. */
  synced_at?: string;
  locked: boolean;
  access: DocsAccess;
  peers: DocsPeer[];
  comments: string;
  page: DocsPage | null;
}

const FAST_MS = 1500;
const ALONE_MS = 4000;
const HIDDEN_MS = 15000;
/** Sin noticias de una sesión en este tiempo, su cursor deja de verse. */
const PEER_STALE_MS = 30_000;

function newSession(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Bloque y offsets de la selección actual dentro del editor (o nada). */
export function readCursor(root: HTMLElement | null): { block_id: string | null; start: number | null; end: number | null } {
  const none = { block_id: null, start: null, end: null };
  if (!root) return none;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return none;
  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const host = el?.closest('.docs-editable') as HTMLElement | null;
  if (!host || !root.contains(host)) return none;
  const block = host.closest('[data-block-anchor]')?.getAttribute('data-block-anchor') ?? null;
  const off = getSelectionOffsets(host);
  return { block_id: block, start: off?.start ?? null, end: off?.end ?? null };
}

export function useDocsLive(opts: {
  pageId: string;
  /** updated_at de la versión que tiene el editor (el server manda la nueva si difiere). */
  since: () => string;
  /** synced_at que ya incorporó el editor (null hasta el primer pulso). */
  syncedAt?: () => string | null;
  mode: string;
  rootRef: React.RefObject<HTMLElement | null>;
  onPulse: (pulse: LivePulse) => void;
  enabled?: boolean;
}) {
  const [peers, setPeers] = useState<DocsPeer[]>([]);
  const session = useRef<string>('');
  if (!session.current) session.current = newSession();
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const peersRef = useRef<DocsPeer[]>([]);
  /** Cuándo se supo de cada sesión por última vez (hora local). */
  const seenAt = useRef(new Map<string, number>());
  const kick = useRef<() => void>(() => {});

  useEffect(() => {
    if (opts.enabled === false) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const url = `/api/docs/pages/${encodeURIComponent(opts.pageId)}/live`;

    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      const o = optsRef.current;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: session.current, mode: o.mode, since: o.since(), synced_at: o.syncedAt?.() ?? null, ...readCursor(o.rootRef.current) }),
        });
        if (res.ok) {
          const pulse = (await res.json()) as LivePulse;
          peersRef.current = pulse.peers;
          const at = Date.now();
          for (const p of pulse.peers) seenAt.current.set(p.session, at);
          setPeers(pulse.peers);
          o.onPulse(pulse);
        }
      } catch {
        /* sin red: se reintenta en el próximo pulso */
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const schedule = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      timer = setTimeout(tick, hidden ? HIDDEN_MS : peersRef.current.length > 0 ? FAST_MS : ALONE_MS);
    };
    kick.current = () => {
      if (timer) clearTimeout(timer);
      void tick();
    };
    // Mover el cursor a otro bloque con más gente en la página: pulso enseguida.
    let lastBlock: string | null = null;
    const onSel = () => {
      if (peersRef.current.length === 0) return;
      const cur = readCursor(optsRef.current.rootRef.current).block_id;
      if (cur !== lastBlock) {
        lastBlock = cur;
        kick.current();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick.current();
    };
    const leave = () => {
      try {
        navigator.sendBeacon(url, JSON.stringify({ session: session.current, leave: true }));
      } catch {
        /* nada */
      }
    };
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', leave);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [opts.pageId, opts.enabled]);

  // Una sesión que se fue sin avisar (sin `leave`, o sin pulsos que la saquen): su cursor se apaga solo.
  useEffect(() => {
    const sweep = setInterval(() => {
      // Con la hora de esta pantalla (no la del servidor: los relojes pueden no coincidir).
      const cutoff = Date.now() - PEER_STALE_MS;
      const next = peersRef.current.filter((x) => (seenAt.current.get(x.session) ?? Date.now()) >= cutoff);
      if (next.length === peersRef.current.length) return;
      peersRef.current = next;
      setPeers(next);
    }, 5_000);
    return () => clearInterval(sweep);
  }, []);

  /** Cursor de otra sesión que llegó por el feed en vivo (lib/docs-coedit.ts): se ve al instante. */
  const upsertPeer = (p: DocsPeer) => {
    seenAt.current.set(p.session, Date.now());
    const list = peersRef.current;
    const i = list.findIndex((x) => x.session === p.session);
    const next = i >= 0 ? list.map((x, k) => (k === i ? { ...x, ...p } : x)) : [p, ...list];
    peersRef.current = next;
    setPeers(next);
  };
  const removePeer = (sessionId: string) => {
    const next = peersRef.current.filter((x) => x.session !== sessionId);
    if (next.length === peersRef.current.length) return;
    peersRef.current = next;
    setPeers(next);
  };

  return { peers, session: session.current, pulseNow: () => kick.current(), upsertPeer, removePeer };
}

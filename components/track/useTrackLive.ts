'use client';

import { useEffect, useRef, useState } from 'react';

/** Cada cuánto se sondea con la pestaña visible (sin websockets en el stack). */
export const LIVE_INTERVAL_MS = 4000;

export interface LiveViewer {
  id: string;
  name: string;
}

type LiveTarget = { projectId: string } | { issueId: string } | { workspace: true };

/**
 * Cambios de otros sin recargar: sondea /api/track/live y, cuando la firma
 * cambia, llama a `onChange` (la vista recarga lo que muestra). La primera
 * firma solo se guarda. Con `issueId` además mantiene la presencia y
 * devuelve quién más tiene el issue abierto.
 */
export function useTrackLive(
  target: LiveTarget | null,
  onChange: () => void,
  opts: { enabled?: boolean; syncOnStart?: boolean } = {},
): { viewers: LiveViewer[] } {
  const enabled = opts.enabled ?? true;
  // Datos que vinieron del servidor: lo que cambió entre el render y el primer
  // sondeo se trae igual (una recarga al empezar).
  const syncOnStart = opts.syncOnStart ?? false;
  const [viewers, setViewers] = useState<LiveViewer[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const key = target ? JSON.stringify(target) : '';

  useEffect(() => {
    if (!key || !enabled) return;
    const body = JSON.parse(key) as Record<string, unknown>;
    const isIssue = 'issueId' in body;
    let last: string | null = null;
    let alive = true;
    let busy = false;

    const tick = async () => {
      if (!alive || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const res = await fetch('/api/track/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isIssue ? { ...body, present: true } : body),
        });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { sig: string; viewers?: LiveViewer[] };
        if (data.viewers) setViewers(data.viewers);
        if ((last !== null && data.sig !== last) || (last === null && syncOnStart)) onChangeRef.current();
        last = data.sig;
      } catch {
        // Sin red: se reintenta en el próximo tick.
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), LIVE_INTERVAL_MS);
    const onVisible = () => void tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (isIssue) {
        void fetch('/api/track/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, present: false }),
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, [key, enabled, syncOnStart]);

  return { viewers };
}

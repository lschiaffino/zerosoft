'use client';

import { useCallback, useEffect, useState } from 'react';
import { cleanPresence, type Presence } from '@/lib/groups-inbox-rules';

/**
 * Estado para recibir chats de Lines: online (recibe chats nuevos), away
 * (conserva los suyos, no recibe nuevos) u offline. Vive en el menú de la
 * cuenta del sidebar, no en la bandeja. `enabled` = estamos en Lines (fuera
 * de Lines no se pide nada).
 */
export function useLinesPresence(enabled: boolean) {
  const [status, setStatus] = useState<Presence | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetch('/api/groups/availability', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ me: unknown }>) : null))
      .then((d) => alive && d && setStatus(cleanPresence(d.me) ?? 'online'))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);

  const set = useCallback(
    async (next: Presence) => {
      if (status === null || next === status) return;
      const prev = status;
      setStatus(next);
      const res = await fetch('/api/groups/availability', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      }).catch(() => null);
      if (!res?.ok) setStatus(prev);
      // La bandeja recarga la lista (los chats esperando pueden asignarse ahora, o se repartieron los míos).
      else window.dispatchEvent(new Event('zs:lines-presence-changed'));
    },
    [status],
  );

  return { status: enabled ? status : null, set };
}

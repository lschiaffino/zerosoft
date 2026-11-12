'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Disponible o ausente para recibir chats de Lines (la asignación automática solo
 * elige a quien está disponible). Vive en el menú de la cuenta del sidebar, no en la
 * bandeja. `enabled` = estamos en Lines (fuera de Lines no se pide nada).
 */
export function useLinesPresence(enabled: boolean) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetch('/api/groups/availability', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ me: boolean }>) : null))
      .then((d) => alive && d && setAvailable(d.me !== false))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (available === null) return;
    const next = !available;
    setAvailable(next);
    const res = await fetch('/api/groups/availability', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ available: next }),
    }).catch(() => null);
    if (!res?.ok) setAvailable(!next);
    // La bandeja recarga la lista (los chats esperando pueden asignarse ahora).
    else window.dispatchEvent(new Event('zs:lines-presence-changed'));
  }, [available]);

  return { available: enabled ? available : null, toggle };
}

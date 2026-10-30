'use client';

import { useEffect } from 'react';

/** Cuenta la visita (para la conversión de la analítica). Una por página. */
export default function ViewBeacon({ handle }: { handle: string }) {
  useEffect(() => {
    const url = `/api/shop/public/${handle}/view`;
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url);
      else void fetch(url, { method: 'POST', keepalive: true });
    } catch {
      /* sin conteo */
    }
  }, [handle]);
  return null;
}

'use client';

import { useEffect } from 'react';

/**
 * Cuenta la visita al sitio publicado (analítica del sitio): un beacon por
 * página vista, sin cookies. Va en el cliente para no contar prefetch ni bots
 * que no corren JS.
 */
export default function HelpView({ handle, pageId }: { handle: string; pageId?: string }) {
  useEffect(() => {
    const body = JSON.stringify({ handle, pageId: pageId ?? '', referrer: document.referrer.slice(0, 2000) });
    try {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon?.('/api/docs/help/view', blob)) return;
    } catch {
      /* sin sendBeacon: fetch */
    }
    void fetch('/api/docs/help/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  }, [handle, pageId]);
  return null;
}

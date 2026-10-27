'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';
import { registerAppServiceWorker, serviceWorkerEnabled } from '@/lib/sw-client';
import { offlinePages } from '@/lib/docs-offline';

/**
 * Docs como app instalable y sin conexión: registra el service worker único
 * (public/sw.js), le pasa el JS y CSS de esta carga y la vista actual, y
 * refresca las páginas marcadas "Disponible sin conexión" cuando hay red.
 * En `next dev` no se registra (como el CRM), salvo con NEXT_PUBLIC_SW_DEV=1.
 */
export default function DocsPwa({ owner }: { owner: string }) {
  const locale = useLocale();
  const pathname = usePathname();

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !serviceWorkerEnabled()) return;
    let cancelled = false;
    registerAppServiceWorker()
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (cancelled || !navigator.onLine) return;
        const target = navigator.serviceWorker.controller ?? reg.active;
        const urls = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .filter((u) => u.includes('/_next/static/'));
        urls.push(location.href);
        for (const id of offlinePages(owner)) urls.push(`/${locale}/app/docs/${id}`);
        target?.postMessage({ type: 'zs-warm', user: owner, urls });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [locale, owner]);

  // Navegar dentro de Docs (sin recarga): la vista nueva también queda guardada.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.onLine) return;
    const id = window.setTimeout(() => navigator.serviceWorker?.controller?.postMessage({ type: 'zs-warm', user: owner, urls: [location.href] }), 1500);
    return () => window.clearTimeout(id);
  }, [pathname, owner]);

  return null;
}

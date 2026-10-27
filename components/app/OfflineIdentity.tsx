'use client';

import { useEffect } from 'react';
import { forgetOtherOfflineData, OFFLINE_IDENTITY_KEY } from '@/lib/docs-offline';

/**
 * Quién usa la app en este dispositivo (persona:workspace), para lo que se
 * guarda sin conexión: el service worker (public/sw.js) guarda las vistas en
 * una caché de esa persona y, si cambia, borra las de la anterior; y Docs
 * descarta borradores y páginas "sin conexión" de otra persona. Sin esto,
 * quien entraba después en el mismo equipo abría sin red lo de la anterior.
 */
export default function OfflineIdentity({ id }: { id: string }) {
  useEffect(() => {
    let prev: string | null = null;
    try {
      prev = localStorage.getItem(OFFLINE_IDENTITY_KEY);
      if (prev !== id) localStorage.setItem(OFFLINE_IDENTITY_KEY, id);
    } catch {
      /* sin storage */
    }
    if (prev !== id) forgetOtherOfflineData(id);
    const post = () => navigator.serviceWorker?.controller?.postMessage({ type: 'zs-user', id });
    post();
    navigator.serviceWorker?.ready.then((reg) => (navigator.serviceWorker.controller ?? reg.active)?.postMessage({ type: 'zs-user', id })).catch(() => undefined);
    navigator.serviceWorker?.addEventListener('controllerchange', post);
    return () => navigator.serviceWorker?.removeEventListener('controllerchange', post);
  }, [id]);
  return null;
}

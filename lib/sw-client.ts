/**
 * Registro del único service worker de la suite (public/sw.js: CRM offline y
 * push de Groups), con scope `/`. CRM (OfflineSync), Groups (GroupsPwa) y el
 * panel de notificaciones pasan por acá: un solo registro por pestaña, así
 * ninguno pisa al otro con un script distinto.
 *
 * Solo en el build de producción (o con NEXT_PUBLIC_SW_DEV=1): en `next dev`
 * los archivos de /_next/static no llevan hash y la caché los dejaría viejos.
 * `force` lo registra igual (activar notificaciones es un pedido explícito).
 * Solo cliente.
 */
export const SW_URL = '/sw.js';
export const SW_SCOPE = '/';

let pending: Promise<ServiceWorkerRegistration | null> | null = null;

export function serviceWorkerEnabled(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_SW_DEV === '1';
}

export function registerAppServiceWorker(opts: { force?: boolean } = {}): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!opts.force && !serviceWorkerEnabled()) return Promise.resolve(null);
  pending ??= navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }).catch(() => {
    pending = null;
    return null;
  });
  return pending;
}

'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { whenStreamSettled } from '@/lib/stream-settled';
import { TZ_CHANGED_EVENT, TZ_DEPENDENT_ATTR, tzAction } from '@/lib/tz-client';

/**
 * Guarda la zona horaria del navegador en la cookie `tz` para que el servidor
 * arme "hoy", "vencidas" y las fechas en tu hora (no en UTC). El script
 * inline del layout raíz ya la escribe antes de hidratar en cualquier página
 * (sitio, login); esto cubre la primera visita directa a la app.
 *
 * Si el servidor armó la página con otra zona (`serverTz`):
 * - Las páginas con fechas de "hoy" (marcadas con data-tz-dependent, ver
 *   TzDependent) se refrescan una vez.
 * - En el resto solo el contador de tareas del sidebar depende de la zona:
 *   se le avisa con un evento y lo vuelve a pedir, sin router.refresh() (que
 *   re-renderizaba y volvía a bajar el árbol RSC entero).
 *
 * El refresh nunca corre en medio de la primera carga:
 * - Si la página que llegó es un redirect() (Next deja el meta
 *   #__next-page-redirect y el router navega mientras hidrata), espera a que
 *   esa navegación termine: pedirlo en el medio hace que el Router de Next
 *   renderice con el estado pendiente y tire el error #310 de React.
 * - Si el HTML todavía está llegando en streaming (boundary de loading.tsx
 *   sin revelar), espera a que termine: si no, React renderiza ese boundary
 *   de cero en el cliente y por un momento la página queda duplicada (la copia
 *   viva y la oculta del servidor). Ver lib/stream-settled.ts.
 */
export default function TimezoneCookie({ serverTz }: { serverTz: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const pendingRefresh = useRef<string | null>(null);
  const browserTz = useRef<string | null>(null);
  // Sin cancelar al desmontar: en dev (StrictMode) el efecto corre dos veces y
  // la segunda ya encuentra la cookie, así que cancelar perdería el refresh.
  const cancelWait = useRef<(() => void) | null>(null);

  useEffect(() => {
    let tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!tz) return;
    browserTz.current = tz;
    const current = document.cookie.match(/(?:^|;\s*)tz=([^;]*)/)?.[1];
    if (!current || decodeURIComponent(current) !== tz) {
      document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    }
    if (tzAction(serverTz, tz, false) === 'none') return;
    if (document.getElementById('__next-page-redirect')) {
      pendingRefresh.current = window.location.pathname;
      return;
    }
    cancelWait.current?.();
    cancelWait.current = whenStreamSettled(() => apply(serverTz, tz, router));
    // Solo en la carga: serverTz cambia después de un refresh y ya coincide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Terminó la navegación del redirect (cambió el path): ahora sí.
  useEffect(() => {
    if (pendingRefresh.current === null || pendingRefresh.current === window.location.pathname) return;
    pendingRefresh.current = null;
    cancelWait.current?.();
    const tz = browserTz.current;
    if (tz) cancelWait.current = whenStreamSettled(() => apply(serverTz, tz, router));
  }, [pathname, router, serverTz]);

  return null;
}

function apply(serverTz: string, tz: string, router: { refresh: () => void }) {
  const action = tzAction(serverTz, tz, Boolean(document.querySelector(`[${TZ_DEPENDENT_ATTR}]`)));
  if (action === 'refresh') router.refresh();
  else if (action === 'notify') window.dispatchEvent(new Event(TZ_CHANGED_EVENT));
}

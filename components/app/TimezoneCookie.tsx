'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { whenStreamSettled } from '@/lib/stream-settled';

/**
 * Guarda la zona horaria del navegador en la cookie `tz` para que el servidor
 * arme "hoy", "vencidas" y las fechas en tu hora (no en UTC). Si cambió,
 * refresca una vez para que la página ya se vea bien.
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
export default function TimezoneCookie() {
  const router = useRouter();
  const pathname = usePathname();
  const pendingRefresh = useRef<string | null>(null);
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
    const current = document.cookie.match(/(?:^|;\s*)tz=([^;]*)/)?.[1];
    if (current && decodeURIComponent(current) === tz) return;
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
    if (document.getElementById('__next-page-redirect')) {
      pendingRefresh.current = window.location.pathname;
      return;
    }
    cancelWait.current?.();
    cancelWait.current = whenStreamSettled(() => router.refresh());
  }, [router]);

  // Terminó la navegación del redirect (cambió el path): ahora sí refresca.
  useEffect(() => {
    if (pendingRefresh.current === null || pendingRefresh.current === window.location.pathname) return;
    pendingRefresh.current = null;
    cancelWait.current?.();
    cancelWait.current = whenStreamSettled(() => router.refresh());
  }, [pathname, router]);

  return null;
}

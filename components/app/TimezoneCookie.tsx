'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * Guarda la zona horaria del navegador en la cookie `tz` para que el servidor
 * arme "hoy", "vencidas" y las fechas en tu hora (no en UTC). Si cambió,
 * refresca una vez para que la página ya se vea bien.
 *
 * Si la página que llegó es un redirect() (Next deja el meta
 * #__next-page-redirect y el router navega mientras hidrata), el refresh
 * espera a que esa navegación termine: pedirlo en el medio hace que el Router
 * de Next renderice con el estado pendiente y tire el error #310 de React.
 */
export default function TimezoneCookie() {
  const router = useRouter();
  const pathname = usePathname();
  const pendingRefresh = useRef<string | null>(null);

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
    router.refresh();
  }, [router]);

  // Terminó la navegación del redirect (cambió el path): ahora sí refresca.
  useEffect(() => {
    if (pendingRefresh.current === null || pendingRefresh.current === window.location.pathname) return;
    pendingRefresh.current = null;
    router.refresh();
  }, [pathname, router]);

  return null;
}

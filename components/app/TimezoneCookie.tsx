'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';

/**
 * Guarda la zona horaria del navegador en la cookie `tz` para que el servidor
 * arme "hoy", "vencidas" y las fechas en tu hora (no en UTC). Si cambió,
 * refresca una vez para que la página ya se vea bien.
 */
export default function TimezoneCookie() {
  const router = useRouter();
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
    router.refresh();
  }, [router]);
  return null;
}

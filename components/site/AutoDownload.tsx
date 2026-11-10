'use client';

import { useEffect } from 'react';

/**
 * Arranca la descarga del instalador al abrir /download/start. El archivo de
 * GitHub viene como adjunto: el navegador lo baja y la página (con los pasos
 * de instalación) queda a la vista. El timeout se cancela al desmontar, así
 * que el doble efecto del modo estricto baja una sola vez.
 */
export default function AutoDownload({ href, enabled }: { href: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const id = window.setTimeout(() => window.location.assign(href), 400);
    return () => window.clearTimeout(id);
  }, [href, enabled]);
  return null;
}

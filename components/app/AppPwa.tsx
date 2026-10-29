'use client';

import { useEffect } from 'react';
import { registerAppServiceWorker } from '@/lib/sw-client';

/**
 * Toda la plataforma instalable (PWA): registra el service worker único
 * (public/sw.js) desde cualquier app, no solo CRM, Docs o Groups, así el
 * navegador ofrece "Instalar zerosoft" en Talk, Voice o Track también. El
 * registro es el mismo de siempre (scope /, solo en producción).
 */
export default function AppPwa() {
  useEffect(() => {
    // En los e2e (navegador automatizado) cada app registra el suyo como antes: así un spec
    // que no pasa por el CRM no queda con el worker de otro controlando sus pedidos.
    if (navigator.webdriver) return;
    void registerAppServiceWorker();
  }, []);
  return null;
}

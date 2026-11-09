'use client';

import { useEffect } from 'react';
import { registerAppServiceWorker } from '@/lib/sw-client';
import { listenInstallPrompt } from './installPrompt';

/**
 * CRM instalable: registra el service worker (public/sw.js) apenas abre el
 * CRM y guarda el aviso de "Instalar" del navegador. El estado sin conexión
 * (sin red, cambios en cola, sincronizar, reintentar o descartar) lo muestra
 * la banda de toda la app: components/app/OfflineStatus.tsx.
 */
export default function OfflineSync() {
  useEffect(() => {
    void registerAppServiceWorker();
    return listenInstallPrompt();
  }, []);
  return null;
}

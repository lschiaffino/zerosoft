'use client';

import { useEffect } from 'react';
import { registerAppServiceWorker } from '@/lib/sw-client';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __groupsInstall?: InstallPrompt | null;
  }
}

export const INSTALL_EVENT = 'zs:groups-install';

/**
 * Registra el service worker de la suite (public/sw.js: push de Groups y CRM
 * offline, vía lib/sw-client) y guarda el
 * aviso de instalación del navegador para el botón "Instalar" de Ajustes.
 * No dibuja nada.
 */
export default function GroupsPwa() {
  useEffect(() => {
    void registerAppServiceWorker();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__groupsInstall = e as InstallPrompt;
      window.dispatchEvent(new Event(INSTALL_EVENT));
    };
    const onInstalled = () => {
      window.__groupsInstall = null;
      window.dispatchEvent(new Event(INSTALL_EVENT));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}

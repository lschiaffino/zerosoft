/**
 * El aviso de instalación del navegador (beforeinstallprompt) llega una sola
 * vez y temprano: OfflineSync (en el layout del CRM) lo guarda acá y avisa;
 * InstallAppPanel lo usa cuando la persona toca "Instalar".
 */

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const INSTALL_EVENT = 'zs:install-available';

let saved: InstallPromptEvent | null = null;

export function getInstallPrompt(): InstallPromptEvent | null {
  return saved;
}

/** Engancha beforeinstallprompt; devuelve la función para soltarlo. */
export function listenInstallPrompt(): () => void {
  function onPrompt(e: Event) {
    e.preventDefault();
    saved = e as InstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  }
  function onInstalled() {
    saved = null;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  }
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

/**
 * Puente con la app de escritorio (desktop/src/preload/app.ts): existe solo
 * dentro de la app, y solo en páginas del servidor configurado. En el
 * navegador es null. Cliente.
 */
export interface DesktopBridge {
  version: string;
  platform: string;
  /** Hay audio del sistema para grabar reuniones. */
  systemAudio: boolean;
  /** El dictado en cualquier app está activo. */
  dictation: boolean;
  /** Login con Google en el navegador del sistema; vuelve por zerosoft://. */
  startLogin: () => void;
  openSettings: () => void;
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { zerosoftDesktop?: DesktopBridge }).zerosoftDesktop;
  return b && typeof b.startLogin === 'function' ? b : null;
}

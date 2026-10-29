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
  /**
   * Canjea el nonce de "tomar notas" (?autostart=<nonce>): lo crea la app al
   * tocar su aviso o su menú y vale una sola vez. Un link con autostart que
   * no salió de la app (pegado en Talk, un mail) devuelve false.
   */
  consumeAutostart?: (nonce: string) => Promise<boolean>;
}

/** Forma del nonce de autostart (desktop/src/shared/nonce.ts). */
export const AUTOSTART_NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { zerosoftDesktop?: DesktopBridge }).zerosoftDesktop;
  return b && typeof b.startLogin === 'function' ? b : null;
}

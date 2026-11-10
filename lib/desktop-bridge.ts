import type { RecOverlayState } from './rec-controls';

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
  /** Abre la ventana de Ajustes de la app de escritorio. */
  openSettings: () => void;
  /**
   * Avisa que una reunión empezó o terminó de grabarse: con la ventana en
   * segundo plano, la app muestra un indicador flotante con Abrir y Cortar
   * (Cortar manda el evento DESKTOP_STOP_RECORDING_EVENT). Desde la 0.3.0.
   */
  recording?: (state: { active: boolean; startedAt?: number; path?: string }) => Promise<void> | void;
  /**
   * Canjea el nonce de "tomar notas" (?autostart=<nonce>): lo crea la app al
   * tocar su aviso o su menú y vale una sola vez. Un link con autostart que
   * no salió de la app (pegado en Talk, un mail) devuelve false.
   */
  /**
   * Audio del sistema nativo (ScreenCaptureKit en Mac, macOS 13 o más). start devuelve
   * ok | denied | unsupported | failed; read, el PCM de 16 bits, 16 kHz, mono, en base64 que se
   * acumuló desde la lectura anterior; stop corta. Desde la 0.4.0.
   */
  systemAudioStart?: () => Promise<string>;
  systemAudioRead?: () => Promise<string>;
  systemAudioStop?: () => Promise<void>;
  consumeAutostart?: (nonce: string) => Promise<boolean>;
  /**
   * Rec (como Loom): mientras se graba, la app muestra una barra flotante (reloj, micrófono,
   * pausa, terminar, reiniciar, descartar) y, con `camera`, la burbuja de la cámara encima de
   * todo. Lo que se toca ahí llega como DESKTOP_REC_CONTROL_EVENT. Desde la 0.3.4.
   */
  recOverlay?: (state: RecOverlayState) => Promise<void>;
  /** Nivel del micrófono (0 a 1) para la barra flotante. */
  recLevel?: (level: number) => Promise<void>;
}

/** Lo manda la app de escritorio cuando se toca Cortar en su indicador de grabación. */
export const DESKTOP_STOP_RECORDING_EVENT = 'zerosoft:stop-recording';

/** Controles de Rec desde la app de escritorio: CustomEvent con `detail` = un RecControl (lib/rec-controls.ts). */
export const DESKTOP_REC_CONTROL_EVENT = 'zerosoft:rec-control';

/** Forma del nonce de autostart (desktop/src/shared/nonce.ts). */
export const AUTOSTART_NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { zerosoftDesktop?: DesktopBridge }).zerosoftDesktop;
  return b && typeof b.startLogin === 'function' ? b : null;
}

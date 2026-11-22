import type { RecOverlayState } from './rec-controls';

/**
 * Puente con la app de escritorio: existe solo dentro de la app, y solo en
 * páginas del servidor configurado. En el navegador es null. Cliente.
 *
 * Lo implementan dos apps: la de Tauri (desktop/src-tauri/src/lib.rs,
 * `bridge_script`; Windows y Mac) y la de Mac en Swift
 * (desktop-mac/Sources/ZerosoftCore/BridgeScript.swift). Las dos se
 * reconocen igual (`startLogin`), y lo que una todavía no tiene lo dicen los
 * campos de capacidad, para que la página nunca pregunte en qué app está.
 */
export interface DesktopBridge {
  version: string;
  platform: string;
  /** La app tiene su ventana de Ajustes (la de Swift desde el bloque 5). false: no. Sin el campo (Tauri): sí. */
  settingsWindow?: boolean;
  /**
   * La app se actualiza desde /api/desktop/update/latest.json. false: no (la de
   * Swift se actualiza por la App Store o su propio canal). Sin el campo (Tauri): sí.
   */
  updateFeed?: boolean;
  /** La app tiene pestañas y ventanas propias. false: todavía no. Sin el campo (Tauri): sí. */
  tabs?: boolean;
  /** Build de la Mac App Store: sin enlaces de compra (decisión 7.2 de docs/desktop-swift.md). */
  store?: boolean;
  /** Las vistas web corren con las restricciones del Modo de Aislamiento (Lockdown Mode). */
  lockdown?: boolean;
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
   * Audio del sistema nativo (Tauri: ScreenCaptureKit en Mac, macOS 13 o más; Swift, desde el
   * bloque 7: Core Audio taps en macOS 14.2 o más y ScreenCaptureKit en 13 a 14.1). start devuelve
   * ok | denied | unsupported | failed y solo empieza desde la pestaña que se está usando; read, el
   * PCM de 16 bits, 16 kHz, mono, en base64 que se acumuló desde la lectura anterior (solo para la
   * pestaña que la empezó); stop corta. Si la página deja de leer 30 s, la app corta sola. Desde la 0.4.0.
   */
  systemAudioStart?: () => Promise<string>;
  systemAudioRead?: () => Promise<string>;
  systemAudioStop?: () => Promise<void>;
  consumeAutostart?: (nonce: string) => Promise<boolean>;
  /**
   * Rec (como Loom): mientras se graba, la app muestra una barra flotante (reloj, micrófono,
   * pausa, terminar, reiniciar, descartar) y, con `camera`, la burbuja de la cámara encima de
   * todo. Lo que se toca ahí llega como DESKTOP_REC_CONTROL_EVENT. Desde la 0.3.4 (Tauri) y el
   * bloque 8 (Swift: la barra solo la empieza la pestaña que se está usando y queda fuera de la
   * captura; la burbuja es nativa y abre la cámara por su nombre).
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

/** La app abre su propia ventana de Ajustes (openSettings hace algo). */
export function desktopHasSettings(b: DesktopBridge | null): b is DesktopBridge {
  return !!b && b.settingsWindow !== false;
}

/** La versión de la app se compara con el feed de actualizaciones de Tauri. */
export function desktopUsesUpdateFeed(b: DesktopBridge | null): b is DesktopBridge {
  return !!b && b.updateFeed !== false;
}

/** La app abre links en otra pestaña o ventana suya (⌘-clic y compañía). */
export function desktopHasTabs(b: DesktopBridge | null): b is DesktopBridge {
  return !!b && b.tabs !== false;
}

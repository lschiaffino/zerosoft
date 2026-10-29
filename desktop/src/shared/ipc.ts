/**
 * Canales IPC y tipos compartidos entre main y los preloads. Cada canal lo
 * escucha main validando quién lo manda (origen del frame) y la forma del
 * payload: los renderers nunca reciben Node ni el token.
 */
import type { HotkeyId } from './hotkey';
import type { Locale } from './strings';

export const IPC = {
  // Ventana de la app (solo el origen del servidor configurado).
  appInfo: 'zs:app-info',
  startLogin: 'zs:start-login',
  openSettings: 'zs:open-settings',
  // Overlay de dictado.
  overlayState: 'zs:overlay-state',
  overlayAudio: 'zs:overlay-audio',
  overlayLevel: 'zs:overlay-level',
  // Ajustes y permisos.
  settingsGet: 'zs:settings-get',
  settingsSave: 'zs:settings-save',
  permissionAsk: 'zs:permission-ask',
} as const;

export interface AppInfo {
  version: string;
  platform: string;
  /** Hay audio del sistema para las reuniones (Windows siempre; Mac 13+). */
  systemAudio: boolean;
  /** Dictado en cualquier app disponible (hook de teclado cargado). */
  dictation: boolean;
}

/** Lo que el overlay muestra. 'recording' graba; el resto son estados de salida. */
export type OverlayPhase = 'hidden' | 'recording' | 'working' | 'done' | 'error';

export interface OverlayState {
  phase: OverlayPhase;
  /** Texto ya traducido (estado o error). */
  label: string;
  locale: Locale;
}

/** El overlay devuelve el audio grabado (o el error de micrófono). */
export interface OverlayAudio {
  /** Bytes del audio (webm/opus) o null si no se pudo grabar. */
  audio: ArrayBuffer | null;
  mime: string;
  durationMs: number;
  error?: 'mic_denied' | 'mic_failed';
}

export type PermissionKind = 'microphone' | 'accessibility' | 'screen';
export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'not-needed';

export interface SettingsView {
  locale: Locale;
  platform: string;
  server: string;
  hotkey: HotkeyId;
  hotkeys: Array<{ id: HotkeyId; label: string }>;
  toggleShortcut: string;
  meetingAlerts: boolean;
  openAtLogin: boolean;
  permissions: Record<PermissionKind, PermissionStatus>;
  strings: Record<string, string>;
}

export interface SettingsInput {
  server: string;
  hotkey: HotkeyId;
  meetingAlerts: boolean;
  openAtLogin: boolean;
}

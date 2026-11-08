/**
 * Canales IPC y tipos compartidos entre main y los preloads. Cada canal lo
 * escucha main validando quién lo manda (origen del frame) y la forma del
 * payload: los renderers nunca reciben Node ni el token.
 */
import type { HotkeyId } from './hotkey';
import type { DictationFailure, PendingMeta } from './retry';
import type { DictationMode } from './settings';
import type { Locale } from './strings';

export const IPC = {
  // Ventana de la app (solo el origen del servidor configurado).
  appInfo: 'zs:app-info',
  startLogin: 'zs:start-login',
  openSettings: 'zs:open-settings',
  consumeAutostart: 'zs:consume-autostart',
  // Overlay de dictado.
  overlayState: 'zs:overlay-state',
  overlayAudio: 'zs:overlay-audio',
  overlayLevel: 'zs:overlay-level',
  // Ajustes y permisos.
  settingsGet: 'zs:settings-get',
  settingsSave: 'zs:settings-save',
  settingsTab: 'zs:settings-tab',
  permissionAsk: 'zs:permission-ask',
  // Lo que vive en el servidor (Voice): ajustes, diccionario, historial.
  voiceGet: 'zs:voice-get',
  voiceSave: 'zs:voice-save',
  dictionaryList: 'zs:dictionary-list',
  dictionaryAdd: 'zs:dictionary-add',
  dictionaryDelete: 'zs:dictionary-delete',
  historyList: 'zs:history-list',
  historyCopy: 'zs:history-copy',
  historyPaste: 'zs:history-paste',
  pendingRetry: 'zs:pending-retry',
  pendingDiscard: 'zs:pending-discard',
  accountSignIn: 'zs:account-sign-in',
  accountSignOut: 'zs:account-sign-out',
  openVoice: 'zs:open-voice',
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
  /** Grabando: cuándo empezó (ms, reloj de main) y el tope, para el reloj del overlay. */
  startedAt?: number;
  maxMs?: number;
  /** Pista corta a la derecha (p. ej. "Esc cancela"). */
  hint?: string;
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

export interface AccountView {
  signedIn: boolean;
  email: string;
  name: string;
  /** No se pudo preguntar (sin conexión): se sabe solo si hay sesión guardada. */
  offline: boolean;
}

export interface SettingsView {
  locale: Locale;
  platform: string;
  version: string;
  server: string;
  mode: DictationMode;
  hotkey: HotkeyId;
  hotkeys: Array<{ id: HotkeyId; label: string }>;
  toggleShortcut: string;
  toggleShortcuts: string[];
  /** El atajo de alternar no se pudo registrar (lo usa otra app). */
  toggleTaken: boolean;
  pasteLastShortcut: string;
  restoreClipboard: boolean;
  meetingAlerts: boolean;
  openAtLogin: boolean;
  onboarded: boolean;
  /** El hook de teclado (mantener para hablar) está corriendo. */
  holdReady: boolean;
  permissions: Record<PermissionKind, PermissionStatus>;
  account: AccountView;
  pending: PendingMeta[];
  /** Último dictado: ms desde soltar la tecla hasta el texto pegado. */
  lastLatencyMs: number | null;
  /** Actualizaciones: 'auto' (se instalan solas) o 'manual' (Mac sin firma de Apple: desde /download). */
  updates: 'auto' | 'manual' | 'dev';
  strings: Record<string, string>;
}

export interface SettingsInput {
  server?: string;
  mode?: DictationMode;
  hotkey?: HotkeyId;
  toggleShortcut?: string;
  restoreClipboard?: boolean;
  meetingAlerts?: boolean;
  openAtLogin?: boolean;
  onboarded?: boolean;
}

/** Errores de lo que se pide al servidor desde Ajustes. */
export type RemoteError = 'signed_out' | 'offline' | 'failed';

export interface VoiceServerSettings {
  language: string;
  cleanupMode: 'raw' | 'clean' | 'formal' | 'per_app';
  aiCleanup: boolean;
  styles: Record<'email' | 'chat' | 'note' | 'other', 'formal' | 'neutral' | 'casual'>;
}

export type Remote<T> = ({ ok: true } & T) | { ok: false; error: RemoteError };

export interface DictionaryEntryView {
  id: string;
  kind: 'word' | 'replace' | 'snippet';
  phrase: string;
  replacement: string;
  shared: boolean;
}

export interface HistoryItemView {
  id: string;
  text: string;
  sourceApp: string;
  capture: string;
  startedAt: string;
  durationMs: number;
}

export interface RetryResult {
  ok: boolean;
  failure?: DictationFailure;
  text?: string;
}

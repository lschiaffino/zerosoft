/**
 * Lo que las páginas locales (Ajustes y HUD) le piden a la app en Rust, por IPC de Tauri.
 * Los comandos están en src-tauri/src/commands.rs y solo responden a la ventana "settings".
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type PermissionKind = 'microphone' | 'accessibility';
export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'not-needed';
export type Failure = 'offline' | 'signed_out' | 'rate_limited' | 'server' | 'too_large' | 'empty' | 'rejected';
export type Mode = 'both' | 'hold' | 'toggle';

export interface PendingMeta {
  id: string;
  createdAt: number;
  mime: string;
  durationMs: number;
  sourceApp: string;
  context: string;
  failure: Failure;
  attempts: number;
}

export interface AccountView {
  signedIn: boolean;
  email: string;
  name: string;
  offline: boolean;
}

export interface SettingsView {
  locale: 'en' | 'es' | 'pt';
  platform: 'darwin' | 'win32';
  version: string;
  server: string;
  mode: Mode;
  shortcut: string;
  shortcuts: Array<{ id: string; label: string }>;
  shortcutTaken: boolean;
  pasteLastShortcut: string;
  restoreClipboard: boolean;
  openAtLogin: boolean;
  onboarded: boolean;
  permissions: Record<PermissionKind, PermissionStatus>;
  account: AccountView;
  pending: PendingMeta[];
  lastLatencyMs: number | null;
  updates: 'auto' | 'off' | 'dev';
  strings: Record<string, string>;
}

export interface SettingsInput {
  server?: string;
  mode?: Mode;
  shortcut?: string;
  restoreClipboard?: boolean;
  openAtLogin?: boolean;
  onboarded?: boolean;
}

export type RemoteError = 'signed_out' | 'offline' | 'failed';
export type Remote<T> = ({ ok: true } & T) | { ok: false; error: RemoteError };

export interface VoiceServerSettings {
  language: string;
  cleanupMode: 'raw' | 'clean' | 'formal' | 'per_app';
  aiCleanup: boolean;
  styles: Record<'email' | 'chat' | 'note' | 'other', 'formal' | 'neutral' | 'casual'>;
}

export interface DictionaryEntryView {
  id: string;
  kind: 'word' | 'replace' | 'snippet';
  phrase: string;
  replacement: string;
  shared?: boolean;
}

export interface HistoryItemView {
  id: string;
  text: string;
  sourceApp: string;
  capture: string;
  startedAt: string;
  durationMs: number;
}

export interface HudState {
  phase: 'hidden' | 'recording' | 'working' | 'done' | 'error';
  label: string;
  hint: string;
  startedAt: number | null;
  maxMs: number;
}

export const api = {
  get: () => invoke<SettingsView>('settings_get'),
  save: (input: SettingsInput) => invoke<{ ok: boolean; error?: string; view?: SettingsView }>('settings_save', { input }),
  ask: (kind: PermissionKind) => invoke<SettingsView>('permission_ask', { kind }),
  onRefresh: (cb: () => void) => void listen('settings://refresh', () => cb()),
  onTab: (cb: (tab: string) => void) => void listen<string>('settings://tab', (e) => cb(String(e.payload))),
  voiceGet: () => invoke<Remote<{ settings: VoiceServerSettings }>>('voice_get'),
  voiceSave: (patch: Partial<VoiceServerSettings>) => invoke<Remote<{ settings: VoiceServerSettings }>>('voice_save', { patch }),
  dictionaryList: () => invoke<Remote<{ entries: DictionaryEntryView[] }>>('dictionary_list'),
  dictionaryAdd: (input: { kind: string; phrase: string; replacement?: string }) => invoke<Remote<{ id: string }>>('dictionary_add', { input }),
  dictionaryDelete: (id: string) => invoke<Remote<{ deleted: true }>>('dictionary_delete', { id }),
  historyList: () => invoke<Remote<{ items: HistoryItemView[] }>>('history_list'),
  historyCopy: (text: string) => invoke<boolean>('history_copy', { text }),
  historyPaste: (text: string) => invoke<'pasted' | 'copied'>('history_paste', { text }),
  pendingRetry: (id: string) => invoke<{ ok: boolean; text?: string; failure?: Failure; view: SettingsView }>('pending_retry', { id }),
  pendingDiscard: (id: string) => invoke<SettingsView>('pending_discard', { id }),
  signIn: () => invoke<void>('account_sign_in'),
  signOut: () => invoke<SettingsView>('account_sign_out'),
  openVoice: (which: 'history' | 'settings' | 'download') => invoke<void>('open_voice', { which }),
};

/** "0:07", "1:30": el reloj del HUD y la duración en el historial. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

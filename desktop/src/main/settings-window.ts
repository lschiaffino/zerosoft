/**
 * Ventana de Ajustes y bienvenida (archivo local con su propio preload):
 *
 * - Primeros pasos: sesión, micrófono, Accesibilidad (con links a Ajustes
 *   del Sistema y el estado al día) y un cuadro para probar el dictado.
 * - General: modo (mantener, alternar o los dos), atajos, portapapeles,
 *   abrir al iniciar, avisos de reuniones.
 * - Voice, Diccionario e Historial: lo mismo que /app/voice/settings y
 *   /app/voice/dictation, leído y guardado en el servidor con la sesión de
 *   la app. Más los dictados que no llegaron (para mandarlos de nuevo).
 * - Cuenta: sesión, servidor, versión y actualizaciones.
 *
 * Se abre sola la primera vez. Cada IPC valida que venga de esta ventana.
 */
import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import path from 'path';
import { HOTKEYS, hotkeyLabel } from '../shared/hotkey';
import {
  IPC,
  type AccountView,
  type DictionaryEntryView,
  type HistoryItemView,
  type PermissionKind,
  type Remote,
  type RemoteError,
  type SettingsInput,
  type SettingsView,
  type VoiceServerSettings,
} from '../shared/ipc';
import { normalizeServer } from '../shared/nav';
import { mergeSettingsInput, pasteLastShortcut, TOGGLE_SHORTCUTS } from '../shared/settings';
import { apiJson } from './api';
import { beginLogin, signOut } from './auth';
import { getSettings, saveSettings } from './config';
import { dictationAvailable, lastLatency, retryPending, toggleShortcutTaken } from './dictation';
import { insertIntoPreviousApp } from './paste';
import { discardPending, listPending } from './pending';
import { allPermissions, askPermission } from './permissions';
import { locale, t, TEST_MODE } from './state';
import { testHooks } from './test-hooks';
import { updateMode } from './updater';

let win: BrowserWindow | null = null;
let onChange: (prev: { server: string }) => void = () => undefined;
let openApp: (pathname: string) => void = () => undefined;
let account: AccountView = { signedIn: false, email: '', name: '', offline: false };

function settingsUrl() {
  return `file://${path.join(__dirname, 'settings.html')}`;
}

async function refreshAccount(): Promise<AccountView> {
  // La misma ruta que el contador del dock (getCurrentUser): 401 = sin sesión.
  const { status, data } = await apiJson<{ user?: { email?: string; name?: string } }>('/api/desktop/badge');
  if (status === 0) account = { ...account, offline: true };
  else if (status === 401) account = { signedIn: false, email: '', name: '', offline: false };
  else {
    const email = String(data?.user?.email ?? '');
    account = { signedIn: !!email, email, name: String(data?.user?.name ?? ''), offline: false };
  }
  return account;
}

function view(): SettingsView {
  const s = getSettings();
  return {
    locale: locale(),
    platform: process.platform,
    version: app.getVersion(),
    server: s.server,
    mode: s.mode,
    hotkey: s.hotkey,
    hotkeys: HOTKEYS.map((id) => ({ id, label: hotkeyLabel(id, process.platform) })),
    toggleShortcut: s.toggleShortcut,
    toggleShortcuts: Array.from(new Set([...TOGGLE_SHORTCUTS, s.toggleShortcut])),
    toggleTaken: toggleShortcutTaken(),
    pasteLastShortcut: pasteLastShortcut(process.platform),
    restoreClipboard: s.restoreClipboard,
    meetingAlerts: s.meetingAlerts,
    openAtLogin: TEST_MODE ? false : app.getLoginItemSettings().openAtLogin,
    onboarded: s.onboarded,
    holdReady: dictationAvailable(),
    permissions: allPermissions(),
    account,
    pending: listPending(),
    lastLatencyMs: lastLatency(),
    updates: updateMode(),
    strings: t() as unknown as Record<string, string>,
  };
}

async function fullView(): Promise<SettingsView> {
  await refreshAccount();
  return view();
}

function fromSettings(e: Electron.IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents && e.senderFrame?.url.startsWith(settingsUrl()) === true;
}

function remoteError(status: number): RemoteError {
  if (status === 0) return 'offline';
  if (status === 401) return 'signed_out';
  return 'failed';
}

async function remote<T, R>(pathname: string, init: RequestInit, pick: (data: T) => R | null): Promise<Remote<R>> {
  const { status, data } = await apiJson<T>(pathname, init);
  if (status < 200 || status >= 300 || !data) return { ok: false, error: remoteError(status) };
  const picked = pick(data);
  return picked ? { ok: true, ...picked } : { ok: false, error: 'failed' };
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function pickVoice(s: Partial<VoiceServerSettings> | undefined): { settings: VoiceServerSettings } | null {
  if (!s || typeof s !== 'object' || !s.styles) return null;
  return { settings: { language: String(s.language ?? 'auto'), cleanupMode: s.cleanupMode ?? 'per_app', aiCleanup: s.aiCleanup !== false, styles: s.styles } };
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export function setupSettingsIpc(changed: (prev: { server: string }) => void, open: (pathname: string) => void) {
  onChange = changed;
  openApp = open;
  ipcMain.handle(IPC.settingsGet, async (e) => (fromSettings(e) ? fullView() : null));
  ipcMain.handle(IPC.settingsSave, async (e, input: SettingsInput) => {
    if (!fromSettings(e) || !input || typeof input !== 'object') return { ok: false };
    const prev = { server: getSettings().server };
    const patch = mergeSettingsInput(getSettings(), input);
    if (input.server !== undefined) {
      const server = normalizeServer(input.server);
      if (!server) return { ok: false, error: 'server' };
      patch.server = server;
    }
    if (input.onboarded === true) patch.onboarded = true;
    saveSettings(patch);
    if (typeof input.openAtLogin === 'boolean' && process.platform !== 'linux' && !TEST_MODE) app.setLoginItemSettings({ openAtLogin: input.openAtLogin });
    onChange(prev);
    return { ok: true, view: await fullView() };
  });
  ipcMain.handle(IPC.permissionAsk, async (e, kind: PermissionKind) => {
    if (!fromSettings(e) || !['microphone', 'accessibility', 'screen'].includes(kind)) return null;
    await askPermission(kind);
    return view();
  });

  // Voice en el servidor.
  ipcMain.handle(IPC.voiceGet, async (e) => {
    if (!fromSettings(e)) return null;
    return remote<{ settings?: Partial<VoiceServerSettings> }, { settings: VoiceServerSettings }>('/api/voice/settings', {}, (d) => pickVoice(d.settings));
  });
  ipcMain.handle(IPC.voiceSave, async (e, patch: Partial<VoiceServerSettings>) => {
    if (!fromSettings(e) || !patch || typeof patch !== 'object') return null;
    // El servidor valida cada campo (zod): acá solo se filtra la forma.
    const body: Record<string, unknown> = {};
    if (typeof patch.language === 'string') body.language = patch.language.slice(0, 8);
    if (typeof patch.cleanupMode === 'string') body.cleanupMode = patch.cleanupMode.slice(0, 10);
    if (typeof patch.aiCleanup === 'boolean') body.aiCleanup = patch.aiCleanup;
    if (patch.styles && typeof patch.styles === 'object') body.styles = patch.styles;
    return remote<{ settings?: Partial<VoiceServerSettings> }, { settings: VoiceServerSettings }>(
      '/api/voice/settings',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (d) => pickVoice(d.settings),
    );
  });
  ipcMain.handle(IPC.dictionaryList, async (e) => {
    if (!fromSettings(e)) return null;
    return remote<{ entries?: DictionaryEntryView[] }, { entries: DictionaryEntryView[] }>('/api/voice/dictionary', {}, (d) =>
      Array.isArray(d.entries)
        ? { entries: d.entries.map((x) => ({ id: str(x.id, 64), kind: x.kind, phrase: str(x.phrase, 200), replacement: str(x.replacement, 2000), shared: x.shared === true })) }
        : null,
    );
  });
  ipcMain.handle(IPC.dictionaryAdd, async (e, input: { kind?: unknown; phrase?: unknown; replacement?: unknown }) => {
    if (!fromSettings(e) || !input || typeof input !== 'object') return null;
    const kind = input.kind === 'replace' ? 'replace' : 'word';
    return remote<{ id?: string }, { id: string }>('/api/voice/dictionary', json({ kind, phrase: str(input.phrase, 100).trim(), ...(kind === 'replace' ? { replacement: str(input.replacement, 2000) } : {}) }), (d) => ({
      id: str(d.id, 64),
    }));
  });
  ipcMain.handle(IPC.dictionaryDelete, async (e, id: unknown) => {
    if (!fromSettings(e) || typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
    return remote<{ ok?: boolean }, { deleted: true }>(`/api/voice/dictionary/${encodeURIComponent(id)}`, { method: 'DELETE' }, (d) => (d.ok ? { deleted: true } : null));
  });
  ipcMain.handle(IPC.historyList, async (e) => {
    if (!fromSettings(e)) return null;
    return remote<{ sessions?: HistoryItemView[] }, { items: HistoryItemView[] }>('/api/voice/sessions?kind=dictation&limit=50', {}, (d) =>
      Array.isArray(d.sessions)
        ? {
            items: d.sessions.map((x) => ({
              id: str(x.id, 64),
              text: str(x.text, 20_000),
              sourceApp: str(x.sourceApp, 100),
              capture: str(x.capture, 20),
              startedAt: str(x.startedAt, 40),
              durationMs: Number(x.durationMs) || 0,
            })),
          }
        : null,
    );
  });
  ipcMain.handle(IPC.historyCopy, (e, text: unknown) => {
    if (!fromSettings(e) || typeof text !== 'string' || !text) return false;
    if (TEST_MODE) testHooks.pasted.push(text.slice(0, 20_000));
    else clipboard.writeText(text.slice(0, 20_000));
    return true;
  });
  ipcMain.handle(IPC.historyPaste, async (e, text: unknown) => {
    if (!fromSettings(e) || typeof text !== 'string' || !text) return null;
    return insertIntoPreviousApp(text.slice(0, 20_000), () => win?.hide());
  });
  ipcMain.handle(IPC.pendingRetry, async (e, id: unknown) => {
    if (!fromSettings(e)) return null;
    const res = await retryPending(id);
    return { ...res, view: view() };
  });
  ipcMain.handle(IPC.pendingDiscard, (e, id: unknown) => {
    if (!fromSettings(e)) return null;
    discardPending(id);
    return view();
  });
  ipcMain.handle(IPC.accountSignIn, async (e) => {
    if (!fromSettings(e)) return;
    await beginLogin();
  });
  ipcMain.handle(IPC.accountSignOut, async (e) => {
    if (!fromSettings(e)) return null;
    await signOut();
    onChange({ server: getSettings().server });
    return fullView();
  });
  ipcMain.handle(IPC.openVoice, (e, which: unknown) => {
    if (!fromSettings(e)) return;
    if (which === 'download') void shell.openExternal(new URL('/download', getSettings().server).toString());
    else openApp(which === 'settings' ? '/app/voice/settings' : '/app/voice/dictation');
  });
}

/** Avisar a la ventana que algo cambió afuera (permiso dado, sesión, dictado guardado). */
export function refreshSettings() {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.settingsGet);
}

export type SettingsTab = 'start' | 'general' | 'voice' | 'dictionary' | 'history' | 'account';

export function openSettings(tab?: SettingsTab) {
  if (win && !win.isDestroyed()) {
    if (tab) win.webContents.send(IPC.settingsTab, tab);
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 380,
    minHeight: 480,
    title: t().settingsTitle,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => {
    if (!TEST_MODE) win?.show();
  });
  // Al volver a la ventana (después de dar un permiso en Ajustes del Sistema) se refresca el estado.
  win.on('focus', () => refreshSettings());
  win.on('closed', () => {
    win = null;
    if (!getSettings().onboarded) saveSettings({ onboarded: true });
  });
  const url = new URL(settingsUrl());
  if (tab) url.hash = tab;
  void win.loadURL(url.toString());
}

export function settingsWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/**
 * Ventana de Ajustes y bienvenida (archivo local con su propio preload):
 * servidor, atajo de dictado, permisos de macOS, avisos de reuniones y abrir
 * al iniciar. Se abre sola la primera vez (onboarding de permisos).
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { HOTKEYS, hotkeyLabel, isHotkeyId } from '../shared/hotkey';
import { IPC, type PermissionKind, type SettingsInput, type SettingsView } from '../shared/ipc';
import { normalizeServer } from '../shared/nav';
import { getSettings, saveSettings } from './config';
import { allPermissions, askPermission } from './permissions';
import { locale, t } from './state';

let win: BrowserWindow | null = null;
let onChange: (prev: { server: string }) => void = () => undefined;

function settingsUrl() {
  return `file://${path.join(__dirname, 'settings.html')}`;
}

function view(): SettingsView {
  const s = getSettings();
  return {
    locale: locale(),
    platform: process.platform,
    server: s.server,
    hotkey: s.hotkey,
    hotkeys: HOTKEYS.map((id) => ({ id, label: hotkeyLabel(id, process.platform) })),
    toggleShortcut: s.toggleShortcut,
    meetingAlerts: s.meetingAlerts,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    permissions: allPermissions(),
    strings: t() as unknown as Record<string, string>,
  };
}

function fromSettings(e: Electron.IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents && e.senderFrame?.url.startsWith(settingsUrl()) === true;
}

export function setupSettingsIpc(changed: (prev: { server: string }) => void) {
  onChange = changed;
  ipcMain.handle(IPC.settingsGet, (e) => (fromSettings(e) ? view() : null));
  ipcMain.handle(IPC.settingsSave, (e, input: SettingsInput) => {
    if (!fromSettings(e) || !input || typeof input !== 'object') return { ok: false };
    const server = normalizeServer(input.server);
    if (!server) return { ok: false, error: 'server' };
    const prev = { server: getSettings().server };
    saveSettings({
      server,
      hotkey: isHotkeyId(input.hotkey) ? input.hotkey : getSettings().hotkey,
      meetingAlerts: input.meetingAlerts !== false,
      onboarded: true,
    });
    if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: input.openAtLogin === true });
    onChange(prev);
    return { ok: true, view: view() };
  });
  ipcMain.handle(IPC.permissionAsk, async (e, kind: PermissionKind) => {
    if (!fromSettings(e) || !['microphone', 'accessibility', 'screen'].includes(kind)) return null;
    await askPermission(kind);
    return view();
  });
}

export function openSettings() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 420,
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
  win.once('ready-to-show', () => win?.show());
  // Al volver a la ventana (después de dar un permiso en Ajustes del Sistema) se refresca el estado.
  win.on('focus', () => win?.webContents.send(IPC.settingsGet));
  win.on('closed', () => {
    win = null;
    if (!getSettings().onboarded) saveSettings({ onboarded: true });
  });
  void win.loadURL(settingsUrl());
}

/** Ícono de la barra de menú (Mac) o de la bandeja (Windows) y su menú. */
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { pasteLastShortcut, usesHold, usesToggle } from '../shared/settings';
import { fill } from '../shared/strings';
import { signOut } from './auth';
import { getSettings } from './config';
import { hotkeyText, isRecording, pasteLast, retryAllPending, startDictation, stopDictation } from './dictation';
import { startNotes } from './meetings';
import { listPending } from './pending';
import { openSettings } from './settings-window';
import { getMainWindow, server, t } from './state';
import { checkNow } from './updater';
import { showMainWindow } from './window';

let tray: Tray | null = null;

function icon() {
  const dir = path.join(__dirname, '..', 'build');
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(path.join(dir, 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(dir, 'tray-win.png'));
}

/** Menú de la bandeja (puro respecto de Electron salvo los clics): también lo leen los e2e. */
export function trayTemplate(): MenuItemConstructorOptions[] {
  const s = t();
  const settings = getSettings();
  const pending = listPending().length;
  const recording = isRecording();
  const hint = usesHold(settings.mode) ? fill(s.dictateHint, { key: hotkeyText() }) : null;
  return [
    { label: s.open, click: () => showMainWindow() },
    { type: 'separator' },
    recording
      ? { id: 'dictate', label: s.dictateStop, accelerator: usesToggle(settings.mode) ? settings.toggleShortcut : undefined, click: () => void stopDictation() }
      : { id: 'dictate', label: s.dictateStart, accelerator: usesToggle(settings.mode) ? settings.toggleShortcut : undefined, click: () => startDictation({ handsFree: true, via: usesToggle(settings.mode) ? 'toggle' : 'hold' }) },
    ...(hint ? [{ label: hint, enabled: false }] : []),
    { id: 'paste-last', label: s.pasteLastItem, accelerator: pasteLastShortcut(process.platform), click: () => void pasteLast() },
    ...(pending ? [{ id: 'retry', label: fill(s.retryPendingItem, { n: pending }), click: () => void retryAllPending() }] : []),
    { id: 'history', label: s.historyItem, click: () => openSettings('history') },
    { type: 'separator' },
    { label: s.startNotes, click: () => startNotes() },
    { type: 'separator' },
    { label: s.settings, click: () => openSettings() },
    { label: s.checkUpdates, click: () => void checkNow() },
    {
      label: s.signOut,
      click: async () => {
        await signOut();
        void getMainWindow()?.loadURL(new URL('/app', server()).toString());
      },
    },
    { type: 'separator' },
    { label: s.quit, click: () => app.quit() },
  ];
}

export function buildTrayMenu() {
  if (!tray) return;
  // Los aceleradores del menú son solo para mostrar: los registra globalShortcut.
  const template = trayTemplate().map((i) => (i.accelerator ? { ...i, registerAccelerator: false } : i));
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

export function createTray() {
  if (tray) return tray;
  tray = new Tray(icon());
  tray.setToolTip('zerosoft');
  buildTrayMenu();
  // Windows: clic en el ícono abre la ventana (el menú va con clic derecho).
  if (process.platform === 'win32') tray.on('click', () => showMainWindow());
  return tray;
}

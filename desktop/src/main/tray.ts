/** Ícono de la barra de menú (Mac) o de la bandeja (Windows) y su menú. */
import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'path';
import { fill } from '../shared/strings';
import { signOut } from './auth';
import { hotkeyText } from './dictation';
import { startNotes } from './meetings';
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

export function buildTrayMenu() {
  if (!tray) return;
  const s = t();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: s.open, click: () => showMainWindow() },
      { label: s.startNotes, click: () => startNotes() },
      { label: fill(s.dictateHint, { key: hotkeyText() }), enabled: false },
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
    ]),
  );
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

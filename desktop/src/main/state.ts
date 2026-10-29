/** Estado compartido del proceso main (ventana, sesión, idioma). */
import { app, session, type BrowserWindow, type Session } from 'electron';
import { pickLocale, strings, type Locale } from '../shared/strings';
import { getSettings } from './config';

export const PARTITION = 'persist:zerosoft';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function appSession(): Session {
  return session.fromPartition(PARTITION);
}

export function server(): string {
  return getSettings().server;
}

export function locale(): Locale {
  return pickLocale(app.getLocale());
}

export function t() {
  return strings(locale());
}

/** e2e (Playwright _electron): sin efectos del sistema (navegador, portapapeles real, avisos visibles). */
export const TEST_MODE = process.env.ZEROSOFT_DESKTOP_TEST === '1';

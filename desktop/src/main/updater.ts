/**
 * Actualizaciones automáticas con electron-updater. El feed es
 * https://zerosoft.ai/api/desktop/update (proveedor generic): el servidor
 * sirve latest-mac.yml / latest.yml del último release desktop-v* de GitHub
 * con las URLs de descarga absolutas. Así los tags del escritorio conviven
 * con otros releases del repo.
 *
 * Windows: se bajan y se instalan solas (sha512 contra latest.yml).
 *
 * Mac con firma ad hoc (sin cuenta de Apple Developer): Squirrel.Mac exige
 * que la versión nueva cumpla el "designated requirement" de la instalada, y
 * una firma ad hoc solo se cumple a sí misma. Entonces no se baja nada: se
 * avisa que hay versión nueva y el aviso abre la página de descarga.
 */
import { app, dialog, Notification, shell } from 'electron';
import { spawnSync } from 'child_process';
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { fill } from '../shared/strings';
import { server, t, TEST_MODE } from './state';
import { devEnv } from './dev-env';

// El feed es fijo en la app empaquetada (devEnv no lee el entorno ahí).
const FEED = devEnv('ZEROSOFT_UPDATE_URL') || 'https://zerosoft.ai/api/desktop/update';
const EVERY_MS = 4 * 60 * 60_000;
let started = false;
let mode: 'auto' | 'manual' | 'dev' | null = null;
let notifiedVersion = '';

/** El paquete .app no tiene una identidad de Apple (firma ad hoc o ninguna). codesign escribe en stderr. */
function adhocCheck(): boolean {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  const res = spawnSync('codesign', ['-dv', bundle], { encoding: 'utf8', timeout: 5000 });
  return res.status !== 0 || /Signature=adhoc/.test(String(res.stderr ?? ''));
}

/** Cómo se actualiza esta copia: sola, a mano desde /download (Mac sin firma de Apple) o nada (desarrollo). */
export function updateMode(): 'auto' | 'manual' | 'dev' {
  if (mode) return mode;
  if (!app.isPackaged || TEST_MODE) mode = 'dev';
  else if (process.platform === 'darwin' && adhocCheck()) mode = 'manual';
  else mode = 'auto';
  return mode;
}

function downloadUrl() {
  return new URL('/download', server()).toString();
}

function notifyManual(version: string) {
  if (!version || version === notifiedVersion || !Notification.isSupported()) return;
  notifiedVersion = version;
  const n = new Notification({ title: fill(t().updateAvailable, { v: version }), body: t().updateAvailableBody });
  n.on('click', () => void shell.openExternal(downloadUrl()));
  n.show();
}

export function setupUpdater() {
  if (started || updateMode() === 'dev') return;
  started = true;
  const manual = updateMode() === 'manual';
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED });
  autoUpdater.autoDownload = !manual;
  autoUpdater.autoInstallOnAppQuit = !manual;
  autoUpdater.on('error', (err) => console.error('[updater]', err?.message ?? err));
  autoUpdater.on('update-available', (info) => {
    if (manual) notifyManual(info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: t().updateReady, body: fill(t().updateReadyBody, { v: info.version }) });
    n.on('click', () => autoUpdater.quitAndInstall());
    n.show();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => null);
  setTimeout(check, 30_000);
  setInterval(check, EVERY_MS);
}

/** "Buscar actualizaciones" de la bandeja: dice el resultado. */
export async function checkNow() {
  if (updateMode() === 'dev') {
    await dialog.showMessageBox({ message: t().upToDate, detail: `v${app.getVersion()} (dev)` });
    return;
  }
  const result = await autoUpdater.checkForUpdates().catch(() => null);
  const next = result?.updateInfo?.version;
  if (!next || next === app.getVersion()) {
    await dialog.showMessageBox({ message: t().upToDate, detail: `v${app.getVersion()}` });
    return;
  }
  if (updateMode() === 'manual') {
    const { response } = await dialog.showMessageBox({
      message: fill(t().updateAvailable, { v: next }),
      detail: t().updatesManual,
      buttons: [t().download, 'OK'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) void shell.openExternal(downloadUrl());
  }
}

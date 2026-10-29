/**
 * Actualizaciones automáticas con electron-updater. El feed es
 * https://zerosoft.ai/api/desktop/update (proveedor generic): el servidor
 * sirve latest-mac.yml / latest.yml del último release desktop-v* de GitHub
 * con las URLs de descarga absolutas. Así los tags del escritorio conviven
 * con otros releases del repo.
 *
 * En Mac, Squirrel solo instala builds firmadas: sin firma el chequeo falla
 * en silencio y la página /download sigue siendo el camino.
 */
import { app, dialog, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { fill } from '../shared/strings';
import { t, TEST_MODE } from './state';

const FEED = process.env.ZEROSOFT_UPDATE_URL || 'https://zerosoft.ai/api/desktop/update';
const EVERY_MS = 4 * 60 * 60_000;
let started = false;

export function setupUpdater() {
  if (started || !app.isPackaged || TEST_MODE) return;
  started = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: FEED });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.error('[updater]', err?.message ?? err));
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
  if (!app.isPackaged) {
    await dialog.showMessageBox({ message: t().upToDate, detail: `v${app.getVersion()} (dev)` });
    return;
  }
  const result = await autoUpdater.checkForUpdates().catch(() => null);
  const next = result?.updateInfo?.version;
  if (!next || next === app.getVersion()) await dialog.showMessageBox({ message: t().upToDate, detail: `v${app.getVersion()}` });
}

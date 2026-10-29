/**
 * zerosoft para escritorio (Electron): la plataforma entera en una ventana
 * (<servidor>/app), más lo que el navegador no puede: dictado en cualquier
 * app, notas de reunión con audio del sistema, avisos nativos y contador en
 * el dock, deep links zerosoft:// y abrir al iniciar.
 *
 * Seguridad: contextIsolation + sandbox sin Node en todas las ventanas; el
 * preload de la app solo se expone al origen del servidor y cada IPC valida
 * quién lo manda; lista de navegación estricta (window.ts); los deep links se
 * validan campo por campo (shared/deeplink.ts); la sesión se guarda cifrada
 * con safeStorage (auth.ts).
 */
import { app, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { deepLinkFromArgv, parseDeepLink, PROTOCOL } from '../shared/deeplink';
import { isAppUrl } from '../shared/nav';
import { IPC, type AppInfo } from '../shared/ipc';
import { getSettings } from './config';
import { beginLogin, completeLogin, restoreSession, watchSessionCookie } from './auth';
import { pollBadge, startBadgePolling } from './badge';
import { dictationAvailable, setupDictation, startDictation, startHotkeys, stopDictation, stopHotkeys } from './dictation';
import { startMeetingWatch, startNotes } from './meetings';
import { openSettings, setupSettingsIpc } from './settings-window';
import { getMainWindow, server, TEST_MODE } from './state';
import { buildTrayMenu, createTray } from './tray';
import { setupUpdater } from './updater';
import { createMainWindow, openAppPath, setQuitting, setupSessionPermissions, showMainWindow } from './window';
import { testHooks } from './test-hooks';

// Audio del sistema en Mac 13+ (ScreenCaptureKit) para getDisplayMedia con loopback.
app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');

// e2e: micrófono falso sin diálogo (el overlay graba un tono de prueba).
if (TEST_MODE) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

// Datos aparte en los e2e (no pisan la sesión de la app instalada).
if (process.env.ZEROSOFT_USER_DATA) app.setPath('userData', path.resolve(process.env.ZEROSOFT_USER_DATA));

let ready = false;
let queuedLink: string | null = null;

async function handleDeepLink(raw: string) {
  if (!ready) {
    queuedLink = raw;
    return;
  }
  const link = parseDeepLink(raw);
  if (!link) return;
  if (link.kind === 'auth') {
    const ok = await completeLogin(link.code, link.state);
    const win = showMainWindow();
    if (ok) {
      await win.loadURL(new URL('/app', server()).toString());
      void pollBadge();
    }
    return;
  }
  if (link.kind === 'open') openAppPath(link.path);
  else if (link.kind === 'notes') startNotes();
}

function registerProtocol() {
  if (TEST_MODE) return;
  if (process.defaultApp && process.argv.length >= 2) {
    // Desarrollo (electron .): el sistema tiene que relanzar con el path del proyecto.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

/** El IPC de la ventana de la app solo vale desde el origen del servidor. */
function fromApp(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const win = getMainWindow();
  return !!win && e.sender === win.webContents && isAppUrl(e.senderFrame?.url ?? '', server());
}

function setupAppIpc() {
  ipcMain.on(IPC.appInfo, (e) => {
    const info: AppInfo | null = fromApp(e)
      ? {
          version: app.getVersion(),
          platform: process.platform,
          systemAudio: process.platform === 'win32' || process.platform === 'darwin',
          dictation: dictationAvailable(),
        }
      : null;
    // El preload pregunta también en páginas de otro origen (antes de exponer nada): ahí recibe null.
    e.returnValue = info ? { ...info, server: server() } : null;
  });
  ipcMain.on(IPC.startLogin, (e) => {
    if (fromApp(e)) void beginLogin();
  });
  ipcMain.on(IPC.openSettings, (e) => {
    if (fromApp(e)) openSettings();
  });
}

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: 'appMenu' as const,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => openSettings() },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : [{ role: 'fileMenu' as const }]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => getMainWindow()?.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => getMainWindow()?.webContents.navigationHistory.goForward() },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows/Linux: el deep link llega como argumento de una segunda instancia.
  app.on('second-instance', (_e, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) void handleDeepLink(link);
    else showMainWindow();
  });
  // Mac: el deep link llega por open-url (también antes de ready).
  app.on('open-url', (e, url) => {
    e.preventDefault();
    void handleDeepLink(url);
  });

  app.on('web-contents-created', (_e, contents) => {
    // Ninguna ventana nueva navega fuera de lo suyo (las de la app pasan por window.ts).
    if (contents.getType() === 'webview') contents.close();
  });

  app.whenReady().then(async () => {
    registerProtocol();
    setupMenu();
    setupSessionPermissions();
    setupAppIpc();
    setupSettingsIpc((prev) => {
      startHotkeys();
      buildTrayMenu();
      if (prev.server !== server()) {
        void restoreSession().finally(() => void getMainWindow()?.loadURL(new URL('/app', server()).toString()));
      }
    });
    await restoreSession();
    watchSessionCookie();
    createMainWindow();
    createTray();
    setupDictation();
    startBadgePolling();
    startMeetingWatch();
    setupUpdater();
    if (!getSettings().onboarded && process.platform === 'darwin' && !TEST_MODE) openSettings();
    ready = true;
    const pending = queuedLink ?? deepLinkFromArgv(process.argv);
    queuedLink = null;
    if (pending) void handleDeepLink(pending);
  });

  app.on('activate', () => showMainWindow());
  app.on('before-quit', () => {
    setQuitting();
    stopHotkeys();
  });
  // La app sigue en la bandeja con la ventana cerrada (dictado y avisos); en Windows también.
  app.on('window-all-closed', () => undefined);
}

testHooks.deepLink = handleDeepLink;
testHooks.pollBadge = pollBadge;
testHooks.startDictation = startDictation;
testHooks.stopDictation = stopDictation;
testHooks.startNotes = startNotes;

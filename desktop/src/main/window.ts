/**
 * Ventana principal: carga <servidor>/app con el preload mínimo, recuerda
 * tamaño y posición, y aplica la lista de navegación (shared/nav.ts):
 * adentro solo el origen del servidor; Google login va al navegador por el
 * flujo de auth.ts; el resto de los links, al navegador del sistema.
 *
 * Permisos de la sesión: micrófono, audio del sistema (captura de pantalla
 * sin selector, solo para grabar reuniones), avisos y portapapeles, y
 * únicamente para el origen del servidor. Todo lo demás se niega.
 */
import { BrowserWindow, clipboard, desktopCapturer, Menu, nativeTheme, screen, shell, type MenuItemConstructorOptions, type WebContents } from 'electron';
import path from 'path';
import { classifyNavigation, isAppUrl, safeAppPath } from '../shared/nav';
import { getWindowState, saveWindowState } from './config';
import { beginLogin, isSignedIn } from './auth';
import { appSession, getMainWindow, PARTITION, server, setMainWindow, TEST_MODE } from './state';
import { testHooks } from './test-hooks';

let quitting = false;
export function setQuitting() {
  quitting = true;
}

const ALLOWED_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'display-capture', 'speaker-selection']);

function openExternal(url: string) {
  if (TEST_MODE) {
    testHooks.openedExternal.push(url);
    return;
  }
  void shell.openExternal(url);
}

/** Qué hacer con una navegación fuera de la app. Devuelve true si hay que cancelarla. */
function guard(url: string): boolean {
  const kind = classifyNavigation(url, server());
  if (kind === 'app') return false;
  if (kind === 'google-login') {
    // Sin sesión es el login: va por el navegador del sistema y vuelve por deep link.
    // Con sesión es conectar una integración (Calendar, Gmail): se completa en el navegador.
    if (isSignedIn()) openExternal(url);
    else void beginLogin();
    return true;
  }
  if (kind === 'external') openExternal(url);
  return true;
}

export function hardenContents(contents: WebContents) {
  contents.on('will-navigate', (e, url) => {
    if (guard(url)) e.preventDefault();
  });
  contents.on('will-redirect', (e, url) => {
    if (guard(url)) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  // Menú contextual (Electron no trae uno): ortografía, cortar, copiar, pegar y copiar link.
  contents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    for (const word of p.dictionarySuggestions.slice(0, 4)) items.push({ label: word, click: () => contents.replaceMisspelling(word) });
    if (p.misspelledWord) items.push({ label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    if (p.linkURL && /^(https?|mailto):/.test(p.linkURL)) items.push({ label: 'Copy link', click: () => void clipboard.writeText(p.linkURL) }, { type: 'separator' });
    if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  contents.setWindowOpenHandler(({ url }) => {
    // Un link de la app con target=_blank abre en la misma ventana (como Slack o Notion).
    if (isAppUrl(url, server())) {
      void contents.loadURL(url);
      return { action: 'deny' };
    }
    guard(url);
    return { action: 'deny' };
  });
}

export function setupSessionPermissions() {
  const ses = appSession();
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl || wc?.getURL() || '';
    callback(isAppUrl(origin, server()) && ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return isAppUrl(requestingOrigin, server()) && ALLOWED_PERMISSIONS.has(permission);
  });
  // Grabar una reunión ("micrófono + audio del sistema"): pantalla principal + loopback, sin selector.
  // La web solo usa la pista de audio. En Mac necesita el permiso de Grabación de pantalla.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isAppUrl(request.securityOrigin || request.frame?.url || '', server())) {
        callback({});
        return;
      }
      // Si macOS deja el pedido colgado (permiso de pantalla pendiente), a los 20 s se sigue sin
      // audio del sistema: la web graba solo el micrófono en vez de quedar trabada.
      const timeout = new Promise<never>((_r, reject) => setTimeout(() => reject(new Error('timeout')), 20_000));
      Promise.race([desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }), timeout])
        .then((sources) => {
          testHooks.displayRequests.push(sources.length ? 'loopback' : 'none');
          if (!sources.length) return callback({});
          callback({ video: sources[0], audio: 'loopback' });
        })
        .catch(() => {
          testHooks.displayRequests.push('none');
          callback({});
        });
    },
    { useSystemPicker: false },
  );
}

export function createMainWindow(): BrowserWindow {
  const state = getWindowState();
  const visible = state.x !== undefined && state.y !== undefined && screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return state.x! < b.x + b.width - 80 && state.x! + state.width > b.x + 80 && state.y! >= b.y - 10 && state.y! < b.y + b.height - 80;
  });
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(visible ? { x: state.x, y: state.y } : {}),
    minWidth: 400,
    minHeight: 500,
    show: false,
    title: 'zerosoft',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#ffffff',
    ...(process.platform === 'win32' ? { icon: path.join(__dirname, '..', 'build', 'icon-256.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload-app.js'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  setMainWindow(win);
  if (state.maximized) win.maximize();
  hardenContents(win.webContents);
  win.once('ready-to-show', () => {
    if (!TEST_MODE || process.env.ZEROSOFT_DESKTOP_SHOW === '1') win.show();
  });

  let timer: NodeJS.Timeout | null = null;
  const remember = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getNormalBounds();
      saveWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
    }, 400);
  };
  win.on('resize', remember);
  win.on('move', remember);
  // Cerrar la ventana la esconde (sigue en la bandeja: dictado, avisos y reuniones); Salir la cierra.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (process.platform === 'darwin' && win.isFullScreen()) {
      win.once('leave-full-screen', () => win.hide());
      win.setFullScreen(false);
    } else win.hide();
  });
  win.on('closed', () => setMainWindow(null));
  void win.loadURL(new URL('/app', server()).toString());
  return win;
}

export function showMainWindow(): BrowserWindow {
  const win = getMainWindow() ?? createMainWindow();
  if (win.isMinimized()) win.restore();
  if (!TEST_MODE || process.env.ZEROSOFT_DESKTOP_SHOW === '1') win.show();
  win.focus();
  return win;
}

/** Abre una página de la app (path validado) en la ventana. */
export function openAppPath(rawPath: string): boolean {
  const safe = safeAppPath(rawPath);
  if (!safe) return false;
  const win = showMainWindow();
  void win.loadURL(new URL(safe, server()).toString());
  return true;
}

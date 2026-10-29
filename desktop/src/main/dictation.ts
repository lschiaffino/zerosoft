/**
 * Dictado en cualquier app, al estilo Wispr Flow:
 *
 * - Mantener el atajo (uiohook: teclas apretadas y soltadas en todo el
 *   sistema) graba; soltar manda. También hay un atajo de alternar con
 *   globalShortcut, que funciona aunque el hook no tenga permiso.
 * - El overlay (ventana chica sin foco, abajo al centro) graba el micrófono
 *   y muestra el nivel; al terminar devuelve el audio por IPC.
 * - El audio va a POST /api/voice/dictate con la sesión de la ventana: el
 *   servidor transcribe, limpia (diccionario y estilo de la persona) y lo
 *   guarda en el historial de Voice.
 * - El texto se pega en la app que tenía el foco (paste.ts).
 */
import { BrowserWindow, globalShortcut, ipcMain, screen, session, systemPreferences } from 'electron';
import { execFile } from 'child_process';
import path from 'path';
import { contextForApp } from '../shared/dictation';
import { multipartBody } from './multipart';
import { hotkeyLabel, PushToTalk, type HotkeyId } from '../shared/hotkey';
import { IPC, type OverlayAudio, type OverlayPhase, type OverlayState } from '../shared/ipc';
import { fill } from '../shared/strings';
import { apiFetch } from './api';
import { getSettings } from './config';
import { insertText, setPasteHook } from './paste';
import { locale, t, TEST_MODE } from './state';
import { testHooks } from './test-hooks';

type Hook = typeof import('uiohook-napi');

const MAX_MS = 120_000;
const MIN_MS = 300;

let overlay: BrowserWindow | null = null;
let hook: Hook | null = null;
let hookRunning = false;
let ptt: PushToTalk | null = null;
let phase: OverlayPhase = 'hidden';
let maxTimer: NodeJS.Timeout | null = null;
let hideTimer: NodeJS.Timeout | null = null;
let sourceApp = '';
let toggleRegistered = '';

function overlayUrl() {
  return `file://${path.join(__dirname, 'overlay.html')}`;
}

function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    width: 240,
    height: 48,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void win.loadURL(overlayUrl());
  return win;
}

/** El overlay usa la sesión por defecto: micrófono solo para su propio archivo. */
function setupOverlayPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details.requestingUrl || wc?.getURL() || '';
    callback(permission === 'media' && url.startsWith(overlayUrl()));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && origin.startsWith('file://'));
}

function place(win: BrowserWindow) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [w, h] = win.getSize();
  win.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height - h - 24));
}

function send(next: OverlayPhase, label: string) {
  phase = next;
  if (TEST_MODE && label) testHooks.overlayLabels.push(label);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (!overlay || overlay.isDestroyed()) overlay = createOverlay();
  const state: OverlayState = { phase: next, label, locale: locale() };
  overlay.webContents.send(IPC.overlayState, state);
  if (next === 'hidden') {
    overlay.hide();
    return;
  }
  if (!overlay.isVisible()) {
    place(overlay);
    overlay.showInactive();
  }
  if (next === 'done' || next === 'error') {
    hideTimer = setTimeout(() => send('hidden', ''), next === 'error' ? 2600 : 1100);
  }
}

/** App con el foco al empezar (Mac): da el contexto (email, chat, nota) y queda en el historial. */
function frontmostApp(): Promise<string> {
  if (process.platform !== 'darwin' || TEST_MODE) return Promise.resolve('');
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
      { timeout: 1500 },
      (err, stdout) => resolve(err ? '' : String(stdout).trim().slice(0, 100)),
    );
  });
}

export function startDictation() {
  if (phase === 'recording' || phase === 'working') return;
  sourceApp = '';
  void frontmostApp().then((name) => {
    sourceApp = name;
  });
  send('recording', t().listening);
  if (maxTimer) clearTimeout(maxTimer);
  maxTimer = setTimeout(() => void stopDictation(), MAX_MS);
}

export function cancelDictation() {
  if (phase !== 'recording') return;
  if (maxTimer) clearTimeout(maxTimer);
  send('hidden', '');
}

function waitForAudio(timeoutMs: number): Promise<OverlayAudio | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener(IPC.overlayAudio, onAudio);
      resolve(null);
    }, timeoutMs);
    function onAudio(e: Electron.IpcMainEvent, payload: OverlayAudio) {
      if (!overlay || e.sender !== overlay.webContents) return;
      clearTimeout(timer);
      ipcMain.removeListener(IPC.overlayAudio, onAudio);
      resolve(payload && typeof payload === 'object' ? payload : null);
    }
    ipcMain.on(IPC.overlayAudio, onAudio);
  });
}

/** Esperar a que se suelten todas las teclas antes de simular el pegado (Control apretado cambiaría Cmd+V). */
async function keysReleased(ms: number) {
  const until = Date.now() + ms;
  while (ptt && ptt.anyDown() && Date.now() < until) await new Promise((r) => setTimeout(r, 30));
}

export async function stopDictation() {
  if (phase !== 'recording') return;
  if (maxTimer) clearTimeout(maxTimer);
  const audioP = waitForAudio(5000);
  send('working', t().working);
  const audio = await audioP;
  if (!audio || audio.error) {
    send('error', audio?.error === 'mic_denied' ? t().errMic : t().errFailed);
    return;
  }
  if (!audio.audio || audio.durationMs < MIN_MS) {
    send('hidden', '');
    return;
  }
  const mime = /^audio\/(webm|ogg|mp4|wav)/.test(audio.mime) ? audio.mime.split(';')[0] : 'audio/webm';
  const { body, contentType } = multipartBody(
    { context: contextForApp(sourceApp), sourceApp: sourceApp || 'desktop', durationMs: String(Math.round(audio.durationMs)) },
    { field: 'audio', name: `dictation.${mime === 'audio/mp4' ? 'm4a' : mime.split('/')[1]}`, type: mime, data: new Uint8Array(audio.audio) },
  );
  let res: Response | null = null;
  try {
    res = await apiFetch('/api/voice/dictate', { method: 'POST', headers: { 'content-type': contentType }, body });
  } catch {
    res = null;
  }
  const data = (await res?.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (res?.status === 401) {
    send('error', t().errSignedOut);
    return;
  }
  if (!res?.ok || !data) {
    send('error', t().errFailed);
    return;
  }
  const text = (data.text ?? '').trim();
  if (!text) {
    send('error', t().errEmpty);
    return;
  }
  await keysReleased(1500);
  const how = await insertText(text);
  send('done', how === 'pasted' ? t().pasted : fill(t().copied, { key: process.platform === 'darwin' ? '⌘V' : 'Ctrl+V' }));
}

function onAction(action: 'start' | 'stop' | 'cancel' | null) {
  if (action === 'start') startDictation();
  else if (action === 'stop') void stopDictation();
  else if (action === 'cancel') cancelDictation();
}

function loadHook(): Hook | null {
  if (hook) return hook;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hook = require('uiohook-napi') as Hook;
    setPasteHook(hook);
  } catch (err) {
    console.error('[dictation] uiohook unavailable', (err as Error).message);
    hook = null;
  }
  return hook;
}

/** En Mac el hook necesita Accesibilidad: sin ella no se arranca (no avisaría nunca y en algunos sistemas aborta). */
function hookAllowed(): boolean {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

export function startHotkeys() {
  const settings = getSettings();
  ptt = ptt ?? new PushToTalk(settings.hotkey);
  ptt.setCombo(settings.hotkey);
  const h = loadHook();
  if (h && !hookRunning && hookAllowed() && !TEST_MODE) {
    try {
      h.uIOhook.on('keydown', (e) => onAction(ptt?.keyDown(e.keycode, Date.now()) ?? null));
      h.uIOhook.on('keyup', (e) => onAction(ptt?.keyUp(e.keycode, Date.now()) ?? null));
      h.uIOhook.start();
      hookRunning = true;
    } catch (err) {
      console.error('[dictation] hook failed', (err as Error).message);
    }
  }
  if (toggleRegistered !== settings.toggleShortcut) {
    if (toggleRegistered) globalShortcut.unregister(toggleRegistered);
    toggleRegistered = '';
    try {
      const ok = globalShortcut.register(settings.toggleShortcut, () => {
        if (phase === 'recording') void stopDictation();
        else startDictation();
      });
      if (ok) toggleRegistered = settings.toggleShortcut;
    } catch {
      /* atajo inválido u ocupado por otra app */
    }
  }
}

export function stopHotkeys() {
  if (hook && hookRunning) {
    try {
      hook.uIOhook.stop();
    } catch {
      /* ya parado */
    }
    hookRunning = false;
  }
  globalShortcut.unregisterAll();
  toggleRegistered = '';
}

export function setHotkey(id: HotkeyId) {
  ptt?.setCombo(id);
}

export function dictationAvailable(): boolean {
  return hookRunning;
}

export function hotkeyText(): string {
  return hotkeyLabel(getSettings().hotkey, process.platform);
}

export function setupDictation() {
  setupOverlayPermissions();
  overlay = createOverlay();
  startHotkeys();
}

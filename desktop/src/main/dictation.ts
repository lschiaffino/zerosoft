/**
 * Dictado en cualquier app, al estilo Wispr Flow:
 *
 * - Mantener el atajo (uiohook: teclas apretadas y soltadas en todo el
 *   sistema) graba; soltar manda. Dos toques rápidos: manos libres hasta
 *   volver a apretarlo. También hay un atajo de alternar con globalShortcut,
 *   que funciona aunque el hook no tenga permiso. El modo (mantener,
 *   alternar o los dos) se elige en Ajustes.
 * - El overlay (ventana chica sin foco, abajo al centro) graba el micrófono
 *   y muestra el nivel y el reloj; al terminar devuelve el audio por IPC.
 * - El audio va a POST /api/voice/dictate con la sesión de la ventana: el
 *   servidor transcribe, limpia (idioma, modo de limpieza, diccionario y
 *   estilos de la persona) y lo guarda en el historial de Voice.
 * - El texto se pega en la app que tenía el foco (paste.ts).
 * - Si no llega (sin conexión, sesión vencida, error del servidor), el audio
 *   queda guardado para mandarlo de nuevo (pending.ts).
 */
import { BrowserWindow, clipboard, globalShortcut, ipcMain, screen, session, systemPreferences } from 'electron';
import { execFile } from 'child_process';
import path from 'path';
import { contextForApp } from '../shared/dictation';
import { multipartBody } from './multipart';
import { hotkeyLabel, PushToTalk, type HotkeyId, type PttAction } from '../shared/hotkey';
import { IPC, type OverlayAudio, type OverlayPhase, type OverlayState, type RetryResult } from '../shared/ipc';
import { classifyResponse, keepForRetry, type DictationFailure, type DictationOutcome } from '../shared/retry';
import { pasteLastShortcut, usesHold, usesToggle } from '../shared/settings';
import { fill } from '../shared/strings';
import { apiFetch } from './api';
import { getSettings } from './config';
import { insertText, lastInserted, setPasteHook } from './paste';
import { discardPending, listPending, markAttempt, readPending, savePending } from './pending';
import { locale, t, TEST_MODE } from './state';
import { testHooks } from './test-hooks';

type Hook = typeof import('uiohook-napi');

export const MAX_MS = 120_000;
const MIN_MS = 300;

let overlay: BrowserWindow | null = null;
let hook: Hook | null = null;
let hookRunning = false;
let hookPoll: NodeJS.Timeout | null = null;
let ptt: PushToTalk | null = null;
let phase: OverlayPhase = 'hidden';
let maxTimer: NodeJS.Timeout | null = null;
let hideTimer: NodeJS.Timeout | null = null;
let sourceApp = '';
let toggleRegistered = '';
let toggleTaken = false;
let pasteLastRegistered = '';
let escRegistered = false;
let lastLatencyMs: number | null = null;
let changeListener: () => void = () => undefined;

/** La bandeja y Ajustes se enteran cuando empieza o termina un dictado. */
export function onDictationChange(fn: () => void) {
  changeListener = fn;
}

function overlayUrl() {
  return `file://${path.join(__dirname, 'overlay.html')}`;
}

function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 52,
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

function send(next: OverlayPhase, label: string, extra: Partial<OverlayState> = {}) {
  const prev = phase;
  phase = next;
  if (TEST_MODE && label) testHooks.overlayLabels.push(label);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (!overlay || overlay.isDestroyed()) overlay = createOverlay();
  const state: OverlayState = { phase: next, label, locale: locale(), ...extra };
  overlay.webContents.send(IPC.overlayState, state);
  setEscape(next === 'recording');
  if ((prev === 'recording') !== (next === 'recording')) changeListener();
  if (next === 'hidden') {
    overlay.hide();
    return;
  }
  if (!overlay.isVisible()) {
    place(overlay);
    overlay.showInactive();
  }
  if (next === 'done' || next === 'error') {
    hideTimer = setTimeout(() => send('hidden', ''), next === 'error' ? 3200 : 1100);
  }
}

/** Esc cancela mientras se graba (alternar y manos libres; manteniendo, cualquier otra tecla ya cancela). */
function setEscape(on: boolean) {
  if (on && !escRegistered && !TEST_MODE) {
    try {
      escRegistered = globalShortcut.register('Escape', () => cancelDictation());
    } catch {
      escRegistered = false;
    }
  } else if (!on && escRegistered) {
    globalShortcut.unregister('Escape');
    escRegistered = false;
  }
}

/**
 * App con el foco al empezar (Mac: lsappinfo, sin pedir permiso de
 * automatización): da el contexto (email, chat, nota) y queda en el historial.
 */
function frontmostApp(): Promise<string> {
  if (process.platform !== 'darwin' || TEST_MODE) return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('lsappinfo', ['front'], { timeout: 800 }, (err, asn) => {
      const id = String(asn ?? '').trim();
      if (err || !/^ASN:[\w-]+:?$/.test(id)) return resolve('');
      execFile('lsappinfo', ['info', '-only', 'name', id], { timeout: 800 }, (err2, out) => {
        const m = /="([^"]{1,100})"/.exec(String(out ?? ''));
        resolve(err2 || !m ? '' : m[1]);
      });
    });
  });
}

function recordingState(handsFree: boolean, via: 'hold' | 'toggle'): Partial<OverlayState> {
  const key = via === 'toggle' ? getSettings().toggleShortcut.replace(/CommandOrControl/g, process.platform === 'darwin' ? 'Command' : 'Ctrl').replace(/\+/g, ' + ') : hotkeyText();
  return {
    startedAt: Date.now(),
    maxMs: MAX_MS,
    hint: handsFree ? fill(t().hudHandsFreeHint, { key }) : t().hudEscHint,
  };
}

export function isRecording() {
  return phase === 'recording';
}

export function startDictation(opts: { handsFree?: boolean; via?: 'hold' | 'toggle' } = {}) {
  if (phase === 'recording' || phase === 'working') return;
  sourceApp = '';
  void frontmostApp().then((name) => {
    sourceApp = name;
  });
  send('recording', opts.handsFree ? t().handsFree : t().listening, recordingState(!!opts.handsFree, opts.via ?? 'hold'));
  if (maxTimer) clearTimeout(maxTimer);
  maxTimer = setTimeout(() => void stopDictation(), MAX_MS);
}

/** Dos toques al atajo: el primero se canceló al soltar (fue corto); el segundo graba en manos libres. */
function goHandsFree() {
  if (phase === 'recording') cancelDictation();
  startDictation({ handsFree: true });
}

export function cancelDictation() {
  if (phase !== 'recording') return;
  if (maxTimer) clearTimeout(maxTimer);
  ptt?.release();
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
  while (ptt && ptt.anyDown() && Date.now() < until) await new Promise((r) => setTimeout(r, 15));
}

function normalizeMime(mime: string): string {
  return /^audio\/(webm|ogg|mp4|wav)/.test(mime) ? mime.split(';')[0] : 'audio/webm';
}

/** Manda el audio a /api/voice/dictate. No toca el overlay. */
async function upload(audio: Uint8Array, mime: string, meta: { sourceApp: string; context: string; durationMs: number }): Promise<DictationOutcome> {
  const type = normalizeMime(mime);
  const { body, contentType } = multipartBody(
    { context: meta.context, sourceApp: meta.sourceApp || 'desktop', durationMs: String(Math.round(meta.durationMs)), capture: 'desktop' },
    { field: 'audio', name: `dictation.${type === 'audio/mp4' ? 'm4a' : type.split('/')[1]}`, type, data: audio },
  );
  let status: number | null = null;
  let data: { text?: unknown; error?: unknown } | null = null;
  try {
    const res = await apiFetch('/api/voice/dictate', { method: 'POST', headers: { 'content-type': contentType }, body, signal: AbortSignal.timeout(75_000) });
    status = res.status;
    data = (await res.json().catch(() => null)) as typeof data;
  } catch {
    status = null;
  }
  return classifyResponse(status, data);
}

function failureLabel(f: DictationFailure, saved: boolean): string {
  const s = t();
  const base: Record<DictationFailure, string> = {
    offline: s.errOffline,
    signed_out: s.errSignedOut,
    rate_limited: s.errRateLimited,
    server: s.errServer,
    too_large: s.errTooLarge,
    empty: s.errEmpty,
    rejected: s.errFailed,
  };
  return saved ? `${base[f]}. ${s.savedToRetry}` : base[f];
}

function pastedLabel(how: 'pasted' | 'copied') {
  return how === 'pasted' ? t().pasted : fill(t().copied, { key: process.platform === 'darwin' ? '⌘V' : 'Ctrl+V' });
}

export async function stopDictation() {
  if (phase !== 'recording') return;
  const releasedAt = Date.now();
  if (maxTimer) clearTimeout(maxTimer);
  ptt?.release();
  const audioP = waitForAudio(5000);
  send('working', t().working);
  const audio = await audioP;
  if (!audio || audio.error) {
    testHooks.dictationError = 'mic';
    send('error', audio?.error === 'mic_denied' ? t().errMic : t().errFailed);
    return;
  }
  if (!audio.audio || audio.durationMs < MIN_MS) {
    send('hidden', '');
    return;
  }
  const audioAt = Date.now();
  const bytes = new Uint8Array(audio.audio);
  const meta = { sourceApp, context: contextForApp(sourceApp), durationMs: audio.durationMs };
  const outcome = await upload(bytes, audio.mime, meta);
  const serverAt = Date.now();
  if (!outcome.ok) {
    const saved = keepForRetry(outcome.failure) && !!savePending({ audio: bytes, mime: normalizeMime(audio.mime), ...meta, failure: outcome.failure });
    testHooks.lastFailure = outcome.failure;
    send('error', failureLabel(outcome.failure, saved));
    return;
  }
  await keysReleased(1500);
  const how = await insertText(outcome.text);
  const pastedAt = Date.now();
  lastLatencyMs = pastedAt - releasedAt;
  testHooks.timings.push({ audioMs: audioAt - releasedAt, serverMs: serverAt - audioAt, pasteMs: pastedAt - serverAt, totalMs: lastLatencyMs });
  console.log(`[dictation] ${lastLatencyMs} ms from release to text (audio ${audioAt - releasedAt}, server ${serverAt - audioAt}, paste ${pastedAt - serverAt})`);
  send('done', pastedLabel(how));
}

/**
 * Manda de nuevo un dictado guardado. El texto queda copiado (no se pega
 * solo: la persona ya puede estar en otra app) y en el historial de Voice.
 */
export async function retryPending(id: unknown): Promise<RetryResult> {
  const p = readPending(id);
  if (!p) return { ok: false, failure: 'rejected' };
  if (phase === 'recording' || phase === 'working') return { ok: false, failure: 'rate_limited' };
  send('working', t().sending);
  const outcome = await upload(p.audio, p.meta.mime, p.meta);
  if (!outcome.ok) {
    if (keepForRetry(outcome.failure)) markAttempt(p.meta.id, outcome.failure);
    else discardPending(p.meta.id);
    send('error', failureLabel(outcome.failure, keepForRetry(outcome.failure)));
    return { ok: false, failure: outcome.failure };
  }
  discardPending(p.meta.id);
  if (TEST_MODE) testHooks.pasted.push(outcome.text);
  else clipboard.writeText(outcome.text);
  send('done', pastedLabel('copied'));
  return { ok: true, text: outcome.text };
}

/** Mandar de nuevo todos los guardados (bandeja). */
export async function retryAllPending() {
  for (const m of listPending()) {
    const r = await retryPending(m.id);
    if (!r.ok && r.failure === 'offline') break;
  }
}

/** Pegar otra vez el último dictado: el de esta sesión o, si no hay, el último del historial del servidor. */
export async function pasteLast() {
  let text = lastInserted();
  if (!text) {
    try {
      const res = await apiFetch('/api/voice/sessions?kind=dictation&limit=1');
      const data = (await res.json().catch(() => null)) as { sessions?: Array<{ text?: string }> } | null;
      text = String(data?.sessions?.[0]?.text ?? '').trim();
    } catch {
      text = '';
    }
  }
  if (!text) {
    send('error', t().noRecent);
    return;
  }
  await keysReleased(1500);
  const how = await insertText(text);
  send('done', pastedLabel(how));
}

export function lastLatency(): number | null {
  return lastLatencyMs;
}

function onAction(action: PttAction | null) {
  if (!usesHold(getSettings().mode)) return;
  // Grabando desde la bandeja o el atajo de alternar: apretar el atajo de mantener termina.
  if ((action === 'start' || action === 'handsfree') && phase === 'recording') {
    ptt?.release();
    void stopDictation();
    return;
  }
  if (action === 'start') startDictation();
  else if (action === 'handsfree') goHandsFree();
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

function startHook() {
  const h = loadHook();
  if (!h || hookRunning || TEST_MODE) return;
  if (!hookAllowed()) {
    // Cuando la persona da Accesibilidad en Ajustes del Sistema, el hook arranca solo (sin reabrir la app).
    if (!hookPoll) {
      hookPoll = setInterval(() => {
        if (hookAllowed()) {
          if (hookPoll) clearInterval(hookPoll);
          hookPoll = null;
          startHook();
          changeListener();
        }
      }, 2000);
    }
    return;
  }
  try {
    h.uIOhook.on('keydown', (e) => onAction(ptt?.keyDown(e.keycode, Date.now()) ?? null));
    h.uIOhook.on('keyup', (e) => onAction(ptt?.keyUp(e.keycode, Date.now()) ?? null));
    h.uIOhook.start();
    hookRunning = true;
  } catch (err) {
    console.error('[dictation] hook failed', (err as Error).message);
  }
}

function register(accel: string, fn: () => void): boolean {
  try {
    return globalShortcut.register(accel, fn);
  } catch {
    return false;
  }
}

export function startHotkeys() {
  const settings = getSettings();
  ptt = ptt ?? new PushToTalk(settings.hotkey);
  ptt.setCombo(settings.hotkey);
  // El hook también hace falta para simular el pegado: se carga siempre.
  startHook();
  const wantToggle = usesToggle(settings.mode) ? settings.toggleShortcut : '';
  if (toggleRegistered !== wantToggle) {
    if (toggleRegistered) globalShortcut.unregister(toggleRegistered);
    toggleRegistered = '';
    toggleTaken = false;
    if (wantToggle) {
      const ok = register(wantToggle, () => {
        if (phase === 'recording') void stopDictation();
        else startDictation({ handsFree: true, via: 'toggle' });
      });
      if (ok) toggleRegistered = wantToggle;
      else toggleTaken = true;
    }
  }
  const last = pasteLastShortcut(process.platform);
  if (pasteLastRegistered !== last && !TEST_MODE) {
    if (register(last, () => void pasteLast())) pasteLastRegistered = last;
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
  if (hookPoll) clearInterval(hookPoll);
  hookPoll = null;
  globalShortcut.unregisterAll();
  toggleRegistered = '';
  pasteLastRegistered = '';
  escRegistered = false;
}

export function setHotkey(id: HotkeyId) {
  ptt?.setCombo(id);
}

export function dictationAvailable(): boolean {
  return hookRunning;
}

export function toggleShortcutTaken(): boolean {
  return toggleTaken;
}

export function hotkeyText(): string {
  return hotkeyLabel(getSettings().hotkey, process.platform);
}

export function setupDictation() {
  setupOverlayPermissions();
  overlay = createOverlay();
  startHotkeys();
}

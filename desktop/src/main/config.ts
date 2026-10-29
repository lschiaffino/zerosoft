/**
 * Ajustes locales en <userData>/settings.json (servidor, atajo, avisos) y el
 * tamaño de la ventana en window-state.json. Nada secreto: la sesión va
 * cifrada aparte (auth.ts, safeStorage).
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { defaultHotkey, isHotkeyId, type HotkeyId } from '../shared/hotkey';
import { DEFAULT_SERVER, normalizeServer } from '../shared/nav';
import { devEnv } from './dev-env';

export interface Settings {
  server: string;
  hotkey: HotkeyId;
  /** Atajo de alternar (sin mantener), con globalShortcut: funciona aunque no haya hook. */
  toggleShortcut: string;
  meetingAlerts: boolean;
  /** Ya vio los permisos de la primera vez. */
  onboarded: boolean;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

function file(name: string) {
  return path.join(app.getPath('userData'), name);
}

function readJson<T>(name: string): Partial<T> {
  try {
    const v = JSON.parse(fs.readFileSync(file(name), 'utf8')) as unknown;
    return v && typeof v === 'object' ? (v as Partial<T>) : {};
  } catch {
    return {};
  }
}

function writeJson(name: string, value: unknown) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const target = file(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  const raw = readJson<Settings>('settings.json');
  // ZEROSOFT_SERVER (solo desarrollo y e2e) pisa lo guardado.
  const server = normalizeServer(devEnv('ZEROSOFT_SERVER')) ?? normalizeServer(raw.server) ?? DEFAULT_SERVER;
  cached = {
    server,
    hotkey: isHotkeyId(raw.hotkey) ? raw.hotkey : defaultHotkey(process.platform),
    toggleShortcut: typeof raw.toggleShortcut === 'string' && raw.toggleShortcut.length < 60 ? raw.toggleShortcut : 'Control+Alt+Space',
    meetingAlerts: raw.meetingAlerts !== false,
    onboarded: raw.onboarded === true,
  };
  return cached;
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...next };
  cached = merged;
  writeJson('settings.json', merged);
  return merged;
}

export function getWindowState(): WindowState {
  const raw = readJson<WindowState>('window-state.json');
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
  return {
    x: n(raw.x),
    y: n(raw.y),
    width: Math.max(n(raw.width) ?? 1280, 400),
    height: Math.max(n(raw.height) ?? 820, 500),
    maximized: raw.maximized === true,
  };
}

export function saveWindowState(state: WindowState) {
  try {
    writeJson('window-state.json', state);
  } catch {
    /* disco lleno o sin permiso: no es grave */
  }
}

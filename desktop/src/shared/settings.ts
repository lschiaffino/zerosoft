/**
 * Ajustes locales del escritorio (puro): forma, valores por defecto y
 * validación de lo que llega de settings.json o de la ventana de Ajustes.
 * Lo que es de Voice (idioma, limpieza, diccionario) vive en el servidor.
 */
import { defaultHotkey, isHotkeyId, type HotkeyId } from './hotkey';

/** Cómo se dicta: mantener las teclas, apretar un atajo para empezar y otra vez para terminar, o los dos. */
export const DICTATION_MODES = ['both', 'hold', 'toggle'] as const;
export type DictationMode = (typeof DICTATION_MODES)[number];

/** Atajos de alternar ofrecidos (globalShortcut). Todos con al menos un modificador. */
export const TOGGLE_SHORTCUTS = ['Control+Alt+Space', 'Control+Shift+Space', 'Alt+Shift+Space', 'CommandOrControl+Shift+D', 'Control+Alt+D'] as const;

export const DEFAULT_TOGGLE = 'Control+Alt+Space';

/** Pegar el último dictado otra vez: Control+Command+V en Mac (como en la web), Ctrl+Alt+Shift+V en Windows. */
export function pasteLastShortcut(platform: string): string {
  return platform === 'darwin' ? 'Control+Command+V' : 'Control+Alt+Shift+V';
}

export interface DesktopSettings {
  server: string;
  mode: DictationMode;
  hotkey: HotkeyId;
  /** Atajo de alternar (sin mantener), con globalShortcut: funciona aunque no haya hook. */
  toggleShortcut: string;
  /** Devolver lo que había en el portapapeles después de pegar. */
  restoreClipboard: boolean;
  meetingAlerts: boolean;
  /** Ya vio la bienvenida (permisos y prueba) de la primera vez. */
  onboarded: boolean;
}

const MODIFIER = /^(Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|AltGr|Shift|Super|Meta)$/;
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|[`~!@#$%^&*()\-=[\]\\;',./])$/i;

/**
 * Atajo de globalShortcut válido y razonable: uno o más modificadores y una
 * tecla (o una F sola). Sin modificador, una letra robaría la tecla a todas
 * las apps.
 */
export function isAccelerator(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > 60) return false;
  const parts = v.split('+');
  const key = parts.pop() ?? '';
  if (!KEY.test(key)) return false;
  if (!parts.length) return /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  return parts.every((p) => MODIFIER.test(p)) && new Set(parts).size === parts.length;
}

/** settings.json (o lo que sea) → ajustes completos. `server` ya viene normalizado por quien llama. */
export function normalizeSettings(raw: unknown, platform: string, server: string): DesktopSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DesktopSettings, unknown>>;
  return {
    server,
    mode: (DICTATION_MODES as readonly string[]).includes(String(v.mode)) ? (v.mode as DictationMode) : 'both',
    hotkey: isHotkeyId(v.hotkey) ? v.hotkey : defaultHotkey(platform),
    toggleShortcut: isAccelerator(v.toggleShortcut) ? v.toggleShortcut : DEFAULT_TOGGLE,
    restoreClipboard: v.restoreClipboard !== false,
    meetingAlerts: v.meetingAlerts !== false,
    onboarded: v.onboarded === true,
  };
}

/** Lo que manda la ventana de Ajustes: solo los campos válidos pisan los actuales. */
export function mergeSettingsInput(current: DesktopSettings, input: unknown): Partial<DesktopSettings> {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: Partial<DesktopSettings> = {};
  if ((DICTATION_MODES as readonly string[]).includes(String(v.mode))) out.mode = v.mode as DictationMode;
  if (isHotkeyId(v.hotkey)) out.hotkey = v.hotkey;
  if (isAccelerator(v.toggleShortcut)) out.toggleShortcut = v.toggleShortcut;
  if (typeof v.restoreClipboard === 'boolean') out.restoreClipboard = v.restoreClipboard;
  if (typeof v.meetingAlerts === 'boolean') out.meetingAlerts = v.meetingAlerts;
  if (out.toggleShortcut && out.toggleShortcut === current.toggleShortcut) delete out.toggleShortcut;
  return out;
}

/** El modo usa el hook de teclado (mantener) o el atajo de alternar. */
export function usesHold(mode: DictationMode): boolean {
  return mode !== 'toggle';
}

export function usesToggle(mode: DictationMode): boolean {
  return mode !== 'hold';
}

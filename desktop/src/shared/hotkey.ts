/**
 * Atajo de dictado "mantener para hablar" (puro). Recibe teclas apretadas y
 * soltadas (códigos de uiohook) y decide cuándo empezar, terminar o cancelar.
 *
 * - Empieza cuando están apretadas exactamente las teclas del atajo.
 * - Termina al soltar cualquiera de ellas. Si se mantuvo menos de
 *   MIN_HOLD_MS, cancela (fue un toque, no un dictado).
 * - Si mientras graba se aprieta otra tecla (Ctrl+Option+K es un atajo de
 *   otra app), cancela.
 * - Manos libres (como en la web): dos toques rápidos al atajo empiezan una
 *   grabación que sigue sin mantener ('handsfree'). Termina al volver a
 *   apretar el atajo ('stop'); Esc cancela.
 */

export type HotkeyId = 'ctrl+alt' | 'ctrl+meta' | 'alt+meta' | 'right-alt' | 'right-ctrl';

/** Códigos de uiohook (uiohook-napi UiohookKey). */
export const KEY = {
  Ctrl: 29,
  CtrlRight: 3613,
  Alt: 56,
  AltRight: 3640,
  Shift: 42,
  ShiftRight: 54,
  Meta: 3675,
  MetaRight: 3676,
  Space: 57,
  Escape: 1,
} as const;

type Part = 'ctrl' | 'alt' | 'meta' | 'shift' | 'alt-right' | 'ctrl-right';

const COMBOS: Record<HotkeyId, Part[]> = {
  'ctrl+alt': ['ctrl', 'alt'],
  'ctrl+meta': ['ctrl', 'meta'],
  'alt+meta': ['alt', 'meta'],
  'right-alt': ['alt-right'],
  'right-ctrl': ['ctrl-right'],
};

export const HOTKEYS = Object.keys(COMBOS) as HotkeyId[];

export function isHotkeyId(v: unknown): v is HotkeyId {
  return typeof v === 'string' && v in COMBOS;
}

/** Atajo por defecto: Control+Option en Mac (Fn no lo expone el hook), Control+Windows en Windows. */
export function defaultHotkey(platform: string): HotkeyId {
  return platform === 'darwin' ? 'ctrl+alt' : 'ctrl+meta';
}

/** Nombre para mostrar del atajo. */
export function hotkeyLabel(id: HotkeyId, platform: string): string {
  const mac = platform === 'darwin';
  const names: Record<Part, string> = {
    ctrl: mac ? 'Control' : 'Ctrl',
    'ctrl-right': mac ? 'Right Control' : 'Right Ctrl',
    alt: mac ? 'Option' : 'Alt',
    'alt-right': mac ? 'Right Option' : 'Right Alt',
    meta: mac ? 'Command' : 'Windows',
    shift: 'Shift',
  };
  return COMBOS[id].map((p) => names[p]).join(' + ');
}

/**
 * Las partes que forma una tecla. Las combinaciones sin lado aceptan las dos
 * teclas (izquierda o derecha); "right-alt" solo la derecha.
 */
function partsOf(code: number): Part[] {
  switch (code) {
    case KEY.Ctrl:
      return ['ctrl'];
    case KEY.CtrlRight:
      return ['ctrl', 'ctrl-right'];
    case KEY.Alt:
      return ['alt'];
    case KEY.AltRight:
      return ['alt', 'alt-right'];
    case KEY.Meta:
    case KEY.MetaRight:
      return ['meta'];
    case KEY.Shift:
    case KEY.ShiftRight:
      return ['shift'];
    default:
      return [];
  }
}

export const MIN_HOLD_MS = 250;

export type PttAction = 'start' | 'stop' | 'cancel' | 'handsfree';

/** Entre el primer toque (soltado) y el segundo, para manos libres. */
export const DOUBLE_TAP_MS = 400;

export class PushToTalk {
  private down = new Set<number>();
  private active = false;
  private locked = false;
  private startedAt = 0;
  private lastTapAt = -Infinity;

  constructor(private combo: HotkeyId) {}

  setCombo(combo: HotkeyId) {
    this.combo = combo;
    this.down.clear();
    this.active = false;
    this.locked = false;
  }

  get recording() {
    return this.active;
  }

  /** Grabando en manos libres (ya no hace falta mantener). */
  get handsFree() {
    return this.active && this.locked;
  }

  /** Main terminó la grabación por otro lado (alternar, tope de tiempo): se olvida el estado. */
  release() {
    this.active = false;
    this.locked = false;
  }

  /** Queda alguna tecla apretada (para no simular el pegado con un modificador abajo). */
  anyDown(): boolean {
    return this.down.size > 0;
  }

  /** Las teclas apretadas forman exactamente el atajo (ni más ni menos). */
  private matches(): boolean {
    const want = COMBOS[this.combo];
    const have = new Set<Part>();
    for (const code of this.down) {
      const parts = partsOf(code);
      if (!parts.length) return false;
      // Una tecla cuenta para el atajo si alguna de sus partes está en él.
      const used = parts.filter((p) => want.includes(p));
      if (!used.length) return false;
      used.forEach((p) => have.add(p));
    }
    return want.every((p) => have.has(p));
  }

  keyDown(code: number, now: number): PttAction | null {
    if (this.down.has(code)) return null; // autorepetición
    this.down.add(code);
    if (this.active && this.locked) {
      if (code === KEY.Escape) {
        this.release();
        return 'cancel';
      }
      // Volver a apretar el atajo termina; cualquier otra tecla se ignora.
      if (this.matches()) {
        this.release();
        return 'stop';
      }
      return null;
    }
    if (this.active) {
      if (!this.matches()) {
        this.active = false;
        return 'cancel';
      }
      return null;
    }
    if (this.matches()) {
      this.active = true;
      this.startedAt = now;
      if (now - this.lastTapAt <= DOUBLE_TAP_MS) {
        this.locked = true;
        this.lastTapAt = -Infinity;
        return 'handsfree';
      }
      return 'start';
    }
    return null;
  }

  keyUp(code: number, now: number): PttAction | null {
    this.down.delete(code);
    if (!this.active || this.locked) return null;
    this.active = false;
    if (now - this.startedAt < MIN_HOLD_MS) {
      this.lastTapAt = now;
      return 'cancel';
    }
    return 'stop';
  }

  /** El hook perdió eventos (bloqueo de pantalla, permiso revocado): todo suelto. */
  reset(): PttAction | null {
    this.down.clear();
    if (!this.active) return null;
    this.release();
    return 'cancel';
  }
}

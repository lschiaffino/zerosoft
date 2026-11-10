/**
 * Qué instalador de escritorio le corresponde a quien mira y si ya está en la
 * app de escritorio. Cliente (lee navigator y window); las funciones puras
 * de abajo se prueban en tests/unit/desktop-detect.test.ts.
 *
 * En Mac el navegador no siempre dice el chip:
 * 1. Chrome y Edge lo dicen por User-Agent Client Hints (architecture 'arm' o 'x86').
 * 2. Si no, el nombre de la GPU por WebGL: "Apple M1…" es Apple silicon, "Intel…" o
 *    "AMD…/Radeon" es un Mac Intel. Safari lo enmascara como "Apple GPU" (no dice nada).
 * 3. Sin pista: Apple silicon (los Mac que se venden desde 2020), con el selector a mano.
 */
export type DesktopTarget = 'mac-arm' | 'mac-intel' | 'win';
export type DetectedPlatform = DesktopTarget | 'linux' | 'mobile' | 'other';

export interface PlatformGuess {
  platform: DetectedPlatform;
  /** Cómo se supo el chip del Mac (para decir "detectado" o "probable"). */
  confidence: 'sure' | 'guess';
}

/** Sistema por el user agent (sin el chip del Mac). */
export function platformFromUa(ua: string, maxTouchPoints = 0): 'mac' | 'win' | 'linux' | 'mobile' | 'other' {
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'mobile';
  // iPadOS se presenta como Mac: con pantalla táctil es un iPad.
  if (/Macintosh|Mac OS X/i.test(ua)) return maxTouchPoints > 1 ? 'mobile' : 'mac';
  if (/Windows/i.test(ua)) return 'win';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'other';
}

/** Chip del Mac por el nombre de la GPU de WebGL (null si no dice nada). */
export function macChipFromRenderer(renderer: string | null | undefined): 'mac-arm' | 'mac-intel' | null {
  if (!renderer) return null;
  if (/Apple M\d|Apple (?:silicon|A1\d)/i.test(renderer)) return 'mac-arm';
  if (/Intel|AMD|Radeon|NVIDIA|GeForce/i.test(renderer)) return 'mac-intel';
  return null;
}

/** Chip del Mac por la arquitectura de UA-CH. */
export function macChipFromArch(arch: string | null | undefined): 'mac-arm' | 'mac-intel' | null {
  if (arch === 'arm') return 'mac-arm';
  if (arch === 'x86') return 'mac-intel';
  return null;
}

function webglRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const value = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function detectPlatform(): Promise<PlatformGuess> {
  const kind = platformFromUa(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  if (kind === 'win') return { platform: 'win', confidence: 'sure' };
  if (kind !== 'mac') return { platform: kind, confidence: 'sure' };
  const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
  try {
    const v = await uad?.getHighEntropyValues?.(['architecture']);
    const chip = macChipFromArch(v?.architecture);
    if (chip) return { platform: chip, confidence: 'sure' };
  } catch {
    /* sin UA-CH */
  }
  const byGpu = macChipFromRenderer(webglRenderer());
  if (byGpu) return { platform: byGpu, confidence: 'sure' };
  return { platform: 'mac-arm', confidence: 'guess' };
}

/** Está dentro de la app de escritorio (Tauri): el puente de la app o el IPC de Tauri. */
export function inDesktopApp(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { zerosoftDesktop?: unknown; __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.zerosoftDesktop || w.__TAURI_INTERNALS__ || w.__TAURI__) || /\bTauri\b|zerosoft-desktop/i.test(navigator.userAgent);
}

/** "12 MB" / "3.4 MB" para mostrar al lado del botón. */
export function formatSize(bytes: number | null | undefined, locale: string): string | null {
  if (!bytes || bytes < 1024) return null;
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb)} MB`;
}

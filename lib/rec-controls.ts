/**
 * Lógica pura del grabador de Rec (sin DOM): el reloj con pausas y qué
 * control vale en cada fase. La usan el grabador de la página
 * (components/rec/Recorder.tsx) y los controles flotantes de la app de
 * escritorio, que llegan como eventos `zerosoft:rec-control`.
 */

export type RecPhase = 'setup' | 'countdown' | 'recording' | 'paused' | 'finishing';

/**
 * Lo que se le puede pedir al grabador desde afuera (la barra flotante y los
 * atajos de la app de escritorio). `bubble-failed`: la burbuja de cámara de
 * escritorio no pudo abrir la cámara y la página vuelve a dibujarla en el video.
 */
export const REC_CONTROLS = ['pause', 'resume', 'toggle', 'stop', 'restart', 'discard', 'mute', 'unmute', 'bubble-failed'] as const;
export type RecControl = (typeof REC_CONTROLS)[number];

export function parseRecControl(v: unknown): RecControl | null {
  return typeof v === 'string' && (REC_CONTROLS as readonly string[]).includes(v) ? (v as RecControl) : null;
}

/** ¿Tiene sentido este control en esta fase? (Lo demás se ignora.) */
export function controlAllowed(phase: RecPhase, c: RecControl): boolean {
  switch (c) {
    case 'pause':
      return phase === 'recording';
    case 'resume':
      return phase === 'paused';
    case 'toggle':
    case 'stop':
    case 'restart':
    case 'discard':
      return phase === 'recording' || phase === 'paused';
    case 'mute':
    case 'unmute':
    case 'bubble-failed':
      return phase === 'countdown' || phase === 'recording' || phase === 'paused';
  }
}

/** Reloj de lo grabado: suma los tramos sin pausa. `since` es cuándo arrancó el tramo actual (null en pausa). */
export interface RecClock {
  activeMs: number;
  since: number | null;
}

export const clockIdle = (): RecClock => ({ activeMs: 0, since: null });
export const clockStart = (now: number): RecClock => ({ activeMs: 0, since: now });

export function clockPause(c: RecClock, now: number): RecClock {
  if (c.since === null) return c;
  return { activeMs: c.activeMs + Math.max(0, now - c.since), since: null };
}

export function clockResume(c: RecClock, now: number): RecClock {
  return c.since === null ? { activeMs: c.activeMs, since: now } : c;
}

export function clockElapsed(c: RecClock, now: number): number {
  return c.activeMs + (c.since === null ? 0 : Math.max(0, now - c.since));
}

/** Estado que la página le cuenta a la app de escritorio para la barra y la burbuja flotantes. */
export interface RecOverlayState {
  active: boolean;
  phase?: Exclude<RecPhase, 'setup'>;
  /** Lo grabado hasta ahora (sin pausas), en ms. */
  elapsedMs?: number;
  mic?: 'on' | 'muted' | 'none';
  /** Nombre de la cámara para la burbuja flotante; null sin burbuja. */
  camera?: string | null;
}

/** El estado para el escritorio en una fase (inactivo fuera de la grabación). */
export function overlayState(phase: RecPhase, elapsedMs: number, mic: 'on' | 'muted' | 'none', camera: string | null): RecOverlayState {
  if (phase === 'setup') return { active: false };
  return { active: true, phase, elapsedMs: Math.max(0, Math.round(elapsedMs)), mic, camera };
}

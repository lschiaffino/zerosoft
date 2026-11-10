import { describe, expect, it } from 'vitest';
import { REC_CONTROLS, clockElapsed, clockIdle, clockPause, clockResume, clockStart, controlAllowed, overlayState, parseRecControl, type RecPhase } from '@/lib/rec-controls';

describe('reloj de Rec con pausas', () => {
  it('cuenta solo los tramos grabados', () => {
    let c = clockStart(1000);
    expect(clockElapsed(c, 3500)).toBe(2500);
    c = clockPause(c, 3500);
    // En pausa el reloj no avanza.
    expect(clockElapsed(c, 9000)).toBe(2500);
    c = clockResume(c, 9000);
    expect(clockElapsed(c, 10_000)).toBe(3500);
    c = clockPause(c, 10_000);
    expect(c).toEqual({ activeMs: 3500, since: null });
  });

  it('pausar dos veces o retomar sin pausa no cambia nada', () => {
    const p = clockPause(clockStart(0), 1000);
    expect(clockPause(p, 5000)).toBe(p);
    const r = clockStart(0);
    expect(clockResume(r, 4000)).toBe(r);
    expect(clockElapsed(clockIdle(), 123)).toBe(0);
  });

  it('un reloj que va para atrás no resta', () => {
    expect(clockElapsed(clockStart(5000), 4000)).toBe(0);
    expect(clockPause(clockStart(5000), 4000).activeMs).toBe(0);
  });
});

describe('controles del grabador', () => {
  it('solo acepta los controles conocidos', () => {
    for (const c of REC_CONTROLS) expect(parseRecControl(c)).toBe(c);
    for (const bad of ['', 'PAUSE', 'eval', null, undefined, 3, { action: 'stop' }]) expect(parseRecControl(bad)).toBeNull();
  });

  it('cada control vale en su fase', () => {
    const phases: RecPhase[] = ['setup', 'countdown', 'recording', 'paused', 'finishing'];
    const allowed = (c: Parameters<typeof controlAllowed>[1]) => phases.filter((p) => controlAllowed(p, c));
    expect(allowed('pause')).toEqual(['recording']);
    expect(allowed('resume')).toEqual(['paused']);
    expect(allowed('toggle')).toEqual(['recording', 'paused']);
    expect(allowed('stop')).toEqual(['recording', 'paused']);
    expect(allowed('restart')).toEqual(['recording', 'paused']);
    expect(allowed('discard')).toEqual(['recording', 'paused']);
    expect(allowed('mute')).toEqual(['countdown', 'recording', 'paused']);
    expect(allowed('bubble-failed')).toEqual(['countdown', 'recording', 'paused']);
  });

  it('el estado para el escritorio se apaga fuera de la grabación', () => {
    expect(overlayState('setup', 5000, 'on', 'FaceTime HD')).toEqual({ active: false });
    expect(overlayState('paused', 4200.6, 'muted', null)).toEqual({ active: true, phase: 'paused', elapsedMs: 4201, mic: 'muted', camera: null });
    expect(overlayState('recording', -3, 'none', 'Cam')).toMatchObject({ elapsedMs: 0, camera: 'Cam' });
  });
});

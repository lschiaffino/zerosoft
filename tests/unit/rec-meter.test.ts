import { describe, expect, it } from 'vitest';
import { METER_BARS, levelFromPeak, meterBars } from '@/components/rec/recorder-media';

describe('medidor del micrófono de Rec', () => {
  it('silencio y ruido de fondo no prenden nada', () => {
    expect(levelFromPeak(0)).toBe(0);
    expect(meterBars(levelFromPeak(0.001))).toBe(0); // −60 dBFS
  });

  it('una voz normal llena cerca de la mitad, no una rayita', () => {
    // Picos de una voz a volumen normal: entre −26 y −16 dBFS. En escala lineal eso era el 5 % al 15 % de la barra.
    const soft = meterBars(levelFromPeak(0.05));
    const normal = meterBars(levelFromPeak(0.15));
    expect(soft).toBeGreaterThanOrEqual(7);
    expect(normal).toBeGreaterThanOrEqual(10);
    expect(normal).toBeLessThan(METER_BARS);
  });

  it('más fuerte, más barras; a tope se llena y no se pasa', () => {
    const steps = [0.005, 0.02, 0.08, 0.3, 1].map((p) => meterBars(levelFromPeak(p)));
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(new Set(steps).size).toBe(steps.length);
    expect(meterBars(levelFromPeak(1))).toBe(METER_BARS);
    expect(meterBars(levelFromPeak(4))).toBe(METER_BARS);
  });

  it('un sonido apenas sobre el piso prende una barra', () => {
    expect(meterBars(0.01)).toBe(1);
  });
});

describe('mensaje cuando compartir pantalla falla', () => {
  it('navegador: cancelado o bloqueado; otro error, falla de la máquina', async () => {
    const { screenShareErrorKey } = await import('@/components/rec/recorder-media');
    expect(screenShareErrorKey('NotAllowedError', false)).toBe('errors.screen_denied');
    expect(screenShareErrorKey('NotReadableError', false)).toBe('errors.screen_failed');
  });

  it('app de escritorio: siempre dice cómo dar el permiso en macOS', async () => {
    const { screenShareErrorKey } = await import('@/components/rec/recorder-media');
    expect(screenShareErrorKey('NotAllowedError', true)).toBe('errors.screen_denied_desktop');
    expect(screenShareErrorKey('InvalidAccessError', true)).toBe('errors.screen_denied_desktop');
    expect(screenShareErrorKey('', true)).toBe('errors.screen_denied_desktop');
  });
});

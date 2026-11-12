import { describe, expect, it } from 'vitest';
import { barHeights, initialMeter, loudness, stepMeter } from '../../desktop/ui/meter';

/** Unos pasos con el mismo pico (como 50 ms de audio cada uno). */
function settle(peak: number, steps = 12) {
  let m = initialMeter();
  for (let i = 0; i < steps; i++) m = stepMeter(m, peak);
  return m;
}

describe('medidor del dictado (desktop)', () => {
  it('escala en decibeles: silencio 0, voz normal a la mitad o más, grito lleno', () => {
    expect(loudness(0)).toBe(0);
    expect(loudness(0.0005)).toBe(0); // ~ -66 dBFS: ruido de fondo
    expect(loudness(0.05)).toBeGreaterThan(0.5); // ~ -26 dBFS: voz normal en una notebook
    expect(loudness(0.5)).toBe(1);
  });

  it('una voz baja (pico 0,03) mueve bien las barras: antes subían 1 px', () => {
    const m = settle(0.03);
    expect(m.value).toBeGreaterThan(0.8);
    const h = barHeights(m.value, 9, 0);
    expect(Math.max(...h)).toBeGreaterThanOrEqual(13);
  });

  it('el ruido de fondo de la sala queda casi quieto', () => {
    const m = settle(0.002);
    expect(Math.max(...barHeights(m.value, 9, 0))).toBeLessThanOrEqual(7);
  });

  it('sube rápido y baja lento', () => {
    let m = initialMeter();
    m = stepMeter(m, 0.1);
    expect(m.value).toBeGreaterThan(0.6);
    const up = m.value;
    m = stepMeter(m, 0);
    expect(m.value).toBeGreaterThan(up * 0.6);
  });
});

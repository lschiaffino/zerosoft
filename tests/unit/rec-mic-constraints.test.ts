import { describe, expect, it } from 'vitest';
import { micConstraints } from '@/components/rec/recorder-media';

describe('micConstraints', () => {
  it('no toca el volumen del sistema ni pasa el micrófono a modo voz', () => {
    const c = micConstraints('', true);
    expect(c.autoGainControl).toBe(false);
    expect(c.echoCancellation).toBe(false);
    expect(c.noiseSuppression).toBe(true);
    expect(c.deviceId).toBeUndefined();
  });
  it('respeta el micrófono elegido y la supresión de ruido apagada', () => {
    const c = micConstraints('mic-1', false);
    expect(c.deviceId).toEqual({ exact: 'mic-1' });
    expect(c.noiseSuppression).toBe(false);
  });
});

describe('isBlackPixels', () => {
  it('negro puro y casi negro cuentan como negro; un píxel con luz no', async () => {
    const { isBlackPixels } = await import('@/components/rec/recorder-media');
    const black = new Uint8ClampedArray(48 * 27 * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    expect(isBlackPixels(black)).toBe(true);
    const dim = black.slice();
    dim[0] = 6;
    expect(isBlackPixels(dim)).toBe(true);
    const lit = black.slice();
    lit[400] = 200;
    expect(isBlackPixels(lit)).toBe(false);
  });
});

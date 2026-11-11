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

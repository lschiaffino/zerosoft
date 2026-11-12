import { describe, expect, it } from 'vitest';
import { pushLevel, rmsLevel } from '@/lib/live-waveform';

describe('live waveform', () => {
  it('maps silence to 0 and loud voice to 1', () => {
    expect(rmsLevel(new Float32Array(512))).toBe(0);
    expect(rmsLevel(new Float32Array(512).fill(0.5))).toBe(1);
    const mid = rmsLevel(new Float32Array(512).fill(0.03));
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.8);
    expect(rmsLevel([])).toBe(0);
  });
  it('keeps the last values', () => {
    let l: number[] = [];
    for (let i = 0; i < 10; i++) l = pushLevel(l, i, 4);
    expect(l).toEqual([6, 7, 8, 9]);
  });
});

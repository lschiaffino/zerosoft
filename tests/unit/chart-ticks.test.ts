import { describe, expect, it } from 'vitest';
import { chartTicks } from '@/lib/chart-ticks';

describe('chartTicks: marcas enteras del eje Y', () => {
  it.each([
    [0, 1, [0, 1]],
    [1, 1, [0, 1]],
    [3, 3, [0, 1, 2, 3]],
    [37, 40, [0, 10, 20, 30, 40]],
    [50, 60, [0, 20, 40, 60]],
    [130, 150, [0, 50, 100, 150]],
  ])('max %i', (max, top, ticks) => {
    const r = chartTicks(max);
    expect(r.top).toBe(top);
    expect(r.ticks).toEqual(ticks);
    expect(r.ticks.every(Number.isInteger)).toBe(true);
  });
});

describe('periodDelta', () => {
  it('distingue sin período, sin datos previos y variación', async () => {
    const { periodDelta } = await import('@/lib/period-delta');
    expect(periodDelta(5, null)).toBeNull();
    expect(periodDelta(5, 0)).toEqual({ kind: 'none' });
    expect(periodDelta(112, 100)).toEqual({ kind: 'change', text: '+12%', dir: 'up' });
    expect(periodDelta(50, 100)).toEqual({ kind: 'change', text: '−50%', dir: 'down' });
  });
});

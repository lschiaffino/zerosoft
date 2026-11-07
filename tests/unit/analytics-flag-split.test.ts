import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { evaluateFlag } from '@/lib/analytics/flags-core';
import { conversionStats } from '@/lib/analytics/compute-more';

/** Dos recorridos a mano dieron 4 de 4 en la misma variante: con muchas personas el reparto tiene que ser parejo. */
describe('experiment split', () => {
  const flag = { key: 'exp-walk-exp', active: true, rollout: 100, variants: [{ key: 'control', rollout: 50 }, { key: 'test', rollout: 50 }], conditions: [] };

  it('random anonymous ids split about half and half, and the same id always lands the same', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const v = String(evaluateFlag(flag, randomUUID(), {}));
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['control', 'test']);
    expect(counts.control / 4000).toBeGreaterThan(0.46);
    expect(counts.control / 4000).toBeLessThan(0.54);
    const id = randomUUID();
    expect(new Set(Array.from({ length: 20 }, () => evaluateFlag(flag, id, {}))).size).toBe(1);
  });

  it('a 70/30 split holds too', () => {
    const f = { ...flag, variants: [{ key: 'control', rollout: 70 }, { key: 'test', rollout: 30 }] };
    let control = 0;
    for (let i = 0; i < 4000; i++) if (evaluateFlag(f, randomUUID(), {}) === 'control') control++;
    expect(control / 4000).toBeGreaterThan(0.66);
    expect(control / 4000).toBeLessThan(0.74);
  });

  it('the interval is a credible interval with a flat prior: 0 of 4 gives about 0.5% to 52%, like PostHog', () => {
    const [c] = conversionStats([
      { key: 'control', exposed: 4, conversions: 0 },
      { key: 'test', exposed: 0, conversions: 0 },
    ]);
    expect(c.rate).toBe(0);
    // Beta(1, 5): percentil 2,5 ≈ 0,5% y 97,5 ≈ 52%.
    expect(c.low).toBeGreaterThan(0.003);
    expect(c.low).toBeLessThan(0.008);
    expect(c.high).toBeGreaterThan(0.48);
    expect(c.high).toBeLessThan(0.55);
  });
});

import { describe, expect, it } from 'vitest';
import { bucketLabel, weekBucketStart } from '@/lib/crm-buckets';

describe('etiquetas de períodos de los gráficos', () => {
  it('la semana %W arranca el lunes', () => {
    // 2026-01-01 es jueves: la semana 01 arranca el lunes 5.
    expect(weekBucketStart('2026-W01')?.toISOString().slice(0, 10)).toBe('2026-01-05');
    expect(weekBucketStart('2026-W00')?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(weekBucketStart('2026-W43')?.toISOString().slice(0, 10)).toBe('2026-10-26');
  });
  it('semanas, días y trimestres legibles por locale', () => {
    expect(bucketLabel('2026-W43', 'en')).toBe('Oct 26');
    expect(bucketLabel('2026-W43', 'es')).toBe('26 oct');
    expect(bucketLabel('2026-10-20', 'en')).toBe('Oct 20');
    expect(bucketLabel('2026-Q4', 'en')).toBe('Q4 2026');
    expect(bucketLabel('2026-Q4', 'es')).toBe('T4 2026');
  });
});

import { describe, expect, it } from 'vitest';
import { planProgressSeries, todayIn, validTimeZone, wallClock } from '@/lib/track-plan-metrics';

describe('track: días del gráfico del project en la zona de quien mira', () => {
  it('pasa instantes UTC a la hora de pared y valida la zona', () => {
    expect(wallClock('2026-10-04T01:30:00.000Z', 'America/Argentina/Buenos_Aires')).toBe('2026-10-03T22:30:00');
    expect(wallClock('2026-10-04 01:30:00', 'America/Argentina/Buenos_Aires')).toBe('2026-10-03T22:30:00');
    expect(todayIn('America/Argentina/Buenos_Aires', new Date('2026-10-04T01:30:00Z'))).toBe('2026-10-03');
    expect(validTimeZone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(validTimeZone('Mars/Base')).toBeNull();
  });

  it('un issue cerrado a las 22:30 de Buenos Aires cuenta ese día', () => {
    const at = wallClock('2026-10-04T01:30:00.000Z', 'America/Argentina/Buenos_Aires');
    const s = planProgressSeries({
      startDate: '2026-10-01',
      targetDate: null,
      createdAt: '2026-10-01',
      today: '2026-10-05',
      issues: [{ id: 'a', estimate: null, created_at: '2026-10-01T12:00:00', category: 'done', statusChanges: [{ at, from: 'todo', to: 'done' }] }],
    });
    expect(s.points.find((p) => p.day === '2026-10-03')?.completed).toBe(1);
    expect(s.points.find((p) => p.day === '2026-10-02')?.completed).toBe(0);
  });
});

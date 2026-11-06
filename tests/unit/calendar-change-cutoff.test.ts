import { describe, expect, it } from 'vitest';
import { changeCutoffHours, isInsideChangeCutoff, MAX_CHANGE_CUTOFF_HOURS } from '@/lib/calendar-change-cutoff';

const now = new Date('2026-11-06T12:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe('changeCutoffHours', () => {
  it('lee el número y descarta lo inválido', () => {
    expect(changeCutoffHours({ changeCutoffHours: 24 })).toBe(24);
    expect(changeCutoffHours({ changeCutoffHours: 0 })).toBe(0);
    expect(changeCutoffHours({ changeCutoffHours: -3 })).toBe(0);
    expect(changeCutoffHours({ changeCutoffHours: '24' })).toBe(0);
    expect(changeCutoffHours({ changeCutoffHours: Number.NaN })).toBe(0);
    expect(changeCutoffHours({})).toBe(0);
    expect(changeCutoffHours(null)).toBe(0);
  });
  it('acota al máximo y redondea hacia abajo', () => {
    expect(changeCutoffHours({ changeCutoffHours: 9999 })).toBe(MAX_CHANGE_CUTOFF_HOURS);
    expect(changeCutoffHours({ changeCutoffHours: 2.9 })).toBe(2);
  });
});

describe('isInsideChangeCutoff', () => {
  const rules = { changeCutoffHours: 24 };
  it('sin plazo nunca bloquea', () => {
    expect(isInsideChangeCutoff({}, inHours(1), now)).toBe(false);
  });
  it('bloquea cuando falta menos que el plazo', () => {
    expect(isInsideChangeCutoff(rules, inHours(23), now)).toBe(true);
    expect(isInsideChangeCutoff(rules, inHours(0.5), now)).toBe(true);
  });
  it('permite cuando falta el plazo exacto o más', () => {
    expect(isInsideChangeCutoff(rules, inHours(24), now)).toBe(false);
    expect(isInsideChangeCutoff(rules, inHours(72), now)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { outOnDay } from '@/lib/people-time';

const r = (employeeId: string, startDate: string, endDate: string, half = '') => ({ employeeId, startDate, endDate, half });

describe('outOnDay (quién está fuera un día)', () => {
  it('cuenta solo las licencias que cubren ese día', () => {
    const out = outOnDay([r('a', '2026-03-02', '2026-03-06'), r('b', '2026-03-09', '2026-03-10'), r('c', '2026-02-20', '2026-03-01')], '2026-03-04');
    expect([...out.keys()]).toEqual(['a']);
    expect(out.get('a')).toEqual({ until: '2026-03-06', half: '' });
  });

  it('el primer y el último día cuentan', () => {
    expect(outOnDay([r('a', '2026-03-02', '2026-03-06')], '2026-03-02').get('a')?.until).toBe('2026-03-06');
    expect(outOnDay([r('a', '2026-03-02', '2026-03-06')], '2026-03-06').get('a')?.until).toBe('2026-03-06');
  });

  it('encadena licencias contiguas o que se pisan, en cualquier orden', () => {
    const out = outOnDay([r('a', '2026-03-09', '2026-03-13'), r('a', '2026-03-02', '2026-03-08'), r('a', '2026-03-14', '2026-03-15')], '2026-03-03');
    expect(out.get('a')?.until).toBe('2026-03-15');
  });

  it('no encadena si queda un día en el medio', () => {
    const out = outOnDay([r('a', '2026-03-02', '2026-03-04'), r('a', '2026-03-06', '2026-03-09')], '2026-03-03');
    expect(out.get('a')?.until).toBe('2026-03-04');
  });

  it('medio día: dice qué mitad, y no encadena', () => {
    expect(outOnDay([r('a', '2026-03-03', '2026-03-03', 'am'), r('a', '2026-03-04', '2026-03-05')], '2026-03-03').get('a')).toEqual({ until: '2026-03-03', half: 'am' });
    expect(outOnDay([r('a', '2026-03-03', '2026-03-03', 'pm')], '2026-03-03').get('a')?.half).toBe('pm');
  });

  it('una mitad suelta al final no alarga la vuelta', () => {
    expect(outOnDay([r('a', '2026-03-02', '2026-03-03'), r('a', '2026-03-04', '2026-03-04', 'am')], '2026-03-02').get('a')?.until).toBe('2026-03-03');
  });

  it('ignora fechas inválidas', () => {
    expect(outOnDay([r('a', 'mañana', '2026-03-03')], '2026-03-03').size).toBe(0);
  });
});

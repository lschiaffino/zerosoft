import { afterAll, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '@/lib/utils';

// LocalDate escribe estas mismas funciones en el navegador: la zona es la de quien mira.
describe('fechas en la zona de quien mira', () => {
  const tz = process.env.TZ;
  afterAll(() => {
    process.env.TZ = tz;
  });

  it('un día suelto no se corre de día en una zona negativa', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    expect(formatDate('2026-03-15', 'en')).toBe('Mar 15, 2026');
    expect(formatDate('2026-03-01', 'es')).toContain('1');
    expect(formatDate('2026-03-01', 'es')).not.toContain('28');
  });

  it('un instante de la base se muestra en la zona local (no en UTC)', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    // 01:30 UTC del 15 = 22:30 del 14 en Buenos Aires.
    expect(formatDate('2026-03-15 01:30:00', 'en')).toBe('Mar 14, 2026');
    expect(formatDateTime('2026-03-15T01:30:00Z', 'en')).toContain('Mar 14, 2026');
    expect(formatDateTime('2026-03-15T01:30:00Z', 'en')).toMatch(/10:30/);
  });
});

import { readFileSync } from 'node:fs';
import { DATE_SLOT, splitAroundDate } from '@/lib/date-slot';
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

describe('frase con fecha', () => {
  it('parte el texto donde dice el mensaje, en cualquier orden de palabras', () => {
    expect(splitAroundDate(`Until ${DATE_SLOT}`)).toEqual(['Until ', '']);
    expect(splitAroundDate(`${DATE_SLOT} is the limit`)).toEqual(['', ' is the limit']);
    expect(splitAroundDate('Sin fecha')).toEqual(['Sin fecha', '']);
  });

  it('las páginas del servidor no pasan una función a un argumento simple de t.rich', () => {
    for (const file of ['app/[locale]/app/docs/(home)/page.tsx', 'app/[locale]/app/crm/leads/[id]/page.tsx']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/t\.rich\([^)]*date: \(\) =>/);
    }
  });
});

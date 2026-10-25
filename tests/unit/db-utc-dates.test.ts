import { describe, expect, it } from 'vitest';
import { formatDateTime, parseDbUtc, relDate, utcToLocalInput } from '@/lib/utils';

describe('fechas de SQLite sin zona (parseDbUtc)', () => {
  it("lee 'YYYY-MM-DD HH:MM:SS' de datetime('now') como UTC, no como hora local", () => {
    expect(parseDbUtc('2026-10-25 13:05:00').toISOString()).toBe('2026-10-25T13:05:00.000Z');
  });

  it('respeta un ISO con zona y no suma una Z de más', () => {
    expect(parseDbUtc('2026-10-25T13:05:00.000Z').toISOString()).toBe('2026-10-25T13:05:00.000Z');
    expect(parseDbUtc('2026-10-25T10:05:00-03:00').toISOString()).toBe('2026-10-25T13:05:00.000Z');
  });

  it('un día suelto es medianoche UTC (antes daba Invalid Date)', () => {
    expect(parseDbUtc('2026-10-25').toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('formatDateTime y relDate usan el mismo parser', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    expect(relDate(iso, 'en')).toBe('5 minutes ago');
    expect(formatDateTime('2026-10-25 13:05:00', 'en')).toContain('2026');
  });

  it('utcToLocalInput da el valor de un datetime-local en la hora del navegador', () => {
    const raw = '2026-10-25 13:05:00';
    const local = utcToLocalInput(raw);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Ida y vuelta: el datetime-local leído en hora local es el mismo instante.
    expect(new Date(local).toISOString()).toBe('2026-10-25T13:05:00.000Z');
    expect(utcToLocalInput('')).toBe('');
    expect(utcToLocalInput('nope')).toBe('');
  });
});

import { describe, expect, it, vi } from 'vitest';

// Base sin la columna teams.use_mode (antes de la migración 100).
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: () => ({
      get: async () => {
        throw new Error('no such column: use_mode');
      },
    }),
  }),
}));

import { dayPart, getWorkspaceMode } from '@/lib/home';

describe('lib/home', () => {
  it('saludo según la hora en la zona de la persona', () => {
    const at = new Date('2026-10-25T12:00:00Z');
    expect(dayPart('UTC', at)).toBe('afternoon');
    expect(dayPart('America/Argentina/Buenos_Aires', at)).toBe('morning');
    expect(dayPart('Asia/Tokyo', at)).toBe('evening');
    expect(dayPart('Zona/Rota', at)).toBe('afternoon');
  });

  it('sin la columna use_mode el modo es equipo', async () => {
    await expect(getWorkspaceMode({ id: 'u1', team: null })).resolves.toBe('team');
  });
});

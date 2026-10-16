import { describe, expect, it } from 'vitest';
import { activeCycle, cycleState, projectSlug } from '@/lib/track-tasks';

describe('projectSlug', () => {
  it('deriva el slug como el servidor: minúsculas, sin acentos, guiones', () => {
    expect(projectSlug('Diseño Web')).toBe('diseno-web');
    expect(projectSlug('  App  móvil 2.0 ')).toBe('app-movil-2-0');
    expect(projectSlug('¡¡¡')).toBe('');
  });

  it('corta en 64 caracteres', () => {
    expect(projectSlug('a'.repeat(80))).toHaveLength(64);
  });
});

describe('cycleState y activeCycle', () => {
  const c14 = { id: '14', start_at: '2026-10-10', end_at: '2026-10-23T00:00:00Z' };
  const c15 = { id: '15', start_at: '2026-10-24', end_at: '2026-11-06' };
  const c13 = { id: '13', start_at: '2026-09-26', end_at: '2026-10-09' };

  it('clasifica con inicio y fin inclusive', () => {
    expect(cycleState(c14, '2026-10-10')).toBe('active');
    expect(cycleState(c14, '2026-10-23')).toBe('active');
    expect(cycleState(c15, '2026-10-23')).toBe('upcoming');
    expect(cycleState(c13, '2026-10-16')).toBe('past');
  });

  it('elige el ciclo en curso o null', () => {
    expect(activeCycle([c13, c14, c15], '2026-10-16')?.id).toBe('14');
    expect(activeCycle([c13, c15], '2026-10-16')).toBeNull();
    const overlap = { id: 'x', start_at: '2026-10-15', end_at: '2026-10-20' };
    expect(activeCycle([c14, overlap], '2026-10-16')?.id).toBe('x');
  });
});

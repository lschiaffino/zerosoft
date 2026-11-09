import { describe, expect, it } from 'vitest';
import { computeProgress, importedAuthor, initialsOf, parseInstant } from '@/lib/track-planning-core';

describe('track: página de project', () => {
  it('los instantes guardados (con o sin zona, o de SQLite) son el mismo momento UTC', () => {
    const at = '2026-11-06T23:30:00.000Z';
    expect(parseInstant(at)?.toISOString()).toBe(at);
    expect(parseInstant('2026-11-06 23:30:00')?.toISOString()).toBe(at);
    expect(parseInstant('2026-11-06T23:30:00')?.toISOString()).toBe(at);
    expect(parseInstant('2026-11-06T20:30:00-03:00')?.toISOString()).toBe(at);
    expect(parseInstant('nada')).toBeNull();
  });

  it('update importado: el autor real sale de meta.importedAuthor', () => {
    expect(importedAuthor(JSON.stringify({ importedAuthor: { name: 'Ana Pérez', email: 'ana@x.com' } }))).toEqual({ name: 'Ana Pérez', email: 'ana@x.com' });
    expect(importedAuthor(JSON.stringify({ importedAuthor: { email: 'ana@x.com' } }))?.name).toBe('ana@x.com');
    expect(importedAuthor(JSON.stringify({ previousProgress: 10 }))).toBeNull();
    expect(importedAuthor('{roto')).toBeNull();
    expect(initialsOf('Ana Pérez')).toBe('AP');
    expect(initialsOf('ana@x.com')).toBe('A');
  });

  it('progreso: terminado / alcance; los empezados no suman', () => {
    const p = computeProgress([
      { category: 'done', estimate: null },
      { category: 'in_progress', estimate: null },
      { category: 'in_progress', estimate: null },
      { category: 'todo', estimate: null },
      { category: 'backlog', estimate: null },
    ]);
    expect(p).toMatchObject({ total: 5, done: 1, started: 2, percent: 20, byPoints: false });
  });
});

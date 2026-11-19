import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atTourStart, deduceAudience, parseTours, shouldAutoStart, stepsFor, tourForPath, TOUR_KEYS, TOURS } from '@/lib/tours';

const ids = (steps: Array<{ id: string }>) => steps.map((s) => s.id);
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}/common.json`, 'utf8')) as { tour: Record<string, unknown> };

describe('tours: registro y rutas', () => {
  it('el tour de Lines vive en /app/lines y arranca en la bandeja', () => {
    expect(tourForPath('/app/lines/inbox')?.key).toBe('lines');
    expect(tourForPath('/es/app/lines/settings')?.key).toBe('lines');
    expect(tourForPath('/app/lines')?.key).toBe('lines');
    expect(tourForPath('/app/linesx')).toBeNull();
    expect(tourForPath('/app/inbox')).toBeNull();
    expect(tourForPath('/app/trackx')).toBeNull();
    expect(tourForPath(null)).toBeNull();
    expect(atTourStart(TOURS.lines, '/pt/app/lines/inbox')).toBe(true);
    expect(atTourStart(TOURS.lines, '/app/lines/inbox/abc')).toBe(false);
  });

  it('el tour de Track arranca en el resumen y sigue en Issues', () => {
    expect(tourForPath('/app/track')?.key).toBe('track');
    expect(tourForPath('/es/app/track/issues')?.key).toBe('track');
    expect(atTourStart(TOURS.track, '/pt/app/track')).toBe(true);
    expect(atTourStart(TOURS.track, '/app/track/issues')).toBe(false);
    // Track no pregunta equipo o sola: los mismos pasos para todos.
    expect(ids(stepsFor(TOURS.track, { audience: 'team', admin: false }))).toEqual(ids(stepsFor(TOURS.track, { audience: 'solo', admin: true })));
    const steps = ids([...TOURS.track.steps]);
    // Abrir Issues (un clic en el lateral) va antes de filtros, visualización y vistas, que viven ahí.
    expect(steps.indexOf('issues')).toBeLessThan(steps.indexOf('filters'));
    expect(TOURS.track.steps.find((s) => s.id === 'issues')).toMatchObject({ advanceOn: 'click' });
  });

  it('ids de pasos únicos por tour', () => {
    for (const key of TOUR_KEYS) {
      const list = ids([...TOURS[key].steps]);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('tours: pasos según equipo o persona sola', () => {
  it('equipo: asignar, notas y acceso a líneas; sola: ajustes', () => {
    const team = ids(stepsFor(TOURS.lines, { audience: 'team', admin: true }));
    const solo = ids(stepsFor(TOURS.lines, { audience: 'solo', admin: true }));
    expect(team).toEqual(expect.arrayContaining(['assign', 'note', 'lineAccess']));
    expect(team).not.toContain('settings');
    expect(solo).not.toEqual(expect.arrayContaining(['assign']));
    expect(solo).not.toContain('note');
    expect(solo).not.toContain('lineAccess');
    expect(solo).toContain('settings');
    expect(team[0]).toBe('intro');
    expect(team[team.length - 1]).toBe('done');
  });

  it('sin saber todavía: como persona sola hasta que conteste', () => {
    expect(ids(stepsFor(TOURS.lines, { audience: null, admin: true }))).toEqual(ids(stepsFor(TOURS.lines, { audience: 'solo', admin: true })));
  });

  it('quien no administra no ve los pasos de ajustes', () => {
    const member = ids(stepsFor(TOURS.lines, { audience: 'team', admin: false }));
    expect(member).not.toContain('lineAccess');
    expect(member).toContain('assign');
  });

  it('deduce el equipo del workspace; si no puede, la respuesta guardada o null', () => {
    expect(deduceAudience({ acting: true, people: 1, useMode: 'personal', answer: undefined })).toBe('team');
    expect(deduceAudience({ acting: false, people: 3, useMode: 'personal', answer: 'solo' })).toBe('team');
    expect(deduceAudience({ acting: false, people: 1, useMode: 'personal', answer: 'team' })).toBe('solo');
    expect(deduceAudience({ acting: false, people: 1, useMode: 'team', answer: undefined })).toBe('team');
    expect(deduceAudience({ acting: false, people: 1, useMode: null, answer: 'solo' })).toBe('solo');
    expect(deduceAudience({ acting: false, people: 1, useMode: null, answer: undefined })).toBeNull();
  });
});

describe('tours: estado por persona', () => {
  it('parsea el perfil y descarta lo que no reconoce', () => {
    expect(parseTours(null)).toEqual({});
    expect(parseTours({ off: true, audience: 'team', seen: { lines: { status: 'done', at: 'x' }, nope: { status: 'done' }, inbox: 1 } })).toEqual({
      off: true,
      audience: 'team',
      seen: { lines: { status: 'done', step: undefined, at: 'x' } },
    });
    expect(parseTours({ audience: 'crowd', seen: { lines: { status: 'weird' } } })).toEqual({ seen: {} });
  });

  it('se abre solo una vez, después del onboarding actual y sin "No mostrar más"', () => {
    const base = { onboarded: true, profileVersion: 2, tours: {}, tour: 'lines' as const };
    expect(shouldAutoStart(base)).toBe(true);
    expect(shouldAutoStart({ ...base, onboarded: false })).toBe(false);
    expect(shouldAutoStart({ ...base, profileVersion: 0 })).toBe(false);
    expect(shouldAutoStart({ ...base, tours: { off: true } })).toBe(false);
    expect(shouldAutoStart({ ...base, tours: { seen: { lines: { status: 'done', at: '' } } } })).toBe(false);
    expect(shouldAutoStart({ ...base, tours: { seen: { lines: { status: 'exited', at: '' } } } })).toBe(false);
    // A medias: se retoma.
    expect(shouldAutoStart({ ...base, tours: { seen: { lines: { status: 'active', step: 'search', at: '' } } } })).toBe(true);
  });
});

describe('tours: textos y anclajes', () => {
  it('cada paso tiene título y texto en en, es y pt', () => {
    for (const locale of ['en', 'es', 'pt']) {
      const tour = messages(locale).tour as Record<string, Record<string, { title?: string; body?: string }>>;
      for (const key of TOUR_KEYS) {
        for (const step of TOURS[key].steps) {
          expect(tour[key]?.[step.id]?.title, `${locale} ${key}.${step.id}.title`).toBeTruthy();
          expect(tour[key]?.[step.id]?.body, `${locale} ${key}.${step.id}.body`).toBeTruthy();
        }
      }
    }
  });

  it('cada anclaje de un paso existe como data-tour en algún componente', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
    const source = walk('components').map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const key of TOUR_KEYS) {
      for (const step of TOURS[key].steps) {
        for (const target of step.targets ?? []) {
          // data-tour="x", data-tour={cond ? 'x' : …}, tour="x" (MenuSelect) o tour: 'x' (ítems del lateral).
          const re = new RegExp(`(?:data-tour=\\{?[^}\\n]*|tour=|tour: )["']${target}["']`);
          expect(re.test(source), target).toBe(true);
        }
      }
    }
  });
});

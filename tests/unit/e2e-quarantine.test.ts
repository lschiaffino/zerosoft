import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { QUARANTINE_MAX_DAYS, loadQuarantine, quarantineFilter, quarantinePattern, splitTest } from '../e2e/quarantine';

const DAY = 24 * 3600_000;

describe('cuarentena de e2e (tests/e2e/quarantine.json)', () => {
  const entries = loadQuarantine();

  it('cada entrada apunta a un test que existe, con motivo y responsable', () => {
    for (const e of entries) {
      const { file, title } = splitTest(e);
      const source = path.join(process.cwd(), 'tests/e2e', file);
      expect(fs.existsSync(source), `${e.test}: no existe ${file}`).toBe(true);
      expect(fs.readFileSync(source, 'utf8').includes(title), `${e.test}: no hay un test con ese título`).toBe(true);
      expect(e.reason.trim().length, `${e.test}: falta el motivo`).toBeGreaterThan(10);
      expect(e.owner.trim().length, `${e.test}: falta el responsable`).toBeGreaterThan(0);
    }
    expect(new Set(entries.map((e) => e.test)).size).toBe(entries.length);
  });

  it(`ninguna lleva más de ${QUARANTINE_MAX_DAYS} días: se arregla la causa o se borra el test`, () => {
    for (const e of entries) {
      expect(e.since, `${e.test}: since es YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const age = (Date.now() - Date.parse(`${e.since}T00:00:00Z`)) / DAY;
      expect(age, `${e.test}: en cuarentena desde ${e.since}`).toBeLessThanOrEqual(QUARANTINE_MAX_DAYS);
      expect(age, `${e.test}: since está en el futuro`).toBeGreaterThan(-1);
    }
  });

  it('el patrón separa el test exacto de los que solo se le parecen', () => {
    const re = quarantinePattern([{ test: 'a.spec.ts › hace X', since: '2026-01-01', reason: 'motivo de prueba', owner: 'x' }])!;
    expect(re.test('a.spec.ts hace X')).toBe(true);
    expect(re.test('a.spec.ts grupo anidado hace X')).toBe(true);
    expect(re.test('a.spec.ts hace X @slow')).toBe(true);
    expect(re.test('a.spec.ts hace X y Y')).toBe(false);
    expect(re.test('b.spec.ts hace X')).toBe(false);
    expect(re.test('xa.spec.ts hace X')).toBe(false);
  });

  it('only, skip e include arman el filtro de Playwright', () => {
    expect(quarantineFilter('include')).toEqual({});
    const only = quarantineFilter('only');
    const skip = quarantineFilter('skip');
    if (entries.length === 0) {
      expect(skip).toEqual({});
      expect(only.grep!.test('cualquier.spec.ts test')).toBe(false);
    } else {
      expect(only.grep).toBeInstanceOf(RegExp);
      expect(skip.grepInvert).toBeInstanceOf(RegExp);
    }
    expect(() => quarantineFilter('todo')).toThrow();
  });
});

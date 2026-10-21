import { describe, expect, it } from 'vitest';
import {
  DOCS_HISTORY_GROUP_MS,
  DOCS_HISTORY_LIMIT,
  classifyChange,
  emptyHistory,
  firstChangedBlock,
  historyShortcut,
  recordChange,
  redoStep,
  undoStep,
  type DocsHistory,
  type DocsSnapshot,
} from '@/lib/docs-history';
import { deleteRange } from '@/lib/docs-blocks';
import type { DocsBlock } from '@/lib/docs-types';

const p = (id: string, content: string, extra: Partial<DocsBlock> = {}): DocsBlock => ({
  id,
  type: 'paragraph',
  content,
  ...extra,
});

/** Aplica una serie de estados como lo haría el editor (un render por estado). */
function run(states: DocsSnapshot[], times: number[]): DocsHistory {
  let h = emptyHistory();
  for (let i = 1; i < states.length; i++) h = recordChange(h, states[i - 1], states[i], times[i]);
  return h;
}

describe('docs-history: clasificación', () => {
  it('tipeo en un bloque, en el título y cambios de estructura', () => {
    const a = { title: '', blocks: [p('1', 'uno'), p('2', 'dos')] };
    expect(classifyChange(a, { ...a })).toEqual({ kind: 'none' });
    expect(classifyChange(a, { title: '', blocks: [p('1', 'unos'), a.blocks[1]] })).toEqual({ kind: 'text', key: '1' });
    expect(classifyChange(a, { ...a, title: 'T' })).toEqual({ kind: 'text', key: 'title' });
    // Borrar, cambiar el tipo, anidar o tocar dos bloques: estructura.
    expect(classifyChange(a, { title: '', blocks: [a.blocks[0]] }).kind).toBe('structure');
    expect(classifyChange(a, { title: '', blocks: [{ ...a.blocks[0], type: 'heading' }, a.blocks[1]] }).kind).toBe('structure');
    expect(classifyChange(a, { title: '', blocks: [{ ...a.blocks[0], indent: 1 }, a.blocks[1]] }).kind).toBe('structure');
    expect(classifyChange(a, { title: '', blocks: [p('1', 'x'), p('2', 'y')] }).kind).toBe('structure');
    // Copias con el mismo valor (filas de tabla copiadas) no cuentan.
    const t1 = { title: '', blocks: [p('t', '', { type: 'table', rows: [['a']] })] };
    const t2 = { title: '', blocks: [p('t', '', { type: 'table', rows: [['a']] })] };
    expect(classifyChange(t1, t2)).toEqual({ kind: 'none' });
  });
});

describe('docs-history: deshacer y rehacer', () => {
  it('borrar un bloque y deshacer devuelve los tres bloques con su texto (bug QA)', () => {
    // Página con uno/dos/tres tipeados, Esc sobre "dos" y Backspace.
    const s0 = { title: '', blocks: [p('1', '')] };
    const s1 = { title: '', blocks: [p('1', 'uno')] };
    const s2 = { title: '', blocks: [p('1', 'uno'), p('2', '')] };
    const s3 = { title: '', blocks: [p('1', 'uno'), p('2', 'dos')] };
    const s4 = { title: '', blocks: [...s3.blocks, p('3', '')] };
    const s5 = { title: '', blocks: [s3.blocks[0], s3.blocks[1], p('3', 'tres')] };
    const s6 = { title: '', blocks: deleteRange(s5.blocks, 1, 1, () => 'x').blocks };
    expect(s6.blocks.map((b) => b.content)).toEqual(['uno', 'tres']);
    let h = run([s0, s1, s2, s3, s4, s5, s6], [0, 100, 200, 300, 400, 500, 5000]);

    const u1 = undoStep(h, s6)!;
    expect(u1.snapshot.blocks.map((b) => b.content)).toEqual(['uno', 'dos', 'tres']);
    h = u1.history;
    // Segundo Cmd+Z: deshace el tipeo de "tres", nunca vacía otros bloques.
    const u2 = undoStep(h, u1.snapshot)!;
    expect(u2.snapshot.blocks.map((b) => b.content)).toEqual(['uno', 'dos', '']);
    h = u2.history;
    // Rehacer dos veces vuelve al estado con el bloque borrado.
    const r1 = redoStep(h, u2.snapshot)!;
    expect(r1.snapshot.blocks.map((b) => b.content)).toEqual(['uno', 'dos', 'tres']);
    const r2 = redoStep(r1.history, r1.snapshot)!;
    expect(r2.snapshot.blocks.map((b) => b.content)).toEqual(['uno', 'tres']);
    expect(redoStep(r2.history, r2.snapshot)).toBeNull();
  });

  it('agrupa el tipeo seguido y corta con una pausa o al cambiar de bloque', () => {
    const s = (a: string, b: string) => ({ title: '', blocks: [p('1', a), p('2', b)] });
    const states = [s('', ''), s('h', ''), s('ho', ''), s('hol', ''), s('hol', 'x'), s('hol', 'xy')];
    const times = [0, 100, 200, 200 + DOCS_HISTORY_GROUP_MS + 1, 1400, 1500];
    const h = run(states, times);
    // "ho" | "l" (después de la pausa) | "xy" (otro bloque).
    expect(h.past).toHaveLength(3);
    const u = undoStep(h, states[5])!;
    expect(u.snapshot.blocks[1].content).toBe('');
    expect(u.snapshot.blocks[0].content).toBe('hol');
  });

  it('un cambio nuevo vacía rehacer y el historial tiene tope', () => {
    const a = { title: '', blocks: [p('1', 'a')] };
    const b = { title: '', blocks: [p('1', 'a'), p('2', '')] };
    let h = recordChange(emptyHistory(), a, b, 0);
    const u = undoStep(h, b)!;
    expect(u.history.future).toHaveLength(1);
    h = recordChange(u.history, a, { title: 'x', blocks: a.blocks }, 10);
    expect(h.future).toHaveLength(0);
    expect(undoStep(emptyHistory(), a)).toBeNull();

    let big = emptyHistory();
    let prev = a;
    for (let i = 0; i < DOCS_HISTORY_LIMIT + 20; i++) {
      const next = { title: '', blocks: [...prev.blocks, p(`n${i}`, '')] };
      big = recordChange(big, prev, next, i);
      prev = next;
    }
    expect(big.past).toHaveLength(DOCS_HISTORY_LIMIT);
  });

  it('caret: primer bloque distinto, y atajos de teclado', () => {
    expect(firstChangedBlock([p('1', 'a'), p('2', 'b')], [p('1', 'a'), p('2', 'c')])).toBe(1);
    expect(firstChangedBlock([p('1', 'a')], [p('1', 'a'), p('2', 'b')])).toBe(1);
    expect(firstChangedBlock([p('1', 'a'), p('2', 'b')], [p('1', 'a')])).toBe(0);
    expect(firstChangedBlock([p('1', 'a')], [p('1', 'a')])).toBe(-1);
    const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
      historyShortcut({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
    expect(k('z', { metaKey: true })).toBe('undo');
    expect(k('Z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(k('y', { ctrlKey: true })).toBe('redo');
    expect(k('z')).toBeNull();
    expect(k('z', { metaKey: true, altKey: true })).toBeNull();
  });
});

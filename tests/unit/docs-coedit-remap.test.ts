import { describe, expect, it } from 'vitest';
import { deletedSpan, remapStructure, singleInsert, type RemoteTrace } from '@/lib/docs-coedit-remap';
import { apply, diff } from '@/lib/docs-ot';

const blk = (id: string, content: string) => ({ id, type: 'paragraph', content });

describe('remapStructure (partir y unir mientras se escribe)', () => {
  it('partir: lo propio después del corte pasa al bloque nuevo, con el caret', () => {
    // En pantalla: "alpha beta gamma delta" + " uno" propio sin confirmar.
    const V = 'alpha beta gamma delta uno';
    // La otra persona partió después de "alpha beta": la operación borra " gamma delta" y deja lo propio.
    const op = [10, -12, 4];
    expect(apply(V, op)).toBe('alpha beta uno');
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    // Después se siguió escribiendo en el mismo lugar.
    const now = 'alpha beta uno dos';
    const prev = [blk('p', now)];
    const merged = [blk('p', now), blk('n', ' gamma delta')];
    const res = remapStructure(prev, merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha beta', ' gamma delta uno dos']);
    expect(res.caret).toEqual({ block: 'n', index: ' gamma delta uno dos'.length });
    expect(res.touched.sort()).toEqual(['n', 'p']);
  });

  it('partir con lo propio en el medio de la cola: va a ese lugar del bloque nuevo', () => {
    const V = 'alpha beta gaXmma delta';
    // Se borró " gamma delta" salvo la X propia (escrita en el medio).
    const op = [10, -3, 1, -9];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = apply(V, op);
    expect(now).toBe('alpha betaX');
    const merged = [blk('p', now), blk('n', ' gamma delta')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, null)!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha beta', ' gaXmma delta']);
  });

  it('unir: el bloque que se va lleva lo propio al lugar de la copia', () => {
    // La otra persona unió "second line" al final de "first line" (su copia no tiene lo propio).
    const traces: RemoteTrace[] = [{ block: 'q', at: 0, prev: 'first line', op: [10, 'second line'], own: false }];
    const prev = [blk('q', 'first linesecond line'), blk('p', 'second line uno dos')];
    const theirs = [blk('q', 'first linesecond line')];
    const merged = [blk('q', 'first linesecond line')];
    const res = remapStructure(prev, theirs, merged, traces, { block: 'p', index: 15 }, (id) => id === 'p')!;
    expect(res.blocks.map((b) => b.content)).toEqual(['first linesecond line uno dos']);
    expect(res.caret).toEqual({ block: 'q', index: 25 });
  });

  it('quien no escribió en el bloque no mueve nada (lo recibe por operaciones)', () => {
    const traces: RemoteTrace[] = [{ block: 'q', at: 0, prev: 'first line', op: [10, 'second line'], own: false }];
    const prev = [blk('q', 'first linesecond line'), blk('p', 'second line uno')];
    const theirs = [blk('q', 'first linesecond line')];
    expect(remapStructure(prev, theirs, theirs, traces, null, () => false)).toBeNull();
    // Partir sin texto propio en la cola: tampoco.
    const V = 'alpha beta gamma';
    const t2: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op: diff(V, 'alpha beta'), own: false }];
    const m2 = [blk('p', 'alpha beta'), blk('n', ' gamma')];
    expect(remapStructure([blk('p', 'alpha beta')], m2, m2, t2, null)).toBeNull();
  });

  it('un bloque nuevo cualquiera (no es la cola cortada) no se toca', () => {
    const V = 'alpha beta gamma uno';
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op: [10, -6, 4], own: true }];
    const merged = [blk('p', 'alpha beta uno'), blk('n', 'otra cosa')];
    expect(remapStructure([blk('p', 'alpha beta uno')], merged, merged, traces, null)).toBeNull();
  });

  it('deletedSpan y singleInsert', () => {
    expect(deletedSpan('abcdef', [2, -2, 2])).toEqual({ start: 2, text: 'cd', keptAt: null });
    expect(deletedSpan('abXcd', [-2, 1, -2])).toEqual({ start: 0, text: 'abcd', keptAt: 2 });
    expect(deletedSpan('abc', [3])).toBeNull();
    expect(singleInsert([3, 'xy', 2])).toEqual({ at: 3, text: 'xy' });
    expect(singleInsert([1, 'x', -1])).toBeNull();
  });
});

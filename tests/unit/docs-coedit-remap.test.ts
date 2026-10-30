import { describe, expect, it } from 'vitest';
import { deletedSpan, markedSpan, ownTail, plainLength, remapStructure, shiftedSpans, singleInsert, type RemoteTrace } from '@/lib/docs-coedit-remap';
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

  it('partir antes del caret cuando la otra persona ya escribió en el bloque nuevo: lo propio va después de la cola, lo suyo queda', () => {
    const V = 'alpha beta gamma delta typed';
    // Partió después de "alpha": la operación corta " beta gamma delta typed".
    const op = [5, -23];
    expect(apply(V, op)).toBe('alpha');
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    // Acá se siguió escribiendo en el borde del corte; allá ya escribió "Bnew " al principio del bloque nuevo.
    const now = 'alpha-by-A';
    const prev = [blk('p', now)];
    const merged = [blk('p', now), blk('n', 'Bnew  beta gamma delta typed')];
    const res = remapStructure(prev, merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha', 'Bnew  beta gamma delta typed-by-A']);
    expect(res.caret).toEqual({ block: 'n', index: 'Bnew  beta gamma delta typed-by-A'.length });
  });

  it('partir dos veces antes de que llegue la estructura: lo propio va al bloque nuevo que termina con la cola', () => {
    // La otra persona partió en "alpha be|", escribió "AA", partió otra vez y escribió "BB":
    // la estructura llega de una vez con dos bloques nuevos, el de la cola no es el primero.
    const V = 'alpha beta gamma delta un';
    const op = [8, -17];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = 'alpha beo dos';
    const merged = [blk('p', now), blk('a', 'AA'), blk('b', 'BBta gamma delta un')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha be', 'AA', 'BBta gamma delta uno dos']);
    expect(res.caret).toEqual({ block: 'b', index: 'BBta gamma delta uno dos'.length });
    expect(res.touched.sort()).toEqual(['b', 'p']);
  });

  it('la otra persona escribió antes del corte y partió en la misma operación: lo suyo queda arriba', () => {
    // "one|": escribió "Aa" y partió; acá ya estaba "Ba" propio al final.
    const V = 'one two three fiveBa';
    const op = [3, 'Aa', -15, 2];
    expect(apply(V, op)).toBe('oneAaBa');
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = 'oneAaBa';
    const merged = [blk('p', now), blk('x', 'Ab'), blk('n', ' two three five')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['oneAa', 'Ab', ' two three fiveBa']);
  });

  it('los bloques que se partieron acá quedan entre el bloque cortado y los nuevos: lo propio igual va a la cola', () => {
    // Acá: "Ba" al final y Enter (bloques propios "Bb", ""); allá partieron en "one|" y escribieron "Ab".
    const V = 'one two fiveBa';
    const op = [3, 'Aa', -9, 2];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const prev = [blk('p', 'oneAaBa'), blk('b1', 'Bb'), blk('b2', '')];
    const merged = [blk('p', 'oneAaBa'), blk('b1', 'Bb'), blk('b2', ''), blk('x', 'Ab'), blk('n', ' two five')];
    // Los bloques propios del medio se conocen recién (después del corte).
    const res = remapStructure(prev, merged, merged, traces, { block: 'b2', index: 0 }, () => false, (id) => (id === 'p' ? -1e9 : 1e9))!;
    expect(res.blocks.map((b) => b.content)).toEqual(['oneAa', 'Bb', '', 'Ab', ' two fiveBa']);
    expect(res.caret).toEqual({ block: 'b2', index: 0 });
  });

  it('el corte termina en un espacio: en el bloque nuevo es un espacio duro y lo propio igual se mueve', () => {
    // Allá ya tenían " uno dos " (lo propio confirmado) y cortaron justo antes de "tres".
    const V = 'alpha beta gamma uno dos tres';
    const op = [8, -17, 4];
    expect(apply(V, op)).toBe('alpha betres');
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = 'alpha betres cuatro';
    const merged = [blk('p', now), blk('a', 'AA'), blk('b', 'BBta gamma uno dos&nbsp;')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha be', 'AA', 'BBta gamma uno dos&nbsp;tres cuatro']);
    expect(res.caret).toEqual({ block: 'b', index: 'BBta gamma uno dos&nbsp;tres cuatro'.length });
  });

  it('el diff corrió el borrado una letra (la del borde se repite): lo propio igual se mueve', () => {
    // Caso real: "alpha be|ta ... dos tres" cortado; el diff describe el borrado desde "bet|a" hasta "t|res".
    const V = 'alpha beta gamma delta uno dos tres';
    const op = [9, -23, 3];
    expect(apply(V, op)).toBe('alpha betres');
    expect(shiftedSpans(V, deletedSpan(V, op)!).map((x) => x.text)).toEqual(['a gamma delta uno dos t', 'ta gamma delta uno dos ']);
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = 'alpha betres cuatro cinco ';
    const merged = [blk('p', now), blk('a', 'AA'), blk('b', 'BBta gamma delta uno dos ')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha be', 'AA', 'BBta gamma delta uno dos tres cuatro cinco ']);
    expect(res.caret).toEqual({ block: 'b', index: 'BBta gamma delta uno dos tres cuatro cinco '.length });
  });

  it('partir dos veces dentro de una negrita: el cierre queda arriba y lo propio va al final de la cola', () => {
    const V = 'alpha <strong>beta</strong> gamma delta un';
    const after = 'alpha <strong>be</strong>';
    const op = diff(V, after);
    expect(apply(V, op)).toBe(after);
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = after + 'o dos';
    const merged = [blk('p', now), blk('a', '<strong>AA</strong>'), blk('b', '<strong>BBta</strong> gamma delta un')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual([after, '<strong>AA</strong>', '<strong>BBta</strong> gamma delta uno dos']);
    expect(res.caret).toEqual({ block: 'b', index: '<strong>BBta</strong> gamma delta uno dos'.length });
  });

  it('partir dos veces en el medio de la cola: lo propio va al bloque donde terminó la cola', () => {
    const V = 'alpha beta gamma delta';
    const op = [10, -12];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = 'alpha beta uno';
    // La cola " gamma delta" quedó repartida en dos bloques nuevos.
    const merged = [blk('p', now), blk('a', ' gamma'), blk('b', ' delta'), blk('q', 'otro')];
    const prev = [blk('p', now), blk('q', 'otro')];
    const res = remapStructure(prev, merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha beta', ' gamma', ' delta uno', 'otro']);
    expect(res.caret).toEqual({ block: 'b', index: ' delta uno'.length });
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

  it('borrar una letra arriba no es un corte, aunque aparezca un bloque nuevo (debajo o más abajo)', () => {
    const V = 'hello world mine';
    const op = [4, -1, 11];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = apply(V, op) + ' more';
    const prev = [blk('p', now), blk('q', 'other')];
    for (const merged of [
      [blk('p', now), blk('q', 'other'), blk('r', 'foo bar')],
      [blk('p', now), blk('r', 'foo bar'), blk('q', 'other')],
      // Aunque el bloque nuevo termine con la letra borrada.
      [blk('p', now), blk('r', 'foo bao'), blk('q', 'other')],
      [blk('p', now), blk('q', 'other'), blk('r', 'foo bao')],
    ]) {
      const tOwn = [{ ...traces[0], tailOwn: ownTail(V, V + ' more', op) }];
      expect(remapStructure(prev, merged, merged, tOwn, { block: 'p', index: now.length })).toBeNull();
    }
    // Sin el dato del final propio: lo frena que la cola no termina los bloques nuevos o el bloque de antes en el medio.
    expect(remapStructure(prev, [blk('p', now), blk('q', 'other'), blk('r', 'foo bar')], [blk('p', now), blk('q', 'other'), blk('r', 'foo bar')], traces, null)).toBeNull();
    expect(remapStructure(prev, [blk('p', now), blk('r', 'foo bar'), blk('q', 'other')], [blk('p', now), blk('r', 'foo bar'), blk('q', 'other')], traces, null)).toBeNull();
    expect(remapStructure(prev, [blk('p', now), blk('q', 'other'), blk('r', 'foo bao')], [blk('p', now), blk('q', 'other'), blk('r', 'foo bao')], traces, null)).toBeNull();
  });

  it('B escribe en el medio; A borra una letra y aprieta Enter al final: nada se mueve', () => {
    // Pantalla de B: "hello world uno mine" (" uno" propio); A borra la "l" de "hel|lo".
    const server = 'hello world mine';
    const V = 'hello world uno mine';
    const op = [3, -1, 16];
    expect(ownTail(server, V, op)).toBe(false);
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, tailOwn: ownTail(server, V, op) }];
    const now = 'helo world uno dos mine';
    const merged = [blk('p', now), blk('n', 'zzz lol'), blk('q', 'other')];
    expect(remapStructure([blk('p', now), blk('q', 'other')], merged, merged, traces, { block: 'p', index: 18 })).toBeNull();
  });

  it('ownTail: lo que queda después del corte es todo propio', () => {
    expect(ownTail('alpha beta gamma', 'alpha beta gamma uno', [10, -6, 4])).toBe(true);
    expect(ownTail('alpha beta gamma', 'alpha beta gamma uno', [3, -1, 16])).toBe(false);
    expect(ownTail('abc', 'abc', [1, 'x', 2])).toBe(true);
  });

  it('cortar con letras repetidas ("xaa|aa yy")', () => {
    const V = 'xaaaa yy';
    const op = [3, -5];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true }];
    const now = 'xaa zz';
    const merged = [blk('p', now), blk('n', 'aa yy')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['xaa', 'aa yy zz']);
  });

  it('unir y escribir en el borde en la misma operación ("MM" + la copia): lo propio va a la copia', () => {
    // A unió "second line uno dos t" al final de "first line" y escribió "MM" en la unión.
    const traces: RemoteTrace[] = [{ block: 'q', at: 0, prev: 'first line', op: [10, 'MMsecond line uno dos t'], own: false }];
    const prev = [blk('q', 'first lineMMsecond line uno dos t'), blk('p', 'second line uno dos tres cuatro')];
    const theirs = [blk('q', 'first line')];
    const merged = [blk('q', 'first lineMMsecond line uno dos t')];
    const res = remapStructure(prev, theirs, merged, traces, { block: 'p', index: 31 }, (id) => id === 'p')!;
    expect(res.blocks.map((b) => b.content)).toEqual(['first lineMMsecond line uno dos tres cuatro']);
    expect(res.caret).toEqual({ block: 'q', index: 12 + 31 });
  });

  it('unir y escribir en el borde en dos operaciones: lo propio va a la copia', () => {
    const traces: RemoteTrace[] = [
      { block: 'q', at: 0, prev: 'first line', op: [10, 'second line uno'], own: false },
      { block: 'q', at: 1, prev: 'first linesecond line uno', op: [10, 'MM', 15], own: false },
    ];
    const prev = [blk('q', 'first lineMMsecond line uno'), blk('p', 'second line uno dos')];
    const merged = [blk('q', 'first lineMMsecond line uno')];
    const res = remapStructure(prev, [blk('q', 'first line')], merged, traces, null, (id) => id === 'p')!;
    expect(res.blocks.map((b) => b.content)).toEqual(['first lineMMsecond line uno dos']);
  });

  it('A borra la última letra (justo antes de lo propio), Enter y escribe algo que termina igual: nada se mueve', () => {
    const S0 = 'hello world mine uno';
    const V = 'hello world mine uno dos';
    const op = [19, -1, 4];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, tailOwn: ownTail(S0, V, op) }];
    const now = apply(V, op) + ' tres';
    const prev = [blk('p', now), blk('q', 'other')];
    const merged = [blk('p', now), blk('r', 'foo'), blk('q', 'other')];
    expect(remapStructure(prev, merged, merged, traces, { block: 'p', index: now.length }, () => true, () => 0)).toBeNull();
  });

  it('cortar una palabra repetida ("go go |go")', () => {
    const V = 'go go go XX';
    const op = [6, -2, 3];
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, tailOwn: ownTail('go go go', V, op) }];
    const now = 'go go  XX YY';
    const merged = [blk('p', now), blk('n', 'go')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length }, () => true, () => 0)!;
    expect(res.blocks.map((b) => b.content)).toEqual(['go go ', 'go XX YY']);
  });

  it('borrar una palabra y Enter en la misma operación: la cola se muda con lo propio, lo borrado no', () => {
    // "alpha beta| gamma delta uno dos t": Alt+Backspace borra "beta", Enter parte en "alpha |".
    const V = 'alpha beta gamma delta uno dos tres';
    const op = [6, -26, 3];
    expect(apply(V, op)).toBe('alpha res');
    const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, tailOwn: ownTail('alpha beta gamma delta uno dos t', V, op) }];
    const now = 'alpha res cuatro';
    const merged = [blk('p', now), blk('n', 'AA gamma delta uno dos t')];
    const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
    expect(res.blocks.map((b) => b.content)).toEqual(['alpha ', 'AA gamma delta uno dos tres cuatro']);
    expect(res.caret).toEqual({ block: 'n', index: 'AA gamma delta uno dos tres cuatro'.length });
  });

  describe('con marca', () => {
    const split = (to: string, tail: number) => [{ k: 'split' as const, to, tail }];

    it('una cola de dos letras con texto escrito antes en el bloque nuevo: lo propio la sigue', () => {
      const V = 'alpha beta uno dos tres cu';
      const op = [21, -2, 3];
      expect(apply(V, op)).toBe('alpha beta uno dos tr cu');
      const now = 'alpha beta uno dos tr cuatro';
      const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, marks: split('n', 2) }];
      const merged = [blk('p', now), blk('n', 'NEWes'), blk('q', 'next')];
      const res = remapStructure([blk('p', now), blk('q', 'next')], merged, merged, traces, { block: 'p', index: now.length })!;
      expect(res.blocks.map((b) => b.content)).toEqual(['alpha beta uno dos tr', 'NEWes cuatro', 'next']);
      expect(res.caret).toEqual({ block: 'n', index: 'NEWes cuatro'.length });
    });

    it('la marca manda: Backspace y Enter al final (sin cola) no traen marca y nada se mueve', () => {
      const V = 'hello world mine uno dos';
      const op = [19, -1, 4];
      const now = apply(V, op) + ' tres';
      const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, marks: [] }];
      // Con reglas de texto esto parecería un corte ("foo" termina con la letra borrada).
      const merged = [blk('p', now), blk('r', 'fooo'), blk('q', 'other')];
      expect(remapStructure([blk('p', now), blk('q', 'other')], merged, merged, traces, { block: 'p', index: now.length })).toBeNull();
    });

    it('borrar una letra y cortar en la misma operación: solo la cola se muda', () => {
      const V = 'hello world uno';
      // A borró la "l" de "hel|lo", cortó en "hello |" y " uno" es de B.
      const op = [3, -1, 2, -5, 4];
      expect(apply(V, op)).toBe('helo  uno');
      const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, marks: split('n', 5) }];
      const now = 'helo  uno dos';
      const merged = [blk('p', now), blk('n', 'world')];
      const res = remapStructure([blk('p', now)], merged, merged, traces, { block: 'p', index: now.length })!;
      expect(res.blocks.map((b) => b.content)).toEqual(['helo ', 'world uno dos']);
      expect(res.caret).toEqual({ block: 'n', index: 'world uno dos'.length });
    });

    it('la estructura llegó antes que el corte: el bloque nuevo ya estaba en pantalla', () => {
      const V = 'alpha beta uno';
      const op = [5, -5, 4];
      const now = 'alpha uno dos';
      const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, marks: split('n', 5) }];
      const both = [blk('p', now), blk('n', ' beta')];
      const res = remapStructure(both, both, both, traces, { block: 'p', index: now.length })!;
      expect(res.blocks.map((b) => b.content)).toEqual(['alpha', ' beta uno dos']);
    });

    it('sin nada propio detrás del corte: el caret igual sigue a la cola y la marca no vuelve a mover', () => {
      const V = 'alpha beta';
      const op = [5, -5];
      const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: V, op, own: true, marks: split('n', 5) }];
      const merged = [blk('p', 'alpha'), blk('n', ' beta')];
      const res = remapStructure([blk('p', 'alpha')], merged, merged, traces, { block: 'p', index: 5 })!;
      expect(res.blocks.map((b) => b.content)).toEqual(['alpha', ' beta']);
      expect(res.caret).toEqual({ block: 'n', index: 5 });
      expect(traces[0].done).toBe(true);
      const later = [blk('p', 'alpha otro'), blk('n', ' beta')];
      expect(remapStructure(later, later, later, traces, { block: 'p', index: 10 })).toBeNull();
    });

    it('la marca espera a la estructura', () => {
      const traces: RemoteTrace[] = [{ block: 'p', at: 0, prev: 'alpha beta', op: [5, -5], own: true, marks: split('n', 5) }];
      const merged = [blk('p', 'alpha')];
      expect(remapStructure(merged, merged, merged, traces, null)).toBeNull();
      expect(traces[0].done).toBeUndefined();
    });

    it('unir con marca: la copia es el final de lo insertado, aunque sea de una letra', () => {
      const traces: RemoteTrace[] = [{ block: 'q', at: 0, prev: 'first', op: [5, 'MMx'], own: false, marks: [{ k: 'merge', from: 'p', len: 1 }] }];
      const prev = [blk('q', 'firstMMx'), blk('p', 'x uno')];
      const merged = [blk('q', 'firstMMx')];
      const res = remapStructure(prev, [blk('q', 'firstMMx')], merged, traces, null, (id) => id === 'p')!;
      expect(res.blocks.map((b) => b.content)).toEqual(['firstMMx uno']);
    });

    it('markedSpan y plainLength', () => {
      expect(markedSpan('abcdef', [2, -4], 4)).toEqual({ start: 2, at: 2, text: 'cdef', keptAt: null, keptLen: 0 });
      // Antes de la cola se borró algo de verdad.
      expect(markedSpan('abcdef', [1, -5], 2)).toEqual({ start: 4, at: 1, text: 'ef', keptAt: null, keptLen: 0 });
      // Lo que quedó en el medio de la cola es de quien recibe.
      expect(markedSpan('abXcd', [-2, 1, -2], 4)).toEqual({ start: 0, at: 0, text: 'abcd', keptAt: 2, keptLen: 1 });
      expect(markedSpan('abc', [3], 2)).toBeNull();
      expect(plainLength('a<strong>b</strong>&nbsp;')).toBe(3);
    });
  });

  it('deletedSpan y singleInsert', () => {
    expect(deletedSpan('abcdef', [2, -2, 2])).toEqual({ start: 2, at: 2, text: 'cd', keptAt: null, keptLen: 0 });
    expect(deletedSpan('abXcd', [-2, 1, -2])).toEqual({ start: 0, at: 0, text: 'abcd', keptAt: 2, keptLen: 1 });
    // Lo conservado en el medio es solo formato: no es texto propio.
    expect(deletedSpan('<b>abcd</b>ef', [5, -2, 4, -2])).toEqual({ start: 5, at: 5, text: 'cdef', keptAt: null, keptLen: 4 })
    // Lo que insertó antes del corte corre el lugar después de la operación.
    expect(deletedSpan('one two', [3, 'Aa', -4])).toEqual({ start: 3, at: 5, text: ' two', keptAt: null, keptLen: 0 });
    expect(deletedSpan('abc', [3])).toBeNull();
    expect(singleInsert([3, 'xy', 2])).toEqual({ at: 3, text: 'xy' });
    expect(singleInsert([1, 'x', -1])).toBeNull();
  });
});

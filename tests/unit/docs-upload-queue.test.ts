import { describe, expect, it, vi } from 'vitest';
import type { DocsBlock } from '@/lib/docs-types';
import { canRetry, createUploadQueue, placeUploadedBlock, uploadSlots, type PendingUpload } from '@/lib/docs-upload-queue';

const up = (id: string, p: Partial<PendingUpload> = {}): PendingUpload => ({
  id,
  group: 'g',
  anchorId: 'a',
  beforeId: null,
  kind: 'image',
  name: `${id}.png`,
  size: 10,
  status: 'queued',
  progress: 0,
  ...p,
});

const para = (id: string, content = '', indent?: number): DocsBlock => ({ id, type: 'paragraph', content, ...(indent ? { indent } : {}) });
const img = (id: string): DocsBlock => ({ id, type: 'image', content: '', url: `/u/${id}` });

describe('cola de subidas', () => {
  it('pasa por en cola, subiendo, error, reintento y listo', () => {
    const q = createUploadQueue();
    const fn = vi.fn();
    q.subscribe(fn);
    q.add([up('x')]);
    expect(q.find('x')?.status).toBe('queued');
    q.start('x');
    q.progress('x', 41.6);
    expect(q.find('x')).toMatchObject({ status: 'uploading', progress: 42 });
    // El progreso no retrocede ni pasa de 100.
    q.progress('x', 10);
    expect(q.find('x')?.progress).toBe(42);
    // Y no llega a 100 hasta que el servidor responde.
    q.progress('x', 180);
    expect(q.find('x')?.progress).toBe(99);
    q.fail('x', 'failed');
    expect(q.find('x')).toMatchObject({ status: 'error', error: 'failed' });
    expect(canRetry(q.find('x')!)).toBe(true);
    q.retry('x');
    expect(q.find('x')).toMatchObject({ status: 'queued', progress: 0, error: undefined });
    q.start('x');
    q.done('x', 'x');
    expect(q.get()).toEqual([]);
    expect(fn).toHaveBeenCalled();
  });

  it('un archivo que no entra o de un tipo no permitido no ofrece reintentar', () => {
    const q = createUploadQueue();
    q.add([up('a1'), up('a2')]);
    q.fail('a1', 'tooLarge');
    q.fail('a2', 'typeNotAllowed');
    expect(canRetry(q.find('a1')!)).toBe(false);
    expect(canRetry(q.find('a2')!)).toBe(false);
  });

  it('al terminar una, las que esperan en el grupo van debajo del bloque nuevo; una con error queda donde estaba', () => {
    const q = createUploadQueue();
    q.add([up('one'), up('two'), up('three'), up('other', { group: 'h' })]);
    q.fail('two', 'failed');
    q.done('one', 'one');
    expect(q.find('two')).toMatchObject({ anchorId: 'a' });
    expect(q.find('three')).toMatchObject({ anchorId: 'one' });
    expect(q.find('other')).toMatchObject({ anchorId: 'a' });
  });

  it('las medidas del archivo local se guardan cuando son válidas', () => {
    const q = createUploadQueue();
    q.add([up('x')]);
    q.measure('x', 0, 10);
    expect(q.find('x')?.width).toBeUndefined();
    q.measure('x', 640, 360);
    expect(q.find('x')).toMatchObject({ width: 640, height: 360 });
  });

  it('quitar o cancelar saca la subida', () => {
    const q = createUploadQueue();
    q.add([up('x')]);
    q.remove('x');
    expect(q.get()).toEqual([]);
    // Operaciones sobre una que ya no está no hacen nada.
    q.progress('x', 50);
    q.fail('x', 'failed');
    expect(q.get()).toEqual([]);
  });
});

describe('placeUploadedBlock', () => {
  it('va justo arriba de la línea pedida, con su nivel, y la línea queda debajo', () => {
    const out = placeUploadedBlock([para('a', 'hola'), para('p', '', 1), para('z', 'fin')], img('i'), { anchorId: 'a', beforeId: 'p' });
    expect(out.map((b) => [b.id, b.indent ?? 0])).toEqual([
      ['a', 0],
      ['i', 1],
      ['p', 1],
      ['z', 0],
    ]);
  });

  it('varias seguidas quedan en orden arriba de la línea, aunque ya tenga texto', () => {
    const one = placeUploadedBlock([para('a', 'hola'), para('p', 'escribí')], img('i1'), { anchorId: 'a', beforeId: 'p' });
    const two = placeUploadedBlock(one, img('i2'), { anchorId: 'i1', beforeId: 'p' });
    expect(two.map((b) => b.id)).toEqual(['a', 'i1', 'i2', 'p']);
  });

  it('si la línea se borró, va después del ancla', () => {
    const out = placeUploadedBlock([para('a', 'hola'), para('z', 'fin')], img('i'), { anchorId: 'a', beforeId: 'p' });
    expect(out.map((b) => b.id)).toEqual(['a', 'i', 'z']);
  });

  it('al principio con ancla null, al final si el ancla se borró', () => {
    expect(placeUploadedBlock([para('a', 'x')], img('i'), { anchorId: null, beforeId: null }).map((b) => b.id)).toEqual(['i', 'a']);
    expect(placeUploadedBlock([para('a', 'x')], img('i'), { anchorId: 'gone', beforeId: null }).map((b) => b.id)).toEqual(['a', 'i']);
  });

  it('toma el nivel del ancla o el pedido, y entra en una columna si el ancla es el contenedor', () => {
    expect(placeUploadedBlock([para('a', 'x', 2)], img('i'), { anchorId: 'a', beforeId: null })[1].indent).toBe(2);
    expect(placeUploadedBlock([para('a', 'x', 2)], img('i'), { anchorId: 'a', beforeId: null, indent: 0 })[1].indent ?? 0).toBe(0);
    const col: DocsBlock = { id: 'c', type: 'column', content: '', indent: 1 };
    expect(placeUploadedBlock([col], img('i'), { anchorId: 'c', beforeId: null })[1].indent).toBe(2);
  });
});

describe('uploadSlots', () => {
  it('reparte cada esqueleto en su lugar, en orden', () => {
    const blocks = [para('a', 'x'), para('p'), para('b', 'y')];
    const s = uploadSlots(blocks, [
      up('r1', { beforeId: 'p', anchorId: 'a' }),
      up('r2', { beforeId: 'p', anchorId: 'a' }),
      up('af', { anchorId: 'b' }),
      up('t', { anchorId: null }),
      up('lost', { anchorId: 'gone' }),
    ]);
    expect(s.before.get('p')?.map((u) => u.id)).toEqual(['r1', 'r2']);
    expect(s.after.get('b')?.map((u) => u.id)).toEqual(['af']);
    expect(s.top.map((u) => u.id)).toEqual(['t']);
    expect(s.end.map((u) => u.id)).toEqual(['lost']);
  });

  it('con una columna o un sincronizado de ancla, va primero adentro del contenedor', () => {
    const blocks: DocsBlock[] = [
      { id: 'cols', type: 'columns', content: '' },
      { id: 'c1', type: 'column', content: '', indent: 1 },
      para('x', 'uno', 2),
      { id: 's', type: 'synced', content: '' },
      para('y', 'dos', 1),
    ];
    const s = uploadSlots(blocks, [up('in-col', { anchorId: 'c1' }), up('in-sync', { anchorId: 's' })]);
    expect(s.inside.get('c1')?.map((u) => u.id)).toEqual(['in-col']);
    expect(s.inside.get('s')?.map((u) => u.id)).toEqual(['in-sync']);
    expect(s.after.size).toBe(0);
    // Y el bloque cae ahí mismo.
    expect(placeUploadedBlock(blocks, img('i'), { anchorId: 'c1', beforeId: null }).map((b) => b.id)).toEqual(['cols', 'c1', 'i', 'x', 's', 'y']);
  });

  it('soltado en la página después de unas columnas, va debajo de todo el contenedor', () => {
    const blocks: DocsBlock[] = [
      { id: 'cols', type: 'columns', content: '' },
      { id: 'c1', type: 'column', content: '', indent: 1 },
      para('x', 'uno', 2),
      para('z', 'abajo'),
    ];
    const s = uploadSlots(blocks, [up('page', { anchorId: 'x', indent: 0 })]);
    expect(s.after.get('cols')?.map((u) => u.id)).toEqual(['page']);
    // Adentro de la columna, con su nivel: debajo del ancla.
    const t = uploadSlots(blocks, [up('col', { anchorId: 'x', indent: 2 })]);
    expect(t.after.get('x')?.map((u) => u.id)).toEqual(['col']);
  });

  it('si la línea de referencia se borró, va después del ancla', () => {
    const s = uploadSlots([para('a', 'x')], [up('r', { beforeId: 'p', anchorId: 'a' })]);
    expect(s.before.size).toBe(0);
    expect(s.after.get('a')?.map((u) => u.id)).toEqual(['r']);
  });
});

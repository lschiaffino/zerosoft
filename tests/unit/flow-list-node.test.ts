import { describe, expect, it } from 'vitest';
import { listOperation } from '@/lib/flow-engine';
import { NODE_DEFS, defaultConfig } from '@/lib/flow-schema';

const deals = [
  { name: 'b', amount: 10 },
  { name: 'a', amount: '5.5' },
  { name: 'b', amount: 100 },
  { name: 'c', amount: '' },
];
const tctx = { trigger: { deals } };
const names = (r: { items: unknown[] }) => r.items.map((i) => (i as { name: string }).name);

describe('Flow: nodo Lista (ordenar, limitar, sacar repetidos)', () => {
  it('ordena por número y deja los vacíos al final', () => {
    const asc = listOperation({ items: '{{trigger.deals}}', operation: 'sort', field: 'amount', order: 'asc' }, tctx);
    expect(names(asc)).toEqual(['a', 'b', 'b', 'c']);
    const desc = listOperation({ items: '{{trigger.deals}}', operation: 'sort', field: 'amount', order: 'desc' }, tctx);
    expect(names(desc)).toEqual(['b', 'b', 'a', 'c']);
    expect((desc.items[0] as { amount: number }).amount).toBe(100);
  });

  it('ordena textos y listas simples sin campo', () => {
    const r = listOperation({ items: '["b","a","c"]', operation: 'sort', order: 'asc' }, {});
    expect(r.items).toEqual(['a', 'b', 'c']);
  });

  it('limit se queda con los primeros N y tolera valores raros', () => {
    expect(listOperation({ items: '{{trigger.deals}}', operation: 'limit', count: 2 }, tctx).count).toBe(2);
    expect(listOperation({ items: '{{trigger.deals}}', operation: 'limit', count: -3 }, tctx).items).toEqual([]);
    expect(listOperation({ items: '{{trigger.deals}}', operation: 'limit', count: 'x' }, tctx).count).toBe(4);
  });

  it('dedupe conserva la primera aparición', () => {
    const r = listOperation({ items: '{{trigger.deals}}', operation: 'dedupe', field: 'name' }, tctx);
    expect(names(r)).toEqual(['b', 'a', 'c']);
  });

  it('algo que no es lista da lista vacía', () => {
    expect(listOperation({ items: 'hola', operation: 'sort' }, {}).items).toEqual([]);
  });

  it('el nodo está registrado con su salida y defaults', () => {
    expect(NODE_DEFS['data.list'].outputs).toEqual(['out']);
    expect(defaultConfig('data.list')).toMatchObject({ operation: 'sort', order: 'asc' });
  });
});

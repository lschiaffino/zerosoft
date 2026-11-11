import { describe, expect, it } from 'vitest';
import { anchorShift, atBottom, BOTTOM_SLACK, pickAnchor, type ItemBox } from '@/lib/scroll-anchor';

/** Una lista de mensajes de alturas dadas, con la lista corrida `scroll` px y su borde de arriba en `top`. */
function layout(heights: number[], scroll: number, top = 100): ItemBox[] {
  let y = top - scroll;
  return heights.map((h, i) => {
    const box = { id: `m-${i}`, top: y, bottom: y + h };
    y += h;
    return box;
  });
}

describe('Anclar el scroll de la conversación', () => {
  it('abajo de todo, con un margen', () => {
    expect(atBottom({ scrollTop: 921, scrollHeight: 1500, clientHeight: 500 })).toBe(true);
    expect(atBottom({ scrollTop: 1000, scrollHeight: 1500, clientHeight: 500 })).toBe(true);
    expect(atBottom({ scrollTop: 1000 - BOTTOM_SLACK, scrollHeight: 1500, clientHeight: 500 })).toBe(false);
  });

  it('el ancla es el primer mensaje que se ve, aunque esté cortado', () => {
    const items = layout([100, 100, 100, 100], 150);
    expect(pickAnchor(items, 100)).toEqual({ id: 'm-1', offset: -50 });
    expect(pickAnchor(layout([100, 100], 0), 100)).toEqual({ id: 'm-0', offset: 0 });
    expect(pickAnchor([], 100)).toBeNull();
  });

  it('un mensaje justo arriba del borde no cuenta', () => {
    expect(pickAnchor(layout([100, 100, 100], 100), 100)?.id).toBe('m-1');
  });

  it('una foto que carga arriba (crece 240 px): se corre el scroll lo mismo y lo que se lee no se mueve', () => {
    const before = layout([100, 100, 100, 100, 100], 250);
    const a = pickAnchor(before, 100)!;
    // m-0 pasa de 100 a 340 px: todo lo de abajo baja 240.
    const after = layout([340, 100, 100, 100, 100], 250);
    const now = after.find((x) => x.id === a.id)!.top - 100;
    expect(anchorShift(a, now)).toBe(240);
    // Con el scroll corregido, el ancla vuelve a donde estaba.
    const fixed = layout([340, 100, 100, 100, 100], 250 + 240);
    expect(fixed.find((x) => x.id === a.id)!.top - 100).toBe(a.offset);
  });

  it('mensajes anteriores que se suman arriba: se compensa toda la altura nueva', () => {
    const before = layout([100, 100, 100], 50);
    const a = pickAnchor(before, 100)!;
    const after = layout([80, 80, 80, 100, 100, 100], 50).map((x, i) => ({ ...x, id: i < 3 ? `old-${i}` : `m-${i - 3}` }));
    expect(anchorShift(a, after.find((x) => x.id === a.id)!.top - 100)).toBe(240);
  });

  it('algo que se achica arriba (un "Cargar anteriores" que se va) corre el scroll para atrás', () => {
    const a = pickAnchor(layout([40, 100, 100, 100], 140), 100)!;
    const after = layout([0, 100, 100, 100], 140);
    expect(anchorShift(a, after.find((x) => x.id === a.id)!.top - 100)).toBe(-40);
  });

  it('lo que cambia abajo de lo que se lee no mueve nada; los redondeos tampoco', () => {
    const a = pickAnchor(layout([100, 100, 100], 120), 100)!;
    const after = layout([100, 100, 400], 120);
    expect(anchorShift(a, after.find((x) => x.id === a.id)!.top - 100)).toBe(0);
    expect(anchorShift({ id: 'x', offset: 10 }, 10.6)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { menuPlace, menuPlaceAt, menuPlaceNear } from '@/lib/menu-place';

const btn = (left: number, top: number) => ({ left, right: left + 24, top, bottom: top + 24 });

describe('menuPlace', () => {
  it('abre debajo del botón, alineado a su borde derecho', () => {
    expect(menuPlace(btn(600, 100), 180, 200, 1280, 800)).toEqual({ top: 126, left: 444 });
  });

  it('cerca del borde izquierdo se corre para quedar entero', () => {
    expect(menuPlace(btn(40, 100), 180, 200, 1280, 800)).toEqual({ top: 126, left: 8 });
  });

  it('nunca se sale por la derecha', () => {
    const at = menuPlace(btn(380, 100), 180, 200, 390, 800);
    expect(at.left + 180).toBeLessThanOrEqual(390 - 8);
  });

  it('sin lugar abajo, abre arriba del botón', () => {
    expect(menuPlace(btn(600, 700), 180, 200, 1280, 800)).toEqual({ top: 498, left: 444 });
  });

  it('en una ventana muy baja no queda por encima del borde', () => {
    expect(menuPlace(btn(600, 100), 180, 400, 1280, 300).top).toBe(8);
  });
});

const inside = (p: { top: number; left: number }, w: number, h: number, vw: number, vh: number) =>
  p.left >= 8 && p.top >= 8 && p.left + w <= vw - 8 && p.top + h <= vh - 8;

describe('menuPlaceNear (la flecha de un mensaje)', () => {
  it('alineado a la izquierda del botón (mensaje recibido)', () => {
    expect(menuPlaceNear(btn(300, 100), 220, 300, 1280, 800, { align: 'left', gap: 4 })).toEqual({ top: 128, left: 300, maxHeight: 784 });
  });

  it('sin lugar abajo ni arriba, se corre lo justo para quedar entero (no se corta el último ítem)', () => {
    const at = menuPlaceNear(btn(600, 300), 220, 500, 1280, 700);
    expect(inside(at, 220, 500, 1280, 700)).toBe(true);
  });

  it('más alto que la ventana: ocupa la ventana y se corre por dentro', () => {
    expect(menuPlaceNear(btn(600, 300), 220, 900, 1280, 600)).toEqual({ top: 8, left: 404, maxHeight: 584 });
  });
});

describe('menuPlaceAt (clic derecho, en el puntero)', () => {
  it('la esquina de arriba a la izquierda en el punto', () => {
    expect(menuPlaceAt({ x: 340, y: 210 }, 220, 380, 1280, 800)).toEqual({ top: 210, left: 340, maxHeight: 784 });
  });

  it('cerca del borde derecho se abre hacia la izquierda; cerca de abajo, hacia arriba', () => {
    expect(menuPlaceAt({ x: 1200, y: 700 }, 220, 380, 1280, 800)).toEqual({ top: 320, left: 980, maxHeight: 784 });
  });

  it('en un teléfono queda entero dentro de la ventana', () => {
    for (const [x, y] of [
      [380, 830],
      [5, 5],
      [200, 420],
      [389, 10],
    ]) {
      const p = menuPlaceAt({ x, y }, 240, 420, 390, 844);
      expect(inside(p, 240, 420, 390, 844)).toBe(true);
    }
  });

  it('más alto que la ventana: arriba de todo, con la lista corriéndose por dentro', () => {
    const p = menuPlaceAt({ x: 100, y: 300 }, 220, 900, 1280, 500);
    expect(p).toEqual({ top: 8, left: 100, maxHeight: 484 });
  });
});

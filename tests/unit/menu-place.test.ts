import { describe, expect, it } from 'vitest';
import { menuPlace } from '@/lib/menu-place';

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

import { describe, expect, it } from 'vitest';
import { ACCENT_ON, appButtonColors, contrast, hexToOklch, oklchToHex } from '@/lib/app-accent';
import { PRODUCT_CONFIG } from '@/lib/products';

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const apps = Object.entries(PRODUCT_CONFIG);

describe('color del botón primario por app', () => {
  it('el texto se lee (4.5:1 o más) en reposo, al pasar el mouse y al apretar, en los dos temas', () => {
    for (const [key, p] of apps) {
      const c = appButtonColors(p.color);
      expect(c, key).not.toBeNull();
      for (const theme of ['light', 'dark'] as const) {
        const t = c![theme];
        for (const state of ['bg', 'hover', 'active'] as const) {
          expect(contrast(t[state], t.on), `${key} ${theme} ${state}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('el relleno sigue siendo el color de la app: mismo tono (unos pocos grados) y no se apaga', () => {
    for (const [key, p] of apps) {
      const base = hexToOklch(p.color)!;
      if (base.c < 0.04) continue; // grises (Robots): el tono no significa nada
      const c = appButtonColors(p.color)!;
      for (const theme of ['light', 'dark'] as const) {
        for (const state of ['bg', 'hover', 'active'] as const) {
          const t = hexToOklch(c[theme][state])!;
          expect(hueDiff(t.h, base.h), `${key} ${theme} ${state} tono`).toBeLessThanOrEqual(4);
          // El croma solo baja cuando el tono no entra en sRGB a esa luz (los cian oscuros).
          expect(t.c, `${key} ${theme} ${state} croma`).toBeGreaterThanOrEqual(base.c * (state === 'bg' ? 0.75 : 0.6));
        }
      }
    }
  });

  it('el texto es blanco en todas las apps salvo las de color muy claro (Notes), que llevan tinta del mismo tono', () => {
    for (const [key, p] of apps) {
      const on = appButtonColors(p.color)!.light.on;
      if (key === 'notes') {
        expect(on).not.toBe(ACCENT_ON);
        expect(hueDiff(hexToOklch(on)!.h, hexToOklch(p.color)!.h)).toBeLessThanOrEqual(10);
      } else {
        expect(on, key).toBe(ACCENT_ON);
      }
    }
  });

  it('un tono medio baja de luz hasta que el blanco se lee; uno oscuro queda igual', () => {
    const lines = appButtonColors('#65a30d')!;
    expect(lines.light.on).toBe(ACCENT_ON);
    expect(hexToOklch(lines.light.bg)!.l).toBeLessThan(hexToOklch('#65a30d')!.l);
    expect(appButtonColors('#1e3a8a')!.light.bg).toBe('#1e3a8a');
    expect(appButtonColors('#e6b400')!.light.bg).toBe('#e6b400');
  });

  it('en modo oscuro el relleno nunca es más oscuro que en el claro', () => {
    for (const [key, p] of apps) {
      const c = appButtonColors(p.color)!;
      expect(hexToOklch(c.dark.bg)!.l, key).toBeGreaterThanOrEqual(hexToOklch(c.light.bg)!.l - 0.005);
    }
  });

  it('al pasar el mouse y al apretar el botón cambia a la vista, cada vez más oscuro', () => {
    for (const [key, p] of apps) {
      const c = appButtonColors(p.color)!;
      for (const theme of ['light', 'dark'] as const) {
        const [bg, hover, active] = [c[theme].bg, c[theme].hover, c[theme].active].map((x) => hexToOklch(x)!.l);
        expect(bg - hover, `${key} ${theme} hover`).toBeGreaterThanOrEqual(0.025);
        expect(hover - active, `${key} ${theme} active`).toBeGreaterThanOrEqual(0.025);
      }
    }
  });

  it('OKLCH ida y vuelta conserva el color', () => {
    for (const hex of ['#65a30d', '#e6b400', '#1e3a8a', '#ffffff', '#000000']) {
      expect(oklchToHex(hexToOklch(hex)!)).toBe(hex);
    }
  });

  it('un color inválido no cambia nada', () => {
    expect(appButtonColors('red')).toBeNull();
    expect(appButtonColors(null)).toBeNull();
  });
});

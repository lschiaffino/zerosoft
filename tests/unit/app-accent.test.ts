import { describe, expect, it } from 'vitest';
import { ACCENT_ON_DARK, ACCENT_ON_LIGHT, appButtonColors, contrast } from '@/lib/app-accent';
import { PRODUCT_CONFIG } from '@/lib/products';

describe('color del botón primario por app', () => {
  it('el texto se lee (4.5:1 o más) sobre el color de cada app, en reposo y al pasar el mouse', () => {
    for (const [key, p] of Object.entries(PRODUCT_CONFIG)) {
      const c = appButtonColors(p.color);
      expect(c, key).not.toBeNull();
      expect(contrast(c!.bg, c!.on), key).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c!.hover, c!.on), `${key} hover`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('un color oscuro lleva texto blanco y uno claro, tinta', () => {
    expect(appButtonColors('#1e3a8a')?.on).toBe(ACCENT_ON_LIGHT);
    expect(appButtonColors('#e6b400')?.on).toBe(ACCENT_ON_DARK);
  });

  it('un color inválido no cambia nada', () => {
    expect(appButtonColors('red')).toBeNull();
    expect(appButtonColors(null)).toBeNull();
  });
});

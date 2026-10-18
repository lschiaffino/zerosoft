import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_THEMES, forcedBrandForPath, isBrandTheme, parseBrand } from '@/lib/brand-theme';

describe('temas de marca', () => {
  it('solo queda la marca default', () => {
    expect(BRAND_THEMES).toEqual(['default']);
  });

  it('parseBrand cae en default ante valores vacíos, desconocidos o el tema subte retirado', () => {
    expect(parseBrand(undefined)).toBe('default');
    expect(parseBrand('')).toBe('default');
    expect(parseBrand('nada')).toBe('default');
    expect(parseBrand(' SUBTE ')).toBe('default');
    expect(isBrandTheme('subte')).toBe(false);
    expect(isBrandTheme('default')).toBe(true);
  });

  it('las rutas forzadas: /brand en default; la guía de subte ya no existe', () => {
    expect(forcedBrandForPath('/es/brand')).toBe('default');
    expect(forcedBrandForPath('/brand')).toBe('default');
    expect(forcedBrandForPath('/pt/nuevo-branding/subte')).toBeNull();
    expect(forcedBrandForPath('/es/branding')).toBeNull();
    expect(forcedBrandForPath('/es/app')).toBeNull();
  });

  it('cada tema tiene su archivo de tokens y se importa en el layout', () => {
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
    for (const theme of BRAND_THEMES) {
      expect(layout).toContain(`@/styles/themes/${theme}.css`);
      const css = readFileSync(join(process.cwd(), `styles/themes/${theme}.css`), 'utf8');
      expect(css).toMatch(/:root\s*\{/);
    }
    expect(layout).not.toContain('subte');
    expect(existsSync(join(process.cwd(), 'styles/themes/subte.css'))).toBe(false);
  });

  it('el default usa Space Grotesk, IBM Plex Mono y filete de 1px', () => {
    const css = readFileSync(join(process.cwd(), 'styles/themes/default.css'), 'utf8');
    expect(css).toContain('--font-space-grotesk');
    expect(css).toContain('--font-plex-mono');
    expect(css).toMatch(/--stroke-rule:\s*1px/);
    expect(css).not.toContain('--font-archivo');
  });

  it('los estilos leen la voz de títulos y el filete de los tokens del tema, sin estaciones', () => {
    const dir = join(process.cwd(), 'styles');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
      const css = readFileSync(join(dir, f), 'utf8');
      expect(css, f).not.toMatch(/font-stretch:\s*75%/);
      expect(css, f).not.toMatch(/border-(top|bottom|left):\s*4px solid var\(--(brand-)?ink\)/);
      expect(css, f).not.toMatch(/-station\b/);
      expect(css, f).not.toContain("data-brand='subte'");
    }
  });
});

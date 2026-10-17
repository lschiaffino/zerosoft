import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_THEMES, forcedBrandForPath, isBrandTheme, parseBrand } from '@/lib/brand-theme';

describe('temas de marca', () => {
  it('parseBrand cae en default ante valores vacíos o desconocidos', () => {
    expect(parseBrand(undefined)).toBe('default');
    expect(parseBrand('')).toBe('default');
    expect(parseBrand('nada')).toBe('default');
    expect(parseBrand(' SUBTE ')).toBe('subte');
    expect(isBrandTheme('subte')).toBe(true);
    expect(isBrandTheme('nada')).toBe(false);
  });

  it('las rutas forzadas: /brand en default y la guía de subte en subte', () => {
    expect(forcedBrandForPath('/es/brand')).toBe('default');
    expect(forcedBrandForPath('/brand')).toBe('default');
    expect(forcedBrandForPath('/pt/nuevo-branding/subte')).toBe('subte');
    expect(forcedBrandForPath('/en/nuevo-branding/subte/')).toBe('subte');
    expect(forcedBrandForPath('/es/branding')).toBeNull();
    expect(forcedBrandForPath('/es/app')).toBeNull();
  });

  it('cada tema opcional tiene su archivo de tokens bajo html[data-brand] y se importa en el layout', () => {
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
    for (const theme of BRAND_THEMES) {
      expect(layout).toContain(`@/styles/themes/${theme}.css`);
      const css = readFileSync(join(process.cwd(), `styles/themes/${theme}.css`), 'utf8');
      if (theme === 'default') {
        expect(css).toMatch(/:root\s*\{/);
      } else {
        expect(css).toContain(`html[data-brand='${theme}']`);
      }
    }
  });

  it('el default no hereda la marca subte: Space Grotesk, IBM Plex Mono y filete de 1px', () => {
    const css = readFileSync(join(process.cwd(), 'styles/themes/default.css'), 'utf8');
    expect(css).toContain('--font-space-grotesk');
    expect(css).toContain('--font-plex-mono');
    expect(css).toMatch(/--stroke-rule:\s*1px/);
    expect(css).not.toContain('--font-archivo');
  });

  it('los estilos compartidos leen la voz de títulos y el filete de los tokens del tema', () => {
    // brand-page.css y network.css son solo del tema subte (guía y plano).
    const SUBTE_ONLY = new Set(['brand-page.css', 'network.css']);
    const dir = join(process.cwd(), 'styles');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.css') && !SUBTE_ONLY.has(n))) {
      const css = readFileSync(join(dir, f), 'utf8');
      expect(css, f).not.toMatch(/font-stretch:\s*75%/);
      expect(css, f).not.toMatch(/border-(top|bottom|left):\s*4px solid var\(--(brand-)?ink\)/);
    }
  });
});

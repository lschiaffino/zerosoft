import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from '@/lib/color-theme';
import { hasSessionHint, WHO_COOKIE } from '@/lib/session-hint';

/** Corre el script del modo de color contra un documento mínimo y devuelve data-theme. */
function runThemeScript(cookie: string, initial: string | null = null): string | null {
  const attrs = new Map<string, string>();
  if (initial) attrs.set('data-theme', initial);
  const document = {
    cookie,
    documentElement: {
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
    },
  };
  new Function('document', THEME_INIT_SCRIPT)(document);
  return attrs.get('data-theme') ?? null;
}

describe('THEME_INIT_SCRIPT (modo de color antes del primer paint)', () => {
  it('pone light o dark según la cookie', () => {
    expect(runThemeScript('a=1; zs_theme=dark; b=2')).toBe('dark');
    expect(runThemeScript('zs_theme=light')).toBe('light');
    expect(runThemeScript('zs_theme=%20DARK')).toBe('dark');
  });

  it('sin cookie o con un valor raro sigue al sistema (sin atributo)', () => {
    expect(runThemeScript('')).toBeNull();
    expect(runThemeScript('zs_theme=sepia', 'dark')).toBeNull();
    expect(runThemeScript('xzs_theme=dark')).toBeNull();
  });
});

describe('hasSessionHint (header del sitio logueado sin leer la sesión)', () => {
  it('ve la cookie zs_who con valor', () => {
    expect(hasSessionHint(`a=1; ${WHO_COOKIE}=abc123`)).toBe(true);
    expect(hasSessionHint(`${WHO_COOKIE}=abc123; b=2`)).toBe(true);
  });

  it('sin la cookie, vacía o con otro nombre parecido, no', () => {
    expect(hasSessionHint('')).toBe(false);
    expect(hasSessionHint(null)).toBe(false);
    expect(hasSessionHint(`${WHO_COOKIE}=`)).toBe(false);
    expect(hasSessionHint('xzs_who=1; zs_whom=2')).toBe(false);
  });
});

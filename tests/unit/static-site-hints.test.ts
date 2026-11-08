import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from '@/lib/color-theme';
import { SESSION_HINT_SCRIPT, WHO_COOKIE } from '@/lib/session-hint';
import { localeCookieScript, stripLocaleSetCookie } from '@/lib/locale-cookie';

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

/** Corre el script de la pista de sesión y devuelve <html data-session>. */
function runSessionScript(cookie: string): string | null {
  const attrs = new Map<string, string>();
  const document = { cookie, documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } };
  new Function('document', SESSION_HINT_SCRIPT)(document);
  return attrs.get('data-session') ?? null;
}

describe('SESSION_HINT_SCRIPT (header del sitio logueado sin leer la sesión)', () => {
  it('marca la sesión con la cookie zs_who con valor', () => {
    expect(runSessionScript(`a=1; ${WHO_COOKIE}=abc123`)).toBe('in');
    expect(runSessionScript(`${WHO_COOKIE}=abc123; b=2`)).toBe('in');
  });

  it('sin la cookie, vacía o con otro nombre parecido, no', () => {
    expect(runSessionScript('')).toBeNull();
    expect(runSessionScript(`${WHO_COOKIE}=`)).toBeNull();
    expect(runSessionScript(`${WHO_COOKIE}=; b=2`)).toBeNull();
    expect(runSessionScript('xzs_who=1; zs_whom=2')).toBeNull();
  });
});

describe('cookie de idioma en el navegador (el HTML estático no manda Set-Cookie)', () => {
  function runLocaleScript(locale: string, cookie: string): string[] {
    const written: string[] = [];
    const document = {
      get cookie() {
        return cookie;
      },
      set cookie(v: string) {
        written.push(v);
      },
    };
    new Function('document', localeCookieScript(locale))(document);
    return written;
  }

  it('la escribe si falta o es de otro idioma, y no si ya está', () => {
    expect(runLocaleScript('es', '')).toEqual(['NEXT_LOCALE=es; path=/; samesite=lax']);
    expect(runLocaleScript('es', 'NEXT_LOCALE=en; tz=UTC')).toEqual(['NEXT_LOCALE=es; path=/; samesite=lax']);
    expect(runLocaleScript('es', 'a=1; NEXT_LOCALE=es')).toEqual([]);
    expect(localeCookieScript('xx')).toBe('');
  });

  it('el middleware saca solo NEXT_LOCALE de los Set-Cookie', () => {
    const h = new Headers();
    h.append('set-cookie', 'NEXT_LOCALE=es; Path=/; SameSite=lax');
    h.append('set-cookie', 'other=1; Path=/');
    stripLocaleSetCookie(h);
    expect(h.getSetCookie()).toEqual(['other=1; Path=/']);
  });
});

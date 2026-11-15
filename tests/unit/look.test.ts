import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOOK_INIT_SCRIPT, lookCookieString, lookFromCookieHeader, lookSyncScript, parseLook } from '@/lib/look';

function runInit(path: string, cookie: string): string | null {
  let attr: string | null = null;
  const document = {
    cookie,
    documentElement: { setAttribute: (_: string, v: string) => (attr = v), getAttribute: () => attr },
  };
  new Function('document', 'location', LOOK_INIT_SCRIPT)(document, { pathname: path });
  return attr;
}

describe('look', () => {
  it('parsea y cae en classic', () => {
    expect(parseLook('classic')).toBe('classic');
    expect(parseLook(' LIQUID ')).toBe('liquid');
    expect(parseLook('neon')).toBe('classic');
    expect(parseLook(undefined)).toBe('classic');
    expect(parseLook('lines')).toBe('lines');
    expect(lookFromCookieHeader('a=1; zs_look=liquid; b=2')).toBe('liquid');
    expect(lookFromCookieHeader('zs_theme=dark')).toBe('classic');
    expect(lookCookieString('classic')).toMatch(/^zs_look=classic; Path=\/; Max-Age=\d+; SameSite=Lax$/);
  });

  it('el script inicial aplica la cookie solo en la app', () => {
    expect(runInit('/en/app/crm', 'zs_look=classic')).toBe('classic');
    expect(runInit('/es/app', 'x=1; zs_look=liquid')).toBe('liquid');
    expect(runInit('/en/app', '')).toBe('classic');
    expect(runInit('/en/app', 'zs_look=lines')).toBe('lines');
    expect(runInit('/en', 'zs_look=liquid')).toBe('lines');
    expect(runInit('/en/apps-page', 'zs_look=liquid')).toBe('lines');
    expect(runInit('/en/app', 'zs_look=<script>')).toBe('classic');
  });

  it('el script de la app pone el atributo y repone la cookie que falta', () => {
    const run = (cookie: string, attr: string | null) => {
      const doc = {
        cookie,
        documentElement: { getAttribute: () => attr, setAttribute: (_: string, v: string) => (attr = v) },
      };
      new Function('document', lookSyncScript('liquid'))(doc);
      return { attr, cookie: doc.cookie };
    };
    expect(run('', 'classic')).toEqual({ attr: 'liquid', cookie: lookCookieString('liquid') });
    expect(run('zs_look=liquid', 'liquid')).toEqual({ attr: 'liquid', cookie: 'zs_look=liquid' });
    expect(run('a=1; zs_look=classic', 'liquid').cookie).toBe(lookCookieString('liquid'));
  });

  it('el script de la app escapa el valor', () => {
    expect(lookSyncScript('classic')).toContain('"classic"');
    expect(lookSyncScript('classic')).not.toContain('</script');
  });

  it('cada bloque oscuro de un aspecto está para el sistema y para data-theme', () => {
    const css = readFileSync('styles/looks.css', 'utf8');
    for (const look of ['classic', 'liquid']) {
      const system = css.match(new RegExp(`:root\\[data-look='${look}'\\]:not\\(\\[data-theme='light'\\]\\) \\{([^}]*)\\}`))?.[1];
      const explicit = css.match(new RegExp(`:root\\[data-look='${look}'\\]\\[data-theme='dark'\\] \\{([^}]*)\\}`))?.[1];
      expect(system, look).toBeTruthy();
      expect(system?.replace(/\s+/g, ' ').trim()).toBe(explicit?.replace(/\s+/g, ' ').trim());
    }
  });
});

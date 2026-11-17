import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, LOOKS, LOOK_INIT_SCRIPT, SITE_LOOK, lookCookieString, lookFromCookieHeader, lookSyncScript, parseLook } from '@/lib/look';
import { lookOf } from '@/lib/look-server';

function runInit(path: string, cookie: string): string | null {
  let attr: string | null = null;
  const document = {
    cookie,
    documentElement: { setAttribute: (_: string, v: string) => (attr = v), getAttribute: () => attr },
  };
  new Function('document', 'location', LOOK_INIT_SCRIPT)(document, { pathname: path });
  return attr;
}

const CSS = readFileSync('styles/looks.css', 'utf8') + readFileSync('styles/looks-retro.css', 'utf8');

describe('look', () => {
  it('cinco aspectos; el default y el del sitio son current', () => {
    expect(LOOKS).toEqual(['current', 'lines', 'classic', 'liquid', 'retro']);
    expect(DEFAULT_LOOK).toBe('current');
    expect(SITE_LOOK).toBe('current');
  });

  it('parsea y cae en current', () => {
    expect(parseLook('classic')).toBe('classic');
    expect(parseLook(' LIQUID ')).toBe('liquid');
    expect(parseLook('neon')).toBe('current');
    expect(parseLook(undefined)).toBe('current');
    expect(parseLook('lines')).toBe('lines');
    expect(lookFromCookieHeader('a=1; zs_look=retro; b=2')).toBe('retro');
    expect(lookFromCookieHeader('zs_theme=dark')).toBe('current');
    expect(lookCookieString('classic')).toMatch(/^zs_look=classic; Path=\/; Max-Age=\d+; SameSite=Lax$/);
    // Una cuenta sin valor guardado (la columna es nueva y sin default) ve current.
    expect(lookOf({ ui_look: null })).toBe('current');
    expect(lookOf({})).toBe('current');
    expect(lookOf({ ui_look: 'liquid' })).toBe('liquid');
    expect(lookOf({ ui_look: 'neon' })).toBe('current');
  });

  it('el script inicial aplica la cookie solo en la app', () => {
    expect(runInit('/en/app/crm', 'zs_look=classic')).toBe('classic');
    expect(runInit('/es/app', 'x=1; zs_look=liquid')).toBe('liquid');
    expect(runInit('/en/app', 'zs_look=retro')).toBe('retro');
    expect(runInit('/pt/app/inbox', 'zs_look=lines')).toBe('lines');
    expect(runInit('/en/app', '')).toBe('current');
    expect(runInit('/en', 'zs_look=liquid')).toBe('current');
    expect(runInit('/en/apps-page', 'zs_look=liquid')).toBe('current');
    expect(runInit('/en/app', 'zs_look=<script>')).toBe('current');
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
    expect(run('', 'current')).toEqual({ attr: 'liquid', cookie: lookCookieString('liquid') });
    expect(run('zs_look=liquid', 'liquid')).toEqual({ attr: 'liquid', cookie: 'zs_look=liquid' });
    expect(run('a=1; zs_look=classic', 'liquid').cookie).toBe(lookCookieString('liquid'));
  });

  it('el script de la app escapa el valor', () => {
    expect(lookSyncScript('classic')).toContain('"classic"');
    expect(lookSyncScript('classic')).not.toContain('</script');
  });

  it('current no tiene reglas: la app se ve igual que antes de los aspectos', () => {
    // La muestra de Ajustes sí se llama current; la página nunca.
    expect(CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\.st-look-swatch\[data-look='current'\]/g, '')).not.toMatch(/data-look=['"]?current/);
    // Toda regla de la app va bajo un aspecto con nombre; lo único sin aspecto son las muestras de Ajustes.
    const selectors = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(50);
    for (const sel of selectors) {
      if (sel.startsWith('@') || /^(from|to|\d+%)$/.test(sel)) continue;
      // Cada parte de la lista de selectores (fuera de :is) va bajo un aspecto con nombre o es una muestra de Ajustes.
      const parts = sel.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g, '()').split(',').map((s) => s.trim());
      for (const p of parts) expect(p, sel).toMatch(/^(:root(\[data-look='(lines|classic|liquid|retro)'\]|:is\(\))|\.st-look-)/);
    }
  });

  it('cada bloque oscuro de un aspecto está para el sistema y para data-theme', () => {
    for (const look of ['classic', 'liquid', 'retro']) {
      const system = CSS.match(new RegExp(`:root\\[data-look='${look}'\\]:not\\(\\[data-theme='light'\\]\\) \\{([^}]*)\\}`))?.[1];
      const explicit = CSS.match(new RegExp(`:root\\[data-look='${look}'\\]\\[data-theme='dark'\\] \\{([^}]*)\\}`))?.[1];
      expect(system, look).toBeTruthy();
      expect(system?.replace(/\s+/g, ' ').trim()).toBe(explicit?.replace(/\s+/g, ' ').trim());
    }
  });
});

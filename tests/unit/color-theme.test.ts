import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  THEME_COOKIE,
  parseThemePref,
  themeAttr,
  themeCookieString,
  themePrefFromCookieHeader,
} from '@/lib/color-theme';

describe('modo de color: cookie zs_theme', () => {
  it('parseThemePref acepta system/light/dark y cae en system ante lo demás', () => {
    expect(parseThemePref('dark')).toBe('dark');
    expect(parseThemePref(' LIGHT ')).toBe('light');
    expect(parseThemePref('system')).toBe('system');
    expect(parseThemePref(undefined)).toBe('system');
    expect(parseThemePref(null)).toBe('system');
    expect(parseThemePref('')).toBe('system');
    expect(parseThemePref('sepia')).toBe('system');
  });

  it('lee la preferencia de un header Cookie completo', () => {
    expect(themePrefFromCookieHeader('a=1; zs_theme=dark; b=2')).toBe('dark');
    expect(themePrefFromCookieHeader('zs_theme=light')).toBe('light');
    expect(themePrefFromCookieHeader('zs_theme=%64ark')).toBe('dark');
    expect(themePrefFromCookieHeader('zs_themex=dark; xzs_theme=dark')).toBe('system');
    expect(themePrefFromCookieHeader('zs_theme=nope')).toBe('system');
    expect(themePrefFromCookieHeader('')).toBe('system');
    expect(themePrefFromCookieHeader(null)).toBe('system');
  });

  it('data-theme solo cuando la preferencia es explícita', () => {
    expect(themeAttr('dark')).toBe('dark');
    expect(themeAttr('light')).toBe('light');
    expect(themeAttr('system')).toBeUndefined();
  });

  it('la cookie se guarda un año y system la borra', () => {
    expect(themeCookieString('dark')).toMatch(new RegExp(`^${THEME_COOKIE}=dark; Path=/; Max-Age=31536000`));
    expect(themeCookieString('system')).toContain('Max-Age=0');
  });

  it('los tokens oscuros de sistema y de data-theme="dark" son los mismos', () => {
    const css = readFileSync(join(process.cwd(), 'styles/themes/dark.css'), 'utf8');
    const between = (a: string, b: string) => css.slice(css.indexOf(a) + a.length, css.indexOf(b));
    const norm = (s: string) =>
      s
        .replace(/:root:not\(\[data-theme='light'\]\)|:root\[data-theme='dark'\]/g, 'ROOT')
        .replace(/@media \(prefers-color-scheme: dark\) \{/, '')
        .replace(/\s+/g, ' ')
        .trim();
    // El bloque de sistema cierra además el @media.
    const system = norm(between('/* --- dark:system --- */', '/* --- end:system --- */')).replace(/\}$/, '').trim();
    const explicit = norm(between('/* --- dark:explicit --- */', '/* --- end:explicit --- */'));
    expect(system.length).toBeGreaterThan(200);
    expect(system).toBe(explicit);
  });
});

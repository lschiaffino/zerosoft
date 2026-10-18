/**
 * Modo de color (claro / oscuro). Independiente del tema de marca
 * (lib/brand-theme.ts): la preferencia vive en la cookie zs_theme.
 *
 * - `system` (default, sin cookie): <html> no lleva data-theme y el CSS sigue
 *   a `prefers-color-scheme`.
 * - `light` / `dark`: el layout renderiza <html data-theme="light|dark">.
 *
 * Los tokens oscuros viven en styles/themes/dark.css.
 * Sin imports de Node ni de React: lo usan el layout y el cliente.
 */

export const THEME_PREFS = ['system', 'light', 'dark'] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

export const DEFAULT_THEME_PREF: ThemePref = 'system';

/** Cookie que guarda la preferencia. Ausente = system. */
export const THEME_COOKIE = 'zs_theme';

/** Un año, en segundos. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseThemePref(value: string | null | undefined): ThemePref {
  const v = (value ?? '').trim().toLowerCase();
  return (THEME_PREFS as readonly string[]).includes(v) ? (v as ThemePref) : DEFAULT_THEME_PREF;
}

/** Lee la preferencia de un header Cookie entero (`a=1; zs_theme=dark`). */
export function themePrefFromCookieHeader(header: string | null | undefined): ThemePref {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== THEME_COOKIE) continue;
    let raw = part.slice(i + 1).trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Valor mal codificado: se toma tal cual.
    }
    return parseThemePref(raw);
  }
  return DEFAULT_THEME_PREF;
}

/** El valor de <html data-theme>: nada en system (manda el CSS). */
export function themeAttr(pref: ThemePref): 'light' | 'dark' | undefined {
  return pref === 'system' ? undefined : pref;
}

/** La cookie a escribir desde el cliente (system la borra). */
export function themeCookieString(pref: ThemePref): string {
  if (pref === 'system') return `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return `${THEME_COOKIE}=${pref}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

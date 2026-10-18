/**
 * Temas de marca. `default` es la marca de zerosoft (el cero ZeroMark +
 * "zerosoft.ai", Space Grotesk + IBM Plex Mono, blanco y negro) y hoy es el
 * único. El mecanismo queda para un tema opcional futuro: se activaría por
 * cookie, visitando cualquier página con `?brand=<tema>` (y `?brand=default`
 * la borra; ver middleware.ts). Un valor desconocido se ignora.
 *
 * Agregar un tema:
 * 1. Sumar su clave a BRAND_THEMES.
 * 2. Crear styles/themes/<tema>.css con sus tokens bajo html[data-brand="<tema>"]
 *    e importarlo en app/layout.tsx (después de default.css).
 * 3. Sumar su caso en components/brand/Logo.tsx y ProductGlyph.tsx.
 * 4. Si necesita fuentes propias, cargarlas en app/[locale]/layout.tsx.
 * Sin imports de Node ni de React: lo usan el middleware y los layouts.
 */

export const BRAND_THEMES = ['default'] as const;
export type BrandTheme = (typeof BRAND_THEMES)[number];

export const DEFAULT_BRAND: BrandTheme = 'default';

/** Cookie que guarda el tema elegido. Ausente = default. */
export const BRAND_COOKIE = 'zs_brand';
/** Query param que cambia el tema (`?brand=<tema>`, `?brand=default`). */
export const BRAND_PARAM = 'brand';
/** Header interno: el middleware lo pone en las rutas que fuerzan un tema. */
export const BRAND_HEADER = 'x-zs-brand';

export function isBrandTheme(value: string | null | undefined): value is BrandTheme {
  return (BRAND_THEMES as readonly string[]).includes((value ?? '').trim().toLowerCase());
}

export function parseBrand(value: string | null | undefined): BrandTheme {
  const v = (value ?? '').trim().toLowerCase();
  return isBrandTheme(v) ? v : DEFAULT_BRAND;
}

/** Rutas (sin locale) que muestran un tema fijo, sin importar la cookie. */
const FORCED: ReadonlyArray<{ re: RegExp; brand: BrandTheme }> = [
  // La página de la marca default se ve siempre en default.
  { re: /^\/brand(?:\/|$)/, brand: 'default' },
];

/** Tema forzado por la ruta, si lo hay. Acepta el path con o sin locale. */
export function forcedBrandForPath(pathname: string): BrandTheme | null {
  const rest = pathname.replace(/^\/(en|es|pt)(?=\/|$)/, '') || '/';
  return FORCED.find((f) => f.re.test(rest))?.brand ?? null;
}

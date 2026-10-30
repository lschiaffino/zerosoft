// Slugs que no se pueden usar como alias custom de short links.
// Mantener sincronizada con middleware.ts
export const RESERVED_SLUGS = new Set([
  'en', 'es', 'pt',
  'app', 'api', 'auth', 'r', 's', 'n', 'b', 'q', 'f', 'h',
  'blog', 'products', 'docs', 'terms', 'privacy', 'security', 'status',
  'admin', 'www', 'mail', 'support', 'help', 'about', 'new',
  'login', 'signin', 'demo', 'manifesto', 'changelog', 'feedback', 'videos', 'roadmap', 'tools',
  'feedback-board', 'brand', 'nuevo-branding', 'download', 'store',
]);

export const SLUG_REGEX = /^[A-Za-z0-9_-]{2,32}$/;

/**
 * En el dominio por defecto el slug convive con las rutas del sitio; en un
 * dominio propio todo /<algo> es un link, así que solo chocan los locales
 * (/en/gate/…, /es/gone…) y __root (la raíz del dominio).
 */
export function isValidSlug(slug: string, customDomain = false): boolean {
  if (!SLUG_REGEX.test(slug)) return false;
  const lower = slug.toLowerCase();
  if (customDomain) return !['en', 'es', 'pt', '__root'].includes(lower);
  return !RESERVED_SLUGS.has(lower);
}

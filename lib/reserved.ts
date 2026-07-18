// Slugs que no se pueden usar como alias custom de short links.
// Mantener sincronizada con middleware.ts
export const RESERVED_SLUGS = new Set([
  'en', 'es', 'pt',
  'app', 'api', 'auth', 'r',
  'blog', 'products', 'docs', 'terms', 'privacy', 'security', 'status',
  'admin', 'www', 'mail', 'support', 'help', 'about', 'new',
  'login', 'signin', 'demo', 'manifesto',
]);

export const SLUG_REGEX = /^[A-Za-z0-9_-]{2,32}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug) && !RESERVED_SLUGS.has(slug.toLowerCase());
}

import { routing } from '@/i18n/routing';

const LOCALES = new Set<string>(routing.locales);

/**
 * Locale para rutas que no pasan por el middleware de next-intl (/r, /s):
 * cookie NEXT_LOCALE → Accept-Language (primer idioma soportado, por q) →
 * default. En un dominio propio la cookie no existe nunca, así que el header
 * es lo que decide.
 */
export function requestLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): string {
  if (cookie && LOCALES.has(cookie)) return cookie;
  if (acceptLanguage) {
    const prefs = acceptLanguage
      .split(',')
      .map((part, i) => {
        const [tag, ...params] = part.trim().split(';');
        const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
        const weight = q ? Number(q.slice(2)) : 1;
        return { lang: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(weight) ? weight : 0, i };
      })
      .filter((p) => p.lang && p.q > 0)
      .sort((a, b) => b.q - a.q || a.i - b.i);
    for (const p of prefs) if (LOCALES.has(p.lang)) return p.lang;
  }
  return routing.defaultLocale;
}

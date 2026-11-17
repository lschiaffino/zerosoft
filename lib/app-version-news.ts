/**
 * Qué trae la versión nueva, para el aviso de "Recargar" (AppUpdateBanner): los
 * títulos de las entradas más nuevas del changelog en el idioma de la persona.
 * Server-only (lee el changelog entero; la pestaña recibe solo el texto).
 */
import type { ChangelogEntry } from '@/content/changelog';

export type NewsLocale = 'en' | 'es' | 'pt';

export interface VersionNews {
  /** La entrada más nueva (ancla en /changelog). */
  id: string;
  /** Hasta `max` títulos de las entradas del último día, la más nueva primero. */
  titles: string[];
}

export function newsLocale(raw: string | null | undefined): NewsLocale {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}

/** Los títulos de las entradas del día más nuevo del changelog (hasta `max`); null si no hay entradas. */
export function versionNews(entries: readonly ChangelogEntry[], locale: NewsLocale, max = 2): VersionNews | null {
  const sorted = [...entries].filter((e) => e?.date && e.title).sort((a, b) => b.date.localeCompare(a.date));
  const first = sorted[0];
  if (!first) return null;
  const titles = sorted
    .filter((e) => e.date === first.date)
    .slice(0, Math.max(1, max))
    .map((e) => (e.title[locale] || e.title.en || '').trim())
    .filter(Boolean);
  return titles.length ? { id: first.id, titles } : null;
}

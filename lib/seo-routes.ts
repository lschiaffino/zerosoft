import type { MetadataRoute } from 'next';

/**
 * Las páginas fijas del sitio público: ruta, de dónde salen título y
 * descripción, y prioridad en el sitemap. La metadata de cada página, el
 * sitemap, la imagen OG (/api/og/page/<locale>/<key>), llms.txt y el chequeo
 * de SEO (scripts/seo-check.mjs) leen esta lista: una página pública nueva
 * se suma acá.
 */

export interface StaticPage {
  path: string;
  /** Namespace y claves de título y descripción en messages/<locale>. */
  ns: string;
  title: string;
  description: string;
  priority: number;
  freq: MetadataRoute.Sitemap[number]['changeFrequency'];
  /** Fecha real de la última revisión, si el contenido es fijo (legales). */
  updated?: string;
}

export const STATIC_PAGES = {
  home: { path: '', ns: 'common.meta', title: 'homeTitle', description: 'description', priority: 1, freq: 'weekly' },
  products: { path: '/products', ns: 'pages.products.meta', title: 'title', description: 'description', priority: 0.9, freq: 'weekly' },
  compare: { path: '/compare', ns: 'pages.compare.index.meta', title: 'title', description: 'description', priority: 0.8, freq: 'weekly' },
  tools: { path: '/tools', ns: 'tools.hub', title: 'metaTitle', description: 'metaDescription', priority: 0.9, freq: 'weekly' },
  blog: { path: '/blog', ns: 'common.blog', title: 'metaTitle', description: 'metaDescription', priority: 0.7, freq: 'weekly' },
  download: { path: '/download', ns: 'pages.download.meta', title: 'title', description: 'description', priority: 0.7, freq: 'weekly' },
  changelog: { path: '/changelog', ns: 'changelog', title: 'metaTitle', description: 'metaDescription', priority: 0.6, freq: 'weekly' },
  docs: { path: '/docs', ns: 'pages.docs.meta', title: 'title', description: 'description', priority: 0.6, freq: 'monthly' },
  docsMcp: { path: '/docs/mcp', ns: 'pages.docsMcp.meta', title: 'title', description: 'description', priority: 0.6, freq: 'monthly' },
  videos: { path: '/videos', ns: 'videos.meta', title: 'title', description: 'description', priority: 0.4, freq: 'monthly' },
  status: { path: '/status', ns: 'pages.status.meta', title: 'title', description: 'description', priority: 0.3, freq: 'monthly' },
  // Fechas de "Última actualización" de messages/<locale>/legal.json.
  security: { path: '/security', ns: 'legal.security.meta', title: 'title', description: 'description', priority: 0.3, freq: 'yearly', updated: '2026-11-09' },
  privacy: { path: '/privacy', ns: 'legal.privacy.meta', title: 'title', description: 'description', priority: 0.2, freq: 'yearly', updated: '2026-11-09' },
  subprocessors: { path: '/subprocessors', ns: 'legal.subprocessors.meta', title: 'title', description: 'description', priority: 0.2, freq: 'yearly', updated: '2026-11-09' },
  terms: { path: '/terms', ns: 'legal.terms.meta', title: 'title', description: 'description', priority: 0.2, freq: 'yearly', updated: '2026-10-12' },
} as const satisfies Record<string, StaticPage>;

export type StaticPageKey = keyof typeof STATIC_PAGES;

export function isStaticPageKey(value: string): value is StaticPageKey {
  return Object.prototype.hasOwnProperty.call(STATIC_PAGES, value);
}

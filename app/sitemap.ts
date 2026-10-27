import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getAllPosts } from '@/lib/blog';
import { PRODUCT_KEYS } from '@/lib/products';
import { siteUrl, TOOLS } from '@/lib/tools/registry';
import { headers } from 'next/headers';
import { isAppHost } from '@/lib/hosts';
import { siteForHost, siteSitemap } from '@/lib/docs-site';

/**
 * sitemap.xml del sitio público: cada página en los tres idiomas, con
 * hreflang (alternates.languages) entre versiones. Las herramientas gratis
 * (/tools) van con prioridad alta: son páginas pensadas para buscadores.
 */

const STATIC_PAGES: Array<{ path: string; priority: number; freq: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '', priority: 1, freq: 'weekly' },
  { path: '/products', priority: 0.9, freq: 'weekly' },
  { path: '/tools', priority: 0.9, freq: 'weekly' },
  { path: '/blog', priority: 0.7, freq: 'weekly' },
  { path: '/changelog', priority: 0.6, freq: 'weekly' },
  { path: '/feedback-board', priority: 0.5, freq: 'daily' },
  { path: '/feedback-board/roadmap', priority: 0.5, freq: 'weekly' },
  { path: '/docs', priority: 0.6, freq: 'monthly' },
  { path: '/videos', priority: 0.4, freq: 'monthly' },
  { path: '/security', priority: 0.3, freq: 'yearly' },
  { path: '/privacy', priority: 0.2, freq: 'yearly' },
  { path: '/terms', priority: 0.2, freq: 'yearly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Dominio propio de un sitio de Docs: el sitemap de ese sitio (sus páginas publicadas).
  const host = (await headers()).get('host');
  if (host && !isAppHost(host)) {
    const site = await siteForHost(host);
    return site ? siteSitemap(site.workspaceId, `https://${host.toLowerCase()}`) : [];
  }
  const base = siteUrl();
  const now = new Date();

  const localized = (path: string, priority: number, freq: MetadataRoute.Sitemap[number]['changeFrequency']) =>
    routing.locales.map((locale) => ({
      url: `${base}/${locale}${path}`,
      lastModified: now,
      changeFrequency: freq,
      priority,
      alternates: {
        languages: {
          ...Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${path}`])),
          'x-default': `${base}/en${path}`,
        },
      },
    }));

  const entries: MetadataRoute.Sitemap = [
    ...STATIC_PAGES.flatMap((p) => localized(p.path, p.priority, p.freq)),
    ...PRODUCT_KEYS.flatMap((k) => localized(`/products/${k}`, 0.8, 'weekly')),
    ...TOOLS.flatMap((tool) => localized(`/tools/${tool.slug}`, 0.8, 'monthly')),
  ];

  for (const locale of routing.locales) {
    for (const post of getAllPosts(locale)) {
      const date = new Date(post.date);
      entries.push({
        url: `${base}/${locale}/blog/${post.slug}`,
        lastModified: Number.isNaN(date.getTime()) ? now : date,
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }
  return entries;
}

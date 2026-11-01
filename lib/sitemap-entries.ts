import type { MetadataRoute } from 'next';
import { PARITY } from '@/content/feature-parity';
import { CHANGELOG } from '@/content/changelog';
import { AUTHORS, BLOG_LOCALES, TAG_MIN_POSTS, getAllPosts, getPostsByTag, getTags, latestPostDate, postLocales, tagLocales } from '@/lib/blog';
import { getComparisons } from '@/lib/compare';
import { absoluteBoardUrl, boardUsesSubdomain } from '@/lib/board-urls';
import { PRODUCT_KEYS } from '@/lib/products';
import { TOOLS } from '@/lib/tools/registry';
import { SEO_LOCALES, absoluteUrl, alternatesFor } from '@/lib/seo';
import { STATIC_PAGES, type StaticPage, type StaticPageKey } from '@/lib/seo-routes';

/**
 * Las entradas del sitemap del sitio público, sin depender del request (las
 * prueba tests/unit/sitemap.test.ts). Cada página va en los idiomas en los
 * que existe, con hreflang y x-default. lastmod es una fecha real (revisión
 * de paridad, changelog, fecha del post); si no hay una, no se pone.
 */

type Entry = MetadataRoute.Sitemap[number];
type Freq = Entry['changeFrequency'];

const day = (d: string | undefined | null) => (d ? new Date(`${d}T00:00:00Z`) : undefined);

function maxDate(...dates: (string | undefined | null)[]): string | undefined {
  return dates.filter((d): d is string => Boolean(d)).sort().at(-1);
}

/** Última revisión de cualquier tabla de paridad. */
export function latestParityReview(): string | undefined {
  return maxDate(...PRODUCT_KEYS.map((k) => PARITY[k].lastReviewed));
}

function staticLastmod(key: StaticPageKey, locale: string): string | undefined {
  const page: StaticPage = STATIC_PAGES[key];
  if (page.updated) return page.updated;
  switch (key) {
    case 'home':
    case 'products':
    case 'compare':
      return maxDate(latestParityReview(), CHANGELOG[0]?.date);
    case 'blog':
      return latestPostDate(locale) ?? undefined;
    case 'changelog':
      return CHANGELOG[0]?.date;
    default:
      return undefined;
  }
}

function entry(path: string, locale: string, priority: number, freq: Freq, lastmod?: string, locales: readonly string[] = SEO_LOCALES): Entry {
  const alt = alternatesFor(path, locale, locales);
  return {
    url: absoluteUrl(alt.canonical),
    ...(lastmod ? { lastModified: day(lastmod) } : {}),
    changeFrequency: freq,
    priority,
    alternates: { languages: Object.fromEntries(Object.entries(alt.languages).map(([l, p]) => [l, absoluteUrl(p)])) },
  };
}

/**
 * El board público y su roadmap. En zerosoft.ai su canonical es el subdominio
 * (feedback.zerosoft.ai): el sitemap lista esa URL; sin subdominio, la del sitio.
 */
function boardEntries(locale: string): MetadataRoute.Sitemap {
  return (['', '/roadmap'] as const).map((path) => {
    if (!boardUsesSubdomain()) return entry(`/feedback-board${path}`, locale, 0.5, 'weekly');
    return {
      url: absoluteBoardUrl(locale, path),
      changeFrequency: 'weekly' as const,
      priority: 0.5,
      alternates: {
        languages: {
          ...Object.fromEntries(SEO_LOCALES.map((l) => [l, absoluteBoardUrl(l, path)])),
          'x-default': absoluteBoardUrl('en', path),
        },
      },
    };
  });
}

export function sitemapEntries(): MetadataRoute.Sitemap {
  const out: MetadataRoute.Sitemap = [];
  for (const locale of SEO_LOCALES) {
    for (const key of Object.keys(STATIC_PAGES) as StaticPageKey[]) {
      const page: StaticPage = STATIC_PAGES[key];
      out.push(entry(page.path, locale, page.priority, page.freq, staticLastmod(key, locale)));
    }
    for (const k of PRODUCT_KEYS) out.push(entry(`/products/${k}`, locale, 0.8, 'weekly', PARITY[k].lastReviewed));
    for (const c of getComparisons()) {
      out.push(entry(`/compare/${c.vsSlug}`, locale, 0.7, 'weekly', c.lastReviewed));
      out.push(entry(`/compare/${c.altSlug}`, locale, 0.7, 'weekly', c.lastReviewed));
    }
    for (const tool of TOOLS) out.push(entry(`/tools/${tool.slug}`, locale, 0.8, 'monthly'));
    out.push(...boardEntries(locale));
  }

  for (const locale of BLOG_LOCALES) {
    for (const post of getAllPosts(locale)) {
      out.push(entry(`/blog/${post.slug}`, locale, 0.6, 'monthly', post.updated, postLocales(post.slug)));
    }
    // Tags con pocos posts van noindex: fuera del sitemap.
    for (const tag of getTags(locale)) {
      if (tag.count < TAG_MIN_POSTS) continue;
      const posts = getPostsByTag(locale, tag.slug);
      out.push(entry(`/blog/tag/${tag.slug}`, locale, 0.4, 'weekly', maxDate(...posts.map((p) => p.updated)), tagLocales(tag.slug)));
    }
    for (const author of Object.values(AUTHORS)) {
      out.push(entry(`/blog/author/${author.slug}`, locale, 0.3, 'weekly', latestPostDate(locale) ?? undefined));
    }
  }
  return out;
}

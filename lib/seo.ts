import type { Metadata } from 'next';
import { GITHUB_URL } from '@/components/site/catalog';

/**
 * SEO del sitio público: una sola forma de armar metadata (title, description,
 * canonical, hreflang con x-default, Open Graph y Twitter) y los bloques de
 * JSON-LD. Cada página pública llama a pageMetadata con su ruta sin locale
 * ("/products/crm"); el layout pone el template "%s · zerosoft".
 *
 * tests/unit/seo.test.ts y tests/e2e/seo.spec.ts verifican que cada página
 * tenga título único, canonical y alternates.
 */

export const SEO_LOCALES = ['en', 'es', 'pt'] as const;
export type SeoLocale = (typeof SEO_LOCALES)[number];
export const DEFAULT_SEO_LOCALE: SeoLocale = 'en';

/** Locale de Open Graph de cada idioma del sitio. */
export const OG_LOCALE: Record<SeoLocale, string> = { en: 'en_US', es: 'es_AR', pt: 'pt_BR' };

/** URL absoluta del sitio, sin barra final. */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://zerosoft.ai').replace(/\/$/, '');
}

/**
 * Meta tags de verificación de propiedad, desde variables de entorno:
 * GOOGLE_SITE_VERIFICATION (Search Console, el valor de content del meta
 * google-site-verification) y BING_SITE_VERIFICATION (Bing Webmaster Tools,
 * el de msvalidate.01). Sin variables, no se imprime nada.
 */
export function siteVerification(env: Record<string, string | undefined> = process.env): Metadata['verification'] {
  const google = env.GOOGLE_SITE_VERIFICATION?.trim();
  const bing = env.BING_SITE_VERIFICATION?.trim();
  const yandex = env.YANDEX_SITE_VERIFICATION?.trim();
  if (!google && !bing && !yandex) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(yandex ? { yandex } : {}),
    ...(bing ? { other: { 'msvalidate.01': bing } } : {}),
  };
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function isSeoLocale(value: string): value is SeoLocale {
  return (SEO_LOCALES as readonly string[]).includes(value);
}

/** "/products/crm" + "es" → "/es/products/crm" ("" es el home: "/es"). */
export function localePath(locale: string, path: string): string {
  return `/${locale}${path === '/' ? '' : path}`;
}

/**
 * canonical + hreflang de una ruta (sin locale). `locales` limita los idiomas
 * en los que la página existe (un post que solo está en español, un tag que
 * solo tiene posts en inglés); x-default va al inglés si existe, si no al
 * primero que haya.
 */
export function alternatesFor(path: string, locale: string, locales: readonly string[] = SEO_LOCALES) {
  const langs = SEO_LOCALES.filter((l) => locales.includes(l));
  const fallback = langs.includes(DEFAULT_SEO_LOCALE) ? DEFAULT_SEO_LOCALE : (langs[0] ?? DEFAULT_SEO_LOCALE);
  return {
    canonical: localePath(locale, path),
    languages: {
      ...Object.fromEntries(langs.map((l) => [l, localePath(l, path)])),
      'x-default': localePath(fallback, path),
    },
  };
}

export interface PageSeo {
  locale: string;
  /** Ruta sin locale: "" para el home, "/blog/slug" para un post. */
  path: string;
  title: string;
  description: string;
  /** Imagen 1200×630 (PNG). Sin ella, la del home. */
  image?: string;
  imageAlt?: string;
  /** El título va tal cual, sin " · zerosoft" (el home). */
  absoluteTitle?: boolean;
  type?: 'website' | 'article';
  /** Para artículos: fechas ISO y etiquetas. */
  publishedTime?: string;
  modifiedTime?: string;
  tags?: string[];
  /** Idiomas en los que existe la página (por defecto, los tres). */
  locales?: readonly string[];
  /** noindex,follow (páginas finas: un tag con un solo post). */
  noindex?: boolean;
}

export const DEFAULT_OG_IMAGE = '/api/og/home';

/** Metadata completa de una página pública. */
export function pageMetadata(seo: PageSeo): Metadata {
  const alternates = alternatesFor(seo.path, seo.locale, seo.locales);
  const image = seo.image ?? DEFAULT_OG_IMAGE;
  const ogLocale = isSeoLocale(seo.locale) ? OG_LOCALE[seo.locale] : OG_LOCALE.en;
  const others = SEO_LOCALES.filter((l) => l !== seo.locale && (!seo.locales || seo.locales.includes(l))).map((l) => OG_LOCALE[l]);
  const images = [{ url: image, width: 1200, height: 630, alt: seo.imageAlt ?? seo.title }];
  const base = {
    siteName: 'zerosoft',
    locale: ogLocale,
    alternateLocale: others,
    url: alternates.canonical,
    title: seo.title,
    description: seo.description,
    images,
  };
  return {
    title: seo.absoluteTitle ? { absolute: seo.title } : seo.title,
    description: seo.description,
    alternates,
    openGraph:
      seo.type === 'article'
        ? {
            ...base,
            type: 'article',
            publishedTime: seo.publishedTime,
            modifiedTime: seo.modifiedTime ?? seo.publishedTime,
            authors: ['zerosoft'],
            tags: seo.tags,
          }
        : { ...base, type: 'website' },
    twitter: { card: 'summary_large_image', title: seo.title, description: seo.description, images: [image] },
    ...(seo.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

/** JSON-LD seguro para <script>: escapa "<" para que no cierre la etiqueta. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const ORG_ID = () => `${siteOrigin()}/#organization`;
const SITE_ID = () => `${siteOrigin()}/#website`;

/** La organización (va en el home y la referencian las demás por @id). */
export function organizationLd() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID(),
    name: 'zerosoft',
    url: siteOrigin(),
    logo: { '@type': 'ImageObject', url: absoluteUrl('/apple-icon'), width: 180, height: 180 },
    sameAs: [GITHUB_URL],
    email: 'hola@zerosoft.ai',
  };
}

export function websiteLd(description: string) {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID(),
    name: 'zerosoft',
    url: siteOrigin(),
    description,
    inLanguage: SEO_LOCALES.slice(),
    publisher: { '@id': ORG_ID() },
  };
}

export interface Crumb {
  name: string;
  /** Ruta sin locale. */
  path: string;
}

/** BreadcrumbList: Inicio › … › la página. */
export function breadcrumbLd(locale: string, crumbs: Crumb[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(localePath(locale, c.path)),
    })),
  };
}

export interface FaqItem {
  q: string;
  a: string;
}

export function faqLd(items: FaqItem[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export interface SoftwareLdInput {
  locale: string;
  name: string;
  description: string;
  path: string;
  features?: string[];
  category?: string;
  image?: string;
}

/**
 * Una app como SoftwareApplication. La oferta es la que existe: el core es
 * AGPLv3 y self-host cuesta $0; zerosoft Cloud arranca con un plan gratis y
 * cobra por uso (la descripción de la oferta lo dice). Sin rating: no
 * inventamos reseñas.
 */
export function softwareLd(input: SoftwareLdInput) {
  const url = absoluteUrl(localePath(input.locale, input.path));
  return {
    '@type': 'SoftwareApplication',
    '@id': `${url}#software`,
    name: input.name,
    description: input.description,
    url,
    inLanguage: input.locale,
    applicationCategory: input.category ?? 'BusinessApplication',
    operatingSystem: 'Web, Linux (Docker), macOS, Windows',
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    isAccessibleForFree: true,
    ...(input.image ? { image: absoluteUrl(input.image) } : {}),
    ...(input.features?.length ? { featureList: input.features } : {}),
    offers: [
      {
        '@type': 'Offer',
        name: 'Self-host (AGPLv3)',
        price: '0',
        priceCurrency: 'USD',
        url: GITHUB_URL,
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: 'zerosoft Cloud',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free plan per workspace, then usage-based (clicks, bookings, emails, storage). Seats are not billed.',
        url: absoluteUrl(`/${input.locale}/products#precios`),
        availability: 'https://schema.org/InStock',
      },
    ],
    publisher: { '@id': ORG_ID() },
  };
}

export interface ArticleLdInput {
  locale: string;
  path: string;
  title: string;
  description: string;
  published: string;
  modified?: string;
  image: string;
  tags: string[];
  wordCount?: number;
  author: { name: string; path: string };
}

export function articleLd(a: ArticleLdInput) {
  const url = absoluteUrl(localePath(a.locale, a.path));
  return {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: url,
    headline: a.title,
    description: a.description,
    inLanguage: a.locale,
    datePublished: a.published,
    dateModified: a.modified ?? a.published,
    image: absoluteUrl(a.image),
    keywords: a.tags.join(', '),
    ...(a.wordCount ? { wordCount: a.wordCount } : {}),
    author: { '@type': 'Organization', name: a.author.name, url: absoluteUrl(localePath(a.locale, a.author.path)) },
    publisher: { '@id': ORG_ID(), '@type': 'Organization', name: 'zerosoft', logo: { '@type': 'ImageObject', url: absoluteUrl('/apple-icon') } },
  };
}

/** Varios nodos en un solo <script> con @graph. */
export function graphLd(nodes: unknown[]) {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

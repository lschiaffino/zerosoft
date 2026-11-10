import { getTranslations } from 'next-intl/server';
import { PRODUCT_CONFIG, isProductKey, type ProductKey } from '@/lib/products';
import { getPost, productOfPost } from '@/lib/blog';
import { findComparison } from '@/lib/compare';
import { getTool } from '@/lib/tools/registry';
import { CHANGELOG } from '@/content/changelog';
import { isSeoLocale, siteOrigin } from '@/lib/seo';
import { STATIC_PAGES, isStaticPageKey, type StaticPageKey } from '@/lib/seo-routes';
import { staticPageText } from '@/lib/seo-pages';
import type { OgSpec } from './render';

/**
 * Qué muestra cada tarjeta para compartir: de la ruta (/api/og/<kind>/…) al
 * contenido (OgSpec). Las del sitio salen de los mensajes y el contenido del
 * repo; las de un workspace (un video, un artículo del centro de ayuda, un
 * formulario) de la base, y solo si la página es pública para cualquiera.
 * null = 404 (no existe o es privado: la tarjeta no dice nada).
 */

export interface CardResult {
  spec: OgSpec;
  /** Contenido de un workspace: puede cambiar o dejar de ser público, cache corto. */
  shared?: boolean;
}

const pickLocale = (value: string | undefined) => (value && isSeoLocale(value) ? value : 'en');

/** "zerosoft.ai/products/crm" (sin el idioma: así se lee la dirección). */
function siteUrl(path: string): string {
  return `${new URL(siteOrigin()).host}${path}`;
}

/** Primera frase de un texto (las líneas cortas de las tarjetas). */
export function firstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = /^(.{12,}?[.!?])(\s|$)/.exec(clean);
  return m ? m[1] : clean;
}

/** Páginas de lectura (docs, legales, estado): en papel, como se leen. */
const PAPER_PAGES = new Set<StaticPageKey>(['docs', 'docsMcp', 'security', 'privacy', 'terms', 'status']);

export async function siteCard(kind: string, a?: string, b?: string): Promise<CardResult | null> {
  switch (kind) {
    case 'home': {
      const locale = pickLocale(a);
      const t = await getTranslations({ locale, namespace: 'common.meta' });
      return { spec: { seed: 'home', title: t('tagline'), apps: true, url: siteUrl('') } };
    }

    case 'product': {
      if (!a || !isProductKey(a)) return null;
      const locale = pickLocale(b);
      const t = await getTranslations({ locale, namespace: 'pages' });
      const rival = t(`products.${a}.compare.rival` as never);
      return {
        spec: {
          seed: `product:${a}`,
          product: a,
          title: t('product.alternative', { rival }),
          sub: firstSentence(t(`products.${a}.hero.sub` as never)),
          url: siteUrl(`/products/${a}`),
        },
      };
    }

    case 'blog': {
      const locale = b ? pickLocale(a) : 'en';
      const slug = b ?? a;
      if (!slug) return null;
      const post = getPost(locale, slug);
      if (!post) return null;
      const product = productOfPost(post);
      const t = await getTranslations({ locale, namespace: 'common.blog' });
      const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${post.date}T00:00:00Z`));
      return {
        spec: {
          seed: `blog:${slug}`,
          product: product ?? undefined,
          label: product ? undefined : t('label'),
          title: post.title,
          sub: `${date} · ${post.readingTime} ${t('readingTime')}`,
          url: siteUrl(`/blog/${slug}`),
        },
      };
    }

    case 'tool': {
      if (!a) return null;
      const locale = pickLocale(b);
      const t = await getTranslations({ locale, namespace: 'tools' });
      if (a === 'hub') {
        return { spec: { seed: 'tool:hub', label: t('common.label' as never), title: t('hub.metaTitle' as never), sub: t('hub.metaDescription' as never), url: siteUrl('/tools') } };
      }
      const tool = getTool(a);
      if (!tool) return null;
      return {
        spec: {
          seed: `tool:${a}`,
          product: tool.accent,
          title: t(`items.${a}.name` as never),
          sub: t(`items.${a}.short` as never),
          url: siteUrl(`/tools/${a}`),
        },
      };
    }

    case 'changelog': {
      const locale = pickLocale(a);
      const t = await getTranslations({ locale, namespace: 'changelog' });
      const latest = CHANGELOG[0];
      const latestTitle = latest ? latest.title[locale as 'en'] ?? latest.title.en : '';
      return {
        spec: {
          seed: 'changelog',
          label: 'Changelog',
          title: t('metaTitle'),
          sub: latest ? `${latest.date}: ${latestTitle}` : undefined,
          url: siteUrl('/changelog'),
        },
      };
    }

    case 'compare': {
      const locale = pickLocale(a);
      const found = b ? findComparison(b) : null;
      if (!found) return null;
      const { comparison: c, kind: page } = found;
      const t = await getTranslations({ locale, namespace: 'pages.compare' });
      const vars = { name: c.name, competitor: c.competitor };
      // Sin porcentaje público, sin porcentaje en la tarjeta.
      const parity = c.percentNote ? undefined : `${t('vs.glance.parity', vars)}: ${c.score.percent}%`;
      return {
        spec: {
          seed: `compare:${b}`,
          product: c.product,
          title: page === 'vs' ? t('vs.title', vars) : t('alt.title', vars),
          sub: page === 'vs' ? parity : [t('alt.titleDim', vars), parity].filter(Boolean).join(' '),
          url: siteUrl(`/compare/${b}`),
        },
      };
    }

    case 'page': {
      const locale = pickLocale(a);
      if (!b || !isStaticPageKey(b)) return null;
      if (b === 'home') return siteCard('home', locale);
      const { title, description } = await staticPageText(b, locale);
      return {
        spec: {
          seed: `page:${b}`,
          label: b === 'docs' || b === 'docsMcp' ? 'Docs' : undefined,
          title,
          sub: firstSentence(description),
          theme: PAPER_PAGES.has(b) ? 'paper' : 'ink',
          url: siteUrl(STATIC_PAGES[b].path),
        },
      };
    }

    // El board público de feedback (feedback.zerosoft.ai) y su roadmap.
    case 'feedback-board': {
      const locale = pickLocale(a);
      const t = await getTranslations({ locale, namespace: 'feedbackBoard' });
      const roadmap = b === 'roadmap';
      return {
        spec: {
          seed: `feedback-board:${roadmap ? 'roadmap' : 'index'}`,
          label: 'Feedback',
          title: t(roadmap ? 'meta.roadmapTitle' : 'meta.title'),
          sub: firstSentence(t(roadmap ? 'meta.roadmapDescription' : 'meta.description')),
          url: roadmap ? 'feedback.zerosoft.ai/roadmap' : 'feedback.zerosoft.ai',
        },
      };
    }

    default:
      return null;
  }
}

/** Color de la app de un ítem del board (si es una de las apps). */
export function productOf(value: string | null | undefined): ProductKey | undefined {
  return value && isProductKey(value) ? value : undefined;
}

export { PRODUCT_CONFIG };

import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { ogCard } from '@/lib/og-card';
import { getAllSlugs, getPost, productOfPost } from '@/lib/blog';
import { blogCoverSVG } from '@/lib/blog-cover';
import { findComparison } from '@/lib/compare';
import { PRODUCT_CONFIG, PRODUCT_KEYS, isProductKey, productNumber } from '@/lib/products';
import { getTool } from '@/lib/tools/registry';
import { CHANGELOG } from '@/content/changelog';
import { isSeoLocale } from '@/lib/seo';
import { isStaticPageKey, staticPageText } from '@/lib/seo-pages';

/**
 * Imágenes para compartir (PNG 1200×630) de todo el sitio público, en el
 * idioma de la página:
 *
 *   /api/og/product/<app>[/<locale>]
 *   /api/og/blog/<slug>            (inglés, URLs viejas)
 *   /api/og/blog/<locale>/<slug>
 *   /api/og/tool/<slug>[/<locale>]  ("hub" = /tools)
 *   /api/og/changelog[/<locale>]
 *   /api/og/compare/<locale>/<slug>
 *   /api/og/page/<locale>/<key>     (páginas fijas de lib/seo-pages.ts)
 *   /api/og/cover/<slug>           (la portada de un post, en SVG, para la página misma)
 *
 * El home y los ítems del board tienen su ruta propia (home/, board/).
 */

const notFound = () => new NextResponse('Not found', { status: 404 });

function pickLocale(value: string | undefined): string {
  return value && isSeoLocale(value) ? value : 'en';
}

export async function GET(_req: Request, props: { params: Promise<{ card: string[] }> }) {
  const { card } = await props.params;
  const [kind, a, b] = card;

  switch (kind) {
    // Portada de un post (SVG, lib/blog-cover.ts): determinística por slug, se cachea mucho.
    case 'cover': {
      const post = a ? getPost('en', a) : null;
      if (!a || !post || getAllSlugs().indexOf(a) < 0) return notFound();
      const product = productOfPost(post);
      return new NextResponse(blogCoverSVG(a, product ? PRODUCT_CONFIG[product].color : null), {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400',
        },
      });
    }

    case 'product': {
      if (!a || !isProductKey(a)) return notFound();
      const locale = pickLocale(b);
      const cfg = PRODUCT_CONFIG[a];
      const t = await getTranslations({ locale, namespace: 'pages' });
      const rival = t(`products.${a}.compare.rival` as never);
      return ogCard({
        seed: a,
        color: cfg.color,
        kicker: `zerosoft · ${productNumber(a)} / ${String(PRODUCT_KEYS.length).padStart(2, '0')}`,
        title: cfg.name,
        sub: t('product.alternative', { rival }),
      });
    }

    case 'blog': {
      const locale = b ? pickLocale(a) : 'en';
      const slug = b ?? a;
      if (!slug) return notFound();
      const post = getPost(locale, slug);
      if (!post) return notFound();
      const product = productOfPost(post);
      const t = await getTranslations({ locale, namespace: 'common.blog' });
      const color = product ? PRODUCT_CONFIG[product].color : undefined;
      return ogCard({
        seed: `blog:${slug}`,
        color,
        image: blogCoverSVG(slug, color),
        kicker: `zerosoft · ${t('label')} · ${post.readingTime} ${t('readingTime')}`,
        title: post.title,
      });
    }

    case 'tool': {
      if (!a) return notFound();
      const locale = pickLocale(b);
      const t = await getTranslations({ locale, namespace: 'tools' });
      if (a === 'hub') {
        return ogCard({ seed: 'tool:hub', kicker: `zerosoft · ${t('common.label' as never)}`, title: t('hub.metaTitle' as never) });
      }
      const tool = getTool(a);
      if (!tool) return notFound();
      return ogCard({
        seed: `tool:${a}`,
        color: PRODUCT_CONFIG[tool.accent].color,
        kicker: `zerosoft · ${t('common.free' as never)}`,
        title: t(`items.${a}.name` as never),
        sub: t(`items.${a}.short` as never),
      });
    }

    case 'changelog': {
      const locale = pickLocale(a);
      const t = await getTranslations({ locale, namespace: 'changelog' });
      const latest = CHANGELOG[0]?.date ?? '';
      return ogCard({ seed: 'changelog', kicker: latest ? `zerosoft · ${latest}` : 'zerosoft', title: t('metaTitle') });
    }

    case 'compare': {
      const locale = pickLocale(a);
      const found = b ? findComparison(b) : null;
      if (!found) return notFound();
      const { comparison: c, kind: page } = found;
      const t = await getTranslations({ locale, namespace: 'pages.compare' });
      const vars = { name: c.name, competitor: c.competitor };
      const parity = t('vs.glance.parity', vars);
      return ogCard({
        seed: c.product,
        color: PRODUCT_CONFIG[c.product].color,
        // Sin porcentaje público, sin porcentaje en la tarjeta.
        kicker: c.percentNote ? `zerosoft · ${c.competitor}` : `zerosoft · ${parity}: ${c.score.percent}%`,
        title: page === 'vs' ? t('vs.title', vars) : t('alt.title', vars),
        sub: page === 'vs' ? undefined : t('alt.titleDim', vars),
      });
    }

    case 'page': {
      const locale = pickLocale(a);
      if (!b || !isStaticPageKey(b)) return notFound();
      const { title } = await staticPageText(b, locale);
      return ogCard({ seed: `page:${b}`, kicker: 'zerosoft', title });
    }

    default:
      return notFound();
  }
}

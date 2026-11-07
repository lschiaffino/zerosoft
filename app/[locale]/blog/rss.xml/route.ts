import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { rssFeed } from '@/lib/blog-feed';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(_req: Request, props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  if (!(routing.locales as readonly string[]).includes(locale)) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  return new Response(rssFeed(locale, t('metaDescription')), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

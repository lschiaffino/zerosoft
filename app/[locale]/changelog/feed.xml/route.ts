import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { CHANGELOG, pick } from '@/content/changelog';

export const dynamic = 'force-static';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Feed Atom del changelog, uno por idioma (/en/changelog/feed.xml). */
export async function GET(_req: Request, props: { params: Promise<{ locale: string }> }) {
  const { locale: requested } = await props.params;
  const locale = routing.locales.includes(requested as never) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'changelog' });
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://zerosoft.ai').replace(/\/$/, '');
  const page = `${site}/${locale}/changelog`;
  const updated = CHANGELOG[0] ? `${CHANGELOG[0].date}T12:00:00Z` : new Date().toISOString();

  const entries = CHANGELOG.map((e) => {
    const list = e.items
      .map((i) => `<li><strong>${esc(t(`product.${i.product}`))}</strong> — ${esc(pick(i, locale))}</li>`)
      .join('');
    return `  <entry>
    <id>${page}#${e.id}</id>
    <title>${esc(pick(e.title, locale))}</title>
    <link href="${page}#${e.id}"/>
    <updated>${e.date}T12:00:00Z</updated>
    <content type="html">${esc(`<ul>${list}</ul>`)}</content>
  </entry>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${locale}">
  <id>${page}</id>
  <title>${esc(t('feedTitle'))}</title>
  <subtitle>${esc(t('metaDescription'))}</subtitle>
  <link href="${page}"/>
  <link rel="self" href="${page}/feed.xml"/>
  <updated>${updated}</updated>
  <author><name>zerosoft.ai</name></author>
${entries}
</feed>
`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

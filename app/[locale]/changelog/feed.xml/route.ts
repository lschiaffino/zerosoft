import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { pick } from '@/content/changelog';
import { getUnifiedChangelog } from '@/lib/changelog';
import { absoluteItemUrl } from '@/lib/board-urls';

// Repo + entradas publicadas desde el admin: se regenera cada 5 minutos (y al publicar).
export const revalidate = 300;

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
  const tp = await getTranslations({ locale, namespace: 'feedbackBoard.product' });
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://zerosoft.ai').replace(/\/$/, '');
  const page = `${site}/${locale}/changelog`;
  const changelog = await getUnifiedChangelog();
  const updated = changelog[0] ? `${changelog[0].date}T12:00:00Z` : new Date().toISOString();

  const entries = changelog
    .map((e) => {
      const list = e.items
        .map((i) => `<li><strong>${esc(tp(i.product))}</strong>: ${esc(pick(i, locale))}</li>`)
        .join('');
      const body = e.body ? pick(e.body, locale) : '';
      const closed = e.closed.length
        ? `<p>${esc(t('closedItems', { count: e.closed.length }))}</p><ul>${e.closed
            .map((c) => `<li><a href="${esc(absoluteItemUrl(locale, c.id, c.title))}">${esc(c.title)}</a></li>`)
            .join('')}</ul>`
        : '';
      const html = `${body}${list ? `<ul>${list}</ul>` : ''}${closed}`;
      return `  <entry>
    <id>${page}#${e.id}</id>
    <title>${esc(pick(e.title, locale))}</title>
    <link href="${page}#${e.id}"/>
    <updated>${e.date}T12:00:00Z</updated>
    <content type="html">${esc(html)}</content>
  </entry>`;
    })
    .join('\n');

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
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { getComparisons } from '@/lib/compare';
import { staticPageMetadata } from '@/lib/seo-pages';
import { breadcrumbLd, graphLd, jsonLdString, absoluteUrl, localePath } from '@/lib/seo';
import '@/styles/pages.css';
import '@/styles/compare.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return staticPageMetadata('compare', locale);
}

function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** /compare: cada app al lado del competidor de su tabla de paridad, con los links a las dos páginas. */
export default async function CompareIndexPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.compare' });
  const comparisons = getComparisons();

  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: t('crumb'), path: '/compare' },
    ]),
    {
      '@type': 'ItemList',
      name: t('index.meta.title'),
      itemListElement: comparisons.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: t('index.vsLink', { name: c.name, competitor: c.competitor }),
        url: absoluteUrl(localePath(locale, `/compare/${c.vsSlug}`)),
      })),
    },
  ]);

  return (
    <main className="container cmp-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <header className="read-hero">
        <h1 className="read-title">
          {t('index.title')} <span className="dim">{t('index.titleDim')}</span>
        </h1>
        <p className="read-intro">{t('index.lead')}</p>
      </header>

      <div className="read-body">
        <div className="table-wrap cmp-index-wrap">
          <table className="table cmp-index">
            <caption className="sr-only">{t('index.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('index.col.app')}</th>
                <th scope="col">{t('index.col.competitor')}</th>
                <th scope="col" className="num">
                  {t('index.col.parity')}
                </th>
                <th scope="col">{t('index.col.counts')}</th>
                <th scope="col">{t('index.col.reviewed')}</th>
                <th scope="col">{t('index.col.pages')}</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((c) => (
                <tr key={c.product}>
                  <th scope="row" className="cmp-app">
                    <Link href={`/products/${c.product}`}>
                      <ProductGlyph product={c.product} size={12} />
                      {c.name}
                    </Link>
                  </th>
                  <td className="cmp-cell" data-label={t('index.col.competitor')}>
                    {c.competitor}
                  </td>
                  <td className="num data cmp-cell" data-label={t('index.col.parity')}>
                    {`${c.score.percent}%`}
                  </td>
                  <td className="data cmp-cell" data-label={t('index.col.counts')}>
                    {`${c.score.have} · ${c.score.partial} · ${c.score.missing}`}
                  </td>
                  <td className="data cmp-cell" data-label={t('index.col.reviewed')}>
                    {formatDay(c.lastReviewed, locale)}
                  </td>
                  <td>
                    <div className="cmp-links">
                      <Link href={`/compare/${c.vsSlug}`}>{t('index.vsLink', { name: c.name, competitor: c.competitor })}</Link>
                      <Link href={`/compare/${c.altSlug}`}>{t('index.altLink', { name: c.name, competitor: c.competitor })}</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

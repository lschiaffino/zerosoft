import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { loc } from '@/lib/feature-parity';
import { PRODUCT_CONFIG, productHref } from '@/lib/products';
import { staticPageMetadata, staticPageText } from '@/lib/seo-pages';
import { absoluteUrl, breadcrumbLd, graphLd, jsonLdString, localePath } from '@/lib/seo';
import { DIRECTORY_PATH, DIRECTORY_REVIEWED, SOFTWARE_DIRECTORY, categoryPath } from '@/lib/software-directory';
import '@/styles/pages.css';
import '@/styles/compare.css';
import '@/styles/directory.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return staticPageMetadata('software', locale);
}

function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * /software: el directorio. Una fila por categoría con el software open source
 * (y su licencia), el pago y la app de zerosoft que hace lo mismo. Los datos
 * salen de content/software-directory.ts.
 */
export default async function SoftwareDirectoryPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.directory' });
  const seo = await staticPageText('software', locale);

  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: t('crumb'), path: DIRECTORY_PATH },
    ]),
    {
      '@type': 'CollectionPage',
      name: seo.title,
      description: seo.description,
      url: absoluteUrl(localePath(locale, DIRECTORY_PATH)),
      inLanguage: locale,
      dateModified: DIRECTORY_REVIEWED,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: SOFTWARE_DIRECTORY.length,
        itemListElement: SOFTWARE_DIRECTORY.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: loc(c.title, locale),
          url: absoluteUrl(localePath(locale, categoryPath(c.slug))),
        })),
      },
    },
  ]);

  return (
    <main className="cmp-page sd-page" data-testid="software-directory">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <div className="container">
        <header className="read-hero cmp-hero">
          <h1 className="read-title cmp-title">
            {t('title')} <span className="dim">{t('titleDim')}</span>
          </h1>
          <p className="read-intro">{t('lead', { count: SOFTWARE_DIRECTORY.length })}</p>
        </header>

        <div className="table-wrap sd-index-wrap">
          <table className="table sd-index">
            <caption className="sr-only">{t('caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('col.category')}</th>
                <th scope="col">{t('col.openSource')}</th>
                <th scope="col">{t('col.paid')}</th>
                <th scope="col">{t('col.zerosoft')}</th>
              </tr>
            </thead>
            <tbody>
              {SOFTWARE_DIRECTORY.map((c) => (
                <tr key={c.slug} data-testid="software-category-row">
                  <th scope="row" className="sd-cat">
                    <Link href={categoryPath(c.slug)} data-testid="software-category-link">
                      {loc(c.name, locale)}
                    </Link>
                  </th>
                  <td className="sd-cell" data-label={t('col.openSource')}>
                    <ul className="sd-names">
                      {c.openSource.map((p) => (
                        <li key={p.name}>
                          {p.name} <span className="sd-license">{p.license}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="sd-cell" data-label={t('col.paid')}>
                    <ul className="sd-names">
                      {c.paid.map((p) => (
                        <li key={p.name}>{p.name}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="sd-cell" data-label={t('col.zerosoft')}>
                    <ul className="sd-names sd-apps">
                      {c.apps.map((k) => (
                        <li key={k}>
                          <Link href={productHref(k)}>
                            <ProductGlyph product={k} size={11} />
                            {PRODUCT_CONFIG[k].name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cmp-note">{t('reviewed', { date: formatDay(DIRECTORY_REVIEWED, locale) })}</p>
        <p className="cmp-note">{t('scope')}</p>
      </div>
    </main>
  );
}

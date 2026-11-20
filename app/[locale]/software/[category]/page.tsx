import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import ProductGlyph from '@/components/brand/ProductGlyph';
import { comparisonFor } from '@/lib/compare';
import { loc } from '@/lib/feature-parity';
import { PRODUCT_CONFIG, isComingSoon, productHref } from '@/lib/products';
import { breadcrumbLd, graphLd, jsonLdString, pageMetadata } from '@/lib/seo';
import { SOFTWARE_DIRECTORY, categoryLd, categoryPath, categorySlugs, categoryVars, directoryCategory, type DirectoryProduct } from '@/lib/software-directory';
import { licenseUrl } from '@/content/software-directory';
import '@/styles/pages.css';
import '@/styles/compare.css';
import '@/styles/directory.css';

type Params = { locale: string; category: string };

export function generateStaticParams() {
  return categorySlugs().map((category) => ({ category }));
}

export const dynamicParams = false;

export async function generateMetadata(props: { params: Promise<Params> }) {
  const { locale, category: slug } = await props.params;
  const c = directoryCategory(slug);
  if (!c) return {};
  const t = await getTranslations({ locale, namespace: 'pages.directory.category' });
  const v = categoryVars(c, locale);
  return pageMetadata({
    locale,
    path: categoryPath(slug),
    title: t('metaTitle', v),
    description: t('metaDescription', v),
    image: `/api/og/software/${locale}/${slug}`,
  });
}

/**
 * /software/<categoría>: las apps de zerosoft de la categoría primero, después
 * el software open source (con licencia y código), el source-available y el
 * pago. Datos de content/software-directory.ts.
 */
export default async function SoftwareCategoryPage(props: { params: Promise<Params> }) {
  const { locale, category: slug } = await props.params;
  setRequestLocale(locale);
  const c = directoryCategory(slug);
  if (!c) notFound();
  const t = await getTranslations({ locale, namespace: 'pages.directory' });
  const tp = await getTranslations({ locale, namespace: 'pages' });
  const v = categoryVars(c, locale);
  const title = loc(c.title, locale);
  const appDescriptions = Object.fromEntries(c.apps.map((k) => [k, tp(`products.${k}.meta.description` as never)]));

  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: t('crumb'), path: '/software' },
      { name: v.name, path: categoryPath(c.slug) },
    ]),
    ...categoryLd(c, locale, { title: t('category.metaTitle', v), description: t('category.metaDescription', v), appDescriptions }),
  ]);

  const others = SOFTWARE_DIRECTORY.filter((o) => o.slug !== c.slug);
  const labels: TableLabels = {
    name: t('category.col.name'),
    license: t('category.col.license'),
    code: t('category.col.code'),
    sourceLink: t('category.sourceLink'),
    proprietary: t('category.proprietary'),
  };

  return (
    <main className="cmp-page sd-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <div className="container">
        <header className="read-hero cmp-hero">
          <nav className="pd-crumbs" aria-label={tp('product.crumbs')}>
            <Link href="/software">{t('crumb')}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{v.name}</span>
          </nav>
          <h1 className="read-title cmp-title">{title}</h1>
          <p className="read-intro">{loc(c.summary, locale)}</p>
          <p className="sd-lead">{t('category.lead', v)}</p>
        </header>

        <section className="cmp-section" aria-labelledby="sd-ours" data-testid="software-zerosoft">
          <h2 className="cmp-h2" id="sd-ours">
            {t('category.zerosoftTitle')}
          </h2>
          <div className="sd-ours">
            {c.apps.map((k) => {
              const cmp = comparisonFor(k);
              const soon = isComingSoon(k);
              return (
                <article key={k} className={`sd-our card-${k}`} data-testid="software-zerosoft-app">
                  <h3 className="sd-our-name">
                    <ProductGlyph product={k} size={16} />
                    zerosoft {PRODUCT_CONFIG[k].name}
                  </h3>
                  <p className="sd-our-desc">{appDescriptions[k]}</p>
                  {soon && <p className="cmp-note">{t('category.comingSoon')}</p>}
                  <ul className="sd-our-links">
                    <li>
                      <Link href={productHref(k)}>{t('category.productPage', { name: PRODUCT_CONFIG[k].name })}</Link>
                    </li>
                    <li>
                      <Link href={`/compare/${cmp.vsSlug}`}>{t('category.comparePage', { name: PRODUCT_CONFIG[k].name, competitor: cmp.competitor })}</Link>
                    </li>
                  </ul>
                </article>
              );
            })}
          </div>
        </section>

        <section className="cmp-section" aria-labelledby="sd-open" data-testid="software-open-source">
          <h2 className="cmp-h2" id="sd-open">
            {t('category.openTitle')} <span className="dim">{t('category.openDim', { count: c.openSource.length })}</span>
          </h2>
          <ProductTable items={c.openSource} caption={t('category.caption', { title, group: t('category.openTitle') })} labels={labels} kind="open" />
        </section>

        {c.sourceAvailable && c.sourceAvailable.length > 0 && (
          <section className="cmp-section" aria-labelledby="sd-source" data-testid="software-source-available">
            <h2 className="cmp-h2" id="sd-source">
              {t('category.sourceAvailableTitle')} <span className="dim">{t('category.sourceAvailableDim')}</span>
            </h2>
            <ProductTable items={c.sourceAvailable} caption={t('category.caption', { title, group: t('category.sourceAvailableTitle') })} labels={labels} kind="open" />
          </section>
        )}

        <section className="cmp-section" aria-labelledby="sd-paid" data-testid="software-paid">
          <h2 className="cmp-h2" id="sd-paid">
            {t('category.paidTitle')} <span className="dim">{t('category.paidDim')}</span>
          </h2>
          <ProductTable items={c.paid} caption={t('category.caption', { title, group: t('category.paidTitle') })} labels={labels} kind="paid" />
          <p className="cmp-note">{t('scope')}</p>
        </section>

        <section className="cmp-section cmp-last" aria-labelledby="sd-other">
          <h2 className="cmp-h2" id="sd-other">
            {t('category.others')}
          </h2>
          <ul className="cmp-other">
            {others.map((o) => (
              <li key={o.slug}>
                <Link href={categoryPath(o.slug)}>{loc(o.name, locale)}</Link>
              </li>
            ))}
            <li>
              <Link href="/software">{t('category.all')}</Link>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}

interface TableLabels {
  name: string;
  license: string;
  code: string;
  sourceLink: string;
  proprietary: string;
}

function ProductTable({ items, caption, labels, kind }: { items: DirectoryProduct[]; caption: string; labels: TableLabels; kind: 'open' | 'paid' }) {
  return (
    <div className="table-wrap">
      <table className="table sd-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.name}</th>
            <th scope="col">{labels.license}</th>
            {kind === 'open' && <th scope="col">{labels.code}</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const spdx = p.license ? licenseUrl(p.license) : null;
            return (
              <tr key={p.name} data-testid="software-entry">
                <th scope="row" className="sd-name">
                  <a href={p.url} rel="noopener">
                    {p.name}
                  </a>
                </th>
                <td className="sd-cell" data-label={labels.license}>
                  {kind === 'paid' ? labels.proprietary : spdx ? <a href={spdx}>{p.license}</a> : p.license}
                </td>
                {kind === 'open' && (
                  <td className="sd-cell" data-label={labels.code}>
                    {p.source ? (
                      <a href={p.source} rel="noopener" aria-label={`${labels.sourceLink}: ${p.name}`}>
                        {labels.sourceLink}
                      </a>
                    ) : null}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

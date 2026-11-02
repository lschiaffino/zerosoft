import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import Icon from '@/components/site/Icon';
import ProductGlyph from '@/components/brand/ProductGlyph';
import FeatureParity from '@/components/products/FeatureParity';
import { GITHUB_URL, PRODUCT_PAGES } from '@/components/site/catalog';
import { beyondRows, compareSlugs, findComparison, gapRows, getComparisons, rivalMatches, strongestRows, type Comparison } from '@/lib/compare';
import { loc } from '@/lib/feature-parity';
import { PRODUCT_CONFIG, isBuildingProduct, isProductKey } from '@/lib/products';
import { postsAbout } from '@/lib/blog';
import { breadcrumbLd, faqLd, graphLd, jsonLdString, pageMetadata, softwareLd, type FaqItem } from '@/lib/seo';
import '@/styles/pages.css';
import '@/styles/compare.css';

type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return compareSlugs().map((slug) => ({ slug }));
}

export const dynamicParams = false;

function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

function vars(c: Comparison, locale: string) {
  return {
    name: c.name,
    competitor: c.competitor,
    percent: c.score.percent,
    count: c.score.counted,
    have: c.score.have,
    partial: c.score.partial,
    missing: c.score.missing,
    date: formatDay(c.lastReviewed, locale),
  };
}

export async function generateMetadata(props: { params: Promise<Params> }) {
  const { locale, slug } = await props.params;
  const found = findComparison(slug);
  if (!found) return {};
  const t = await getTranslations({ locale, namespace: 'pages.compare' });
  const v = vars(found.comparison, locale);
  const key = found.kind === 'vs' ? 'vs' : 'alt';
  return pageMetadata({
    locale,
    path: `/compare/${slug}`,
    title: t(`${key}.metaTitle`, v),
    description: t(found.comparison.percentNote ? `${key}.metaDescriptionCounts` : `${key}.metaDescription`, v),
    image: `/api/og/compare/${locale}/${slug}`,
    absoluteTitle: true,
  });
}

/**
 * /compare/zerosoft-vs-<competidor> (la tabla completa) y
 * /compare/<competidor>-alternative (qué tenés, qué falta, cómo pasarte).
 * Todo sale de content/feature-parity y del copy de la página de producto.
 */
export default async function ComparePage(props: { params: Promise<Params> }) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const found = findComparison(slug);
  if (!found) notFound();
  const { kind, comparison: c } = found;
  const t = await getTranslations({ locale, namespace: 'pages.compare' });
  const tp = await getTranslations({ locale, namespace: 'pages' });
  const v = vars(c, locale);
  const cfg = PRODUCT_CONFIG[c.product];
  const p = `products.${c.product}`;
  const launch = isBuildingProduct(c.product) ? `/feedback-board/new?product=${c.product}` : cfg.launch;

  // Precio de lista: solo si la página de producto lo cita para este mismo competidor.
  const rival = tp(`${p}.compare.rival`);
  const sameRival = rivalMatches(c.competitor, rival);
  const price = sameRival && tp.has(`${p}.compare.price`) ? `${tp(`${p}.compare.price`)} ${tp(`${p}.compare.per`)}` : null;
  const priceNote = sameRival ? tp(`${p}.compare.note`) : null;

  // FAQ: la de la página de producto. En "alternative", las que nombran al competidor (migrar, qué falta).
  const allFaq: FaqItem[] = Array.from({ length: PRODUCT_PAGES[c.product].faqs }, (_, i) => ({
    q: tp(`${p}.faq.f${i + 1}.q`),
    a: tp(`${p}.faq.f${i + 1}.a`),
  }));
  const named = allFaq.filter((f) => f.q.toLowerCase().includes(c.competitor.toLowerCase()));
  const faq = kind === 'vs' ? allFaq : named.length > 0 ? named : allFaq.slice(0, 2);

  // Posts de la app o del competidor (tags "crm", "hubspot"); las palabras que son nombre de app no cuentan ("Wispr Flow").
  const competitorTags = c.slug.split('-').filter((w) => w.length > 3 && !isProductKey(w));
  const posts = postsAbout(locale, [c.product, c.slug, ...competitorTags], 4);
  const others = getComparisons().filter((o) => o.product !== c.product && PRODUCT_CONFIG[o.product].category === cfg.category);
  const selfPath = `/compare/${slug}`;
  const title = kind === 'vs' ? t('vs.title', v) : t('alt.title', v);

  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: t('crumb'), path: '/compare' },
      { name: title, path: selfPath },
    ]),
    softwareLd({
      locale,
      name: `zerosoft ${cfg.name}`,
      description: tp(`${p}.meta.description`),
      path: `/products/${c.product}`,
      image: `/api/og/product/${c.product}/${locale}`,
    }),
    ...(faq.length ? [faqLd(faq)] : []),
  ]);

  return (
    <main className={`cmp-page card-${c.product}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <div className="container">
        <header className="read-hero cmp-hero">
          <nav className="pd-crumbs" aria-label={tp('product.crumbs')}>
            <Link href="/compare">{t('crumb')}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{title}</span>
          </nav>
          <h1 className="read-title cmp-title">
            {kind === 'vs' ? (
              <>
                <span className="cmp-glyph" aria-hidden="true">
                  <ProductGlyph product={c.product} size={20} />
                </span>
                {title}
              </>
            ) : (
              <>
                {title} <span className="dim">{t('alt.titleDim', v)}</span>
              </>
            )}
          </h1>
          <p className="read-intro">{t(c.percentNote ? (kind === 'vs' ? 'vs.leadCounts' : 'alt.leadCounts') : kind === 'vs' ? 'vs.lead' : 'alt.lead', v)}</p>
          {c.percentNote && <p className="cmp-scope-note">{loc(c.percentNote, locale)}</p>}
          <div className="read-actions">
            <Link className="btn btn-primary" href={launch}>
              {t('tryCta', v)}
            </Link>
            {kind === 'vs' ? (
              <Link className="btn btn-secondary" href={`/compare/${c.altSlug}`}>
                {t('vs.altCta', v)}
              </Link>
            ) : (
              <Link className="btn btn-secondary" href={`/compare/${c.vsSlug}`}>
                {t('alt.vsCta')}
              </Link>
            )}
            <a className="btn btn-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={15} /> {tp('product.selfHost')}
            </a>
          </div>
        </header>
      </div>

      {kind === 'vs' ? (
        <>
          <section className="container cmp-section" aria-labelledby="cmp-glance">
            <h2 className="cmp-h2" id="cmp-glance">
              {t('vs.glanceTitle')}
            </h2>
            <dl className="cmp-glance">
              <div>
                <dt>{c.percentNote ? t('vs.glance.counts') : t('vs.glance.parity', v)}</dt>
                <dd className="data">{c.percentNote ? `${c.score.have} · ${c.score.partial} · ${c.score.missing}` : `${c.score.percent}%`}</dd>
              </div>
              {price && (
                <div>
                  <dt>{t('vs.glance.price', v)}</dt>
                  <dd>{price}</dd>
                </div>
              )}
              <div>
                <dt>{t('vs.glance.ours', v)}</dt>
                <dd>{t('vs.glance.oursValue')}</dd>
              </div>
              <div>
                <dt>{t('vs.glance.license', v)}</dt>
                <dd>{t('vs.glance.licenseValue')}</dd>
              </div>
              <div>
                <dt>{t('vs.glance.reviewed')}</dt>
                <dd>{v.date}</dd>
              </div>
            </dl>
            {priceNote && <p className="cmp-note">{priceNote}</p>}
          </section>

          <section className="lp-section pd-parity cmp-parity" aria-labelledby="cmp-table">
            <div className="container">
              <h2 className="cmp-h2" id="cmp-table">
                {t('vs.tableTitle')} <span className="dim">{t('vs.tableTitleDim')}</span>
              </h2>
            </div>
            <FeatureParity locale={locale} product={c.product} headingId="cmp-table" />
          </section>
        </>
      ) : (
        <>
          <section className="container cmp-section" aria-labelledby="cmp-get">
            <h2 className="cmp-h2" id="cmp-get">
              {t('alt.getTitle')}
            </h2>
            <ul className="cmp-list">
              {strongestRows(c.product).map((r) => (
                <li key={r.id}>
                  <strong>{loc(r.label, locale)}</strong>
                  {r.detail && <span>{loc(r.detail, locale)}</span>}
                </li>
              ))}
            </ul>
          </section>

          {beyondRows(c.product).length > 0 && (
            <section className="container cmp-section" aria-labelledby="cmp-beyond">
              <h2 className="cmp-h2" id="cmp-beyond">
                {t('alt.beyondTitle', v)}
              </h2>
              <ul className="cmp-list">
                {beyondRows(c.product).map((r) => (
                  <li key={r.id}>
                    <strong>{loc(r.label, locale)}</strong>
                    {r.detail && <span>{loc(r.detail, locale)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="container cmp-section" aria-labelledby="cmp-gaps">
            <h2 className="cmp-h2" id="cmp-gaps">
              {t('alt.gapsTitle')}
            </h2>
            {gapRows(c.product).length === 0 ? (
              <p className="cmp-note">{t('alt.gapsNone', v)}</p>
            ) : (
              <>
                <p className="cmp-note">{t('alt.gapsLead', v)}</p>
                <ul className="cmp-list">
                  {gapRows(c.product).map((r) => (
                    <li key={r.id}>
                      <strong>
                        {loc(r.label, locale)} <span className="cmp-tag data">{r.status === 'partial' ? t('alt.partial') : t('alt.missing')}</span>
                      </strong>
                      {r.detail && <span>{loc(r.detail, locale)}</span>}
                    </li>
                  ))}
                </ul>
                <p>
                  <Link href={{ pathname: '/feedback-board', query: { product: c.product } }} className="parity-link">
                    {tp('product.parity.vote')} <Icon name="arrow" size={14} />
                  </Link>
                </p>
              </>
            )}
          </section>

          {priceNote && (
            <section className="container cmp-section" aria-labelledby="cmp-price">
              <h2 className="cmp-h2" id="cmp-price">
                {t('alt.priceTitle')}
              </h2>
              <p className="cmp-prose">{priceNote}</p>
              <p className="cmp-prose">{t('vs.glance.oursValue')}</p>
            </section>
          )}
        </>
      )}

      {faq.length > 0 && (
        <section className="container cmp-section" aria-labelledby="cmp-faq">
          <h2 className="cmp-h2" id="cmp-faq">
            {kind === 'alternative' ? t('alt.moveTitle', v) : t('faqTitle')}
          </h2>
          <div className="faq">
            {faq.map((f) => (
              <details className="faq-item" key={f.q} open={kind === 'alternative'}>
                <summary>
                  {f.q}
                  <span className="faq-plus" aria-hidden="true" />
                </summary>
                <p className="faq-a">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {posts.length > 0 && (
        <section className="container cmp-section" aria-labelledby="cmp-posts">
          <h2 className="cmp-h2" id="cmp-posts">
            {t('relatedTitle')}
          </h2>
          <ul className="cmp-posts">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                <span>{post.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="container cmp-section cmp-last" aria-labelledby="cmp-other">
        <h2 className="cmp-h2" id="cmp-other">
          {t('otherTitle')}
        </h2>
        <ul className="cmp-other">
          <li>
            <Link href={`/products/${c.product}`}>{t('productCta', v)}</Link>
          </li>
          <li>
            <Link href={kind === 'vs' ? `/compare/${c.altSlug}` : `/compare/${c.vsSlug}`}>
              {kind === 'vs' ? t('index.altLink', v) : t('index.vsLink', v)}
            </Link>
          </li>
          {others.map((o) => (
            <li key={o.product}>
              <Link href={`/compare/${kind === 'vs' ? o.vsSlug : o.altSlug}`}>
                {kind === 'vs' ? t('index.vsLink', { name: o.name, competitor: o.competitor }) : t('index.altLink', { name: o.name, competitor: o.competitor })}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/compare">{t('index.meta.title')}</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}

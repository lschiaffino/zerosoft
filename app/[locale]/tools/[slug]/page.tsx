import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import Icon from '@/components/site/Icon';
import ToolComponent from '@/components/tools/ToolComponent';
import { PRODUCT_NAMES } from '@/components/site/catalog';
import { getTool, jsonLd, localizedAlternates, relatedTools, siteUrl, TOOLS } from '@/lib/tools/registry';
import '@/styles/tools.css';

type Params = { locale: string; slug: string };

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: { params: Promise<Params> }) {
  const { locale, slug } = await props.params;
  const tool = getTool(slug);
  if (!tool) return {};
  const t = await getTranslations({ locale, namespace: `tools.items.${slug}` });
  const title = t('metaTitle');
  const description = t('metaDescription');
  const image = `/api/og/tool/${slug}`;
  return {
    title,
    description,
    alternates: localizedAlternates(`/tools/${slug}`, locale),
    openGraph: { title, description, type: 'website', url: `/${locale}/tools/${slug}`, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

interface Faq {
  q: string;
  a: string;
}

export default async function ToolPage(props: { params: Promise<Params> }) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const tool = getTool(slug);
  if (!tool) notFound();
  const t = await getTranslations({ locale, namespace: 'tools' });
  const item = (k: string) => t(`items.${slug}.${k}`);
  const faq = t.raw(`items.${slug}.faq`) as Faq[];
  const base = siteUrl();
  const url = `${base}/${locale}/tools/${slug}`;
  const kind = tool.ai ? 'ai' : tool.server ? 'server' : 'local';

  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: item('name'),
      description: item('metaDescription'),
      url,
      inLanguage: locale,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@type': 'Organization', name: 'zerosoft', url: base },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t('common.label'), item: `${base}/${locale}/tools` },
        { '@type': 'ListItem', position: 2, name: item('name'), item: url },
      ],
    },
  ];

  const productHref = tool.product ? `/products/${tool.product}` : '/products';
  const productName = tool.product ? PRODUCT_NAMES[tool.product] : 'zerosoft';

  return (
    <main className={`tool-page card-${tool.accent}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <section className="tool-hero container">
        <nav className="tool-crumbs" aria-label={t('common.label')}>
          <Link href="/tools">{t('common.label')}</Link>
          <span aria-hidden="true">/</span>
          <span>{t(`hub.groups.${tool.group}.title`)}</span>
        </nav>
        <h1 className="tool-title">{item('title')}</h1>
        <p className="tool-sub">{item('sub')}</p>
        <p className="tool-meta">
          <span>{t('common.free')}</span>
          <span>{t(`common.kind.${kind}`)}</span>
        </p>
      </section>

      <section className="tool-body container">
        <ToolComponent slug={slug} />
      </section>

      <section className="tool-cta container">
        <div className="tool-cta-inner">
          <div>
            <h2>{item('ctaTitle')}</h2>
            <p>{item('ctaBody')}</p>
          </div>
          <div className="tool-cta-actions">
            <Link className="btn btn-primary" href="/app">
              {t('common.saveInZerosoft')}
            </Link>
            <Link className="lp-textlink" href={productHref}>
              {t('common.seeProduct', { product: productName })} <Icon name="arrow" size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="tool-faq container">
        <h2 className="tool-h2">{t('common.faqTitle')}</h2>
        <div className="tool-faq-list">
          {faq.map((f) => (
            <details key={f.q} className="tool-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="tool-related container">
        <h2 className="tool-h2">{t('common.relatedTitle')}</h2>
        <ul className="tools-rows">
          {relatedTools(slug).map((r) => (
            <li key={r.slug} className={`tools-row card-${r.accent}`}>
              <Link href={`/tools/${r.slug}`} className="tools-row-link tools-row-compact">
                <span className="tools-name">{t(`items.${r.slug}.name`)}</span>
                <span className="tools-line">{t(`items.${r.slug}.short`)}</span>
                <Icon name="arrow" size={16} />
              </Link>
            </li>
          ))}
        </ul>
        <p className="tool-all">
          <Link className="lp-textlink" href="/tools">
            {t('common.allTools')} <Icon name="arrow" size={14} />
          </Link>
        </p>
      </section>
    </main>
  );
}

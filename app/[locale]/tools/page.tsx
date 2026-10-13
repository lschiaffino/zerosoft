import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import Reveal from '@/components/Reveal';
import ZeroField from '@/components/ZeroField';
import Icon from '@/components/site/Icon';
import { jsonLd, localizedAlternates, siteUrl, TOOL_GROUPS, TOOLS, type ToolDef } from '@/lib/tools/registry';
import '@/styles/pages.css';
import '@/styles/tools.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'tools.hub' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  return {
    title,
    description,
    alternates: localizedAlternates('/tools', locale),
    openGraph: { title, description, type: 'website', url: `/${locale}/tools`, images: ['/api/og/tool/hub'] },
    twitter: { card: 'summary_large_image', title, description, images: ['/api/og/tool/hub'] },
  };
}

function kindKey(tool: ToolDef): 'ai' | 'server' | 'local' {
  return tool.ai ? 'ai' : tool.server ? 'server' : 'local';
}

export default async function ToolsHubPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'tools' });
  const base = siteUrl();

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('hub.metaTitle'),
    description: t('hub.metaDescription'),
    url: `${base}/${locale}/tools`,
    inLanguage: locale,
    hasPart: TOOLS.map((tool) => ({
      '@type': 'SoftwareApplication',
      name: t(`items.${tool.slug}.name`),
      url: `${base}/${locale}/tools/${tool.slug}`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    })),
  };

  let n = 0;
  return (
    <main className="tools-hub">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <section className="page-hero page-hero--fade">
        <ZeroField align="right" sizeFactor={0.9} />
        <div className="container">
          <p className="section-label">{t('hub.label')}</p>
          <h1 className="page-hero-title tools-hero-title">
            {t('hub.title1')}
            <br />
            <span className="dim">{t('hub.title2')}</span>
          </h1>
          <p className="page-hero-sub">{t('hub.sub')}</p>
        </div>
      </section>

      <section className="container tools-groups">
        {TOOL_GROUPS.map((g) => {
          const items = TOOLS.filter((tool) => tool.group === g);
          return (
            <Reveal as="section" key={g} className="tools-group" aria-labelledby={`tools-${g}`}>
              <header className="tools-group-head">
                <h2 id={`tools-${g}`}>{t(`hub.groups.${g}.title`)}</h2>
                <p>{t(`hub.groups.${g}.desc`)}</p>
              </header>
              <ul className="tools-rows">
                {items.map((tool) => {
                  n += 1;
                  return (
                    <li key={tool.slug} className={`tools-row card-${tool.accent}`}>
                      <Link href={`/tools/${tool.slug}`} className="tools-row-link">
                        <span className="tools-num">{String(n).padStart(2, '0')}</span>
                        <span className="tools-name">{t(`items.${tool.slug}.name`)}</span>
                        <span className="tools-line">{t(`items.${tool.slug}.short`)}</span>
                        <span className="tools-kind">{t(`common.kind.${kindKey(tool)}`)}</span>
                        <Icon name="arrow" size={16} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Reveal>
          );
        })}
        <div className="tools-foot">
          <p>
            <strong>{t('hub.footTitle')}</strong> {t('hub.footBody')}
          </p>
          <Link className="lp-textlink" href="/app">
            {t('common.startFree')} <Icon name="arrow" size={14} />
          </Link>
        </div>
      </section>
    </main>
  );
}

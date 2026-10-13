import type { CSSProperties } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import RoadmapVote from '@/components/RoadmapVote';
import { listPublicRoadmap, ROADMAP_PRODUCT_COLOR, ROADMAP_PUBLIC_COLUMNS } from '@/lib/roadmap';
import '@/styles/pages.css';
import '@/styles/roadmap.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'roadmap' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/roadmap` },
    openGraph: { title, description, type: 'website', url: `/${locale}/roadmap` },
  };
}

/** Roadmap público: solo ítems aprobados (is_public) en planeado / en curso / hecho. */
export default async function RoadmapPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'roadmap' });
  const columns = await listPublicRoadmap();

  return (
    <main className="rm-main">
      <div className="doc-hero container">
        <p className="section-label">{t('label')}</p>
        <h1 className="doc-title">
          {t('title')}
          <br />
          <span className="dim">{t('titleDim')}</span>
        </h1>
        <p className="doc-intro">{t('intro')}</p>
        <div className="rm-hero-actions">
          <Link className="btn btn-solid btn-small" href="/feedback">
            {t('suggest')}
          </Link>
          <Link className="btn btn-ghost btn-small" href="/changelog">
            {t('changelog')}
          </Link>
        </div>
      </div>

      <div className="container">
        <div className="rm-board">
          {ROADMAP_PUBLIC_COLUMNS.map((col) => (
            <section key={col} className={`rm-col rm-col-${col}`} aria-labelledby={`rm-${col}`}>
              <header className="rm-col-head">
                <h2 id={`rm-${col}`}>{t(`column.${col}`)}</h2>
                <span className="rm-col-count mono">{columns[col].length}</span>
              </header>
              {columns[col].length === 0 ? (
                <p className="rm-empty">{t('columnEmpty')}</p>
              ) : (
                <ul className="rm-list">
                  {columns[col].map((item) => (
                    <li
                      key={item.id}
                      className="rm-item"
                      style={{ '--dot': ROADMAP_PRODUCT_COLOR[item.product] ?? 'var(--dim)' } as CSSProperties}
                    >
                      <div className="rm-item-body">
                        <p className="rm-meta mono">
                          <i aria-hidden="true" />
                          {t(`product.${item.product}`)}
                          <span className="rm-sep" aria-hidden="true">·</span>
                          {t(`kind.${item.kind}`)}
                        </p>
                        <h3 className="rm-title">{item.title}</h3>
                        {item.description && <p className="rm-desc">{item.description}</p>}
                        {col === 'done' && item.shipped_changelog_id && (
                          <Link className="rm-shipped" href={`/changelog#${item.shipped_changelog_id}`}>
                            {t('shipped')}
                          </Link>
                        )}
                      </div>
                      {col === 'done' ? (
                        <span className="rm-votes-static mono">{t('votes', { count: item.votes })}</span>
                      ) : (
                        <RoadmapVote
                          id={item.id}
                          votes={item.votes}
                          labels={{ upvote: t('upvote'), voted: t('voted'), error: t('voteError') }}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="rm-cta">
          <div>
            <p className="rm-cta-title">{t('ctaTitle')}</p>
            <p className="rm-cta-body">{t('ctaBody')}</p>
          </div>
          <Link className="btn btn-solid" href="/feedback">
            {t('ctaButton')}
          </Link>
        </div>
      </div>
    </main>
  );
}

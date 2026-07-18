import { getTranslations, setRequestLocale } from 'next-intl/server';
import Reveal from '@/components/Reveal';
import '@/styles/pages.css';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'pages.status' });
  return { title: t('meta.title'), description: t('meta.description') };
}

const COMPONENTS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;
const DAYS = 30;

export default async function StatusPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.status' });

  return (
    <main>
      {/* HERO */}
      <section className="doc-hero container">
        <p className="section-label">{t('label')}</p>
        <div className="status-line">
          <span className="status-dot" aria-hidden="true" />
          <h1 className="doc-title">{t('title')}</h1>
        </div>
        <p className="doc-intro">{t('sub')}</p>
        <p className="doc-updated">{t('updated')}</p>
      </section>

      {/* COMPONENTS */}
      <section className="container" style={{ paddingTop: 0, paddingBottom: 90 }}>
        <p className="section-label">{t('componentsLabel')}</p>
        <Reveal className="status-rows">
          {COMPONENTS.map((c) => (
            <div className="status-row" key={c}>
              <span className="status-name">{t(`${c}`)}</span>
              <span
                className="uptime"
                role="img"
                aria-label={`${t(`${c}`)} — ${t('uptimeValue')} ${t('uptimeDays')}`}
              >
                {Array.from({ length: DAYS }).map((_, i) => (
                  <i key={i} title={t('uptimeDay', { day: i + 1 })} />
                ))}
              </span>
              <span className="status-val">{t('uptimeValue')}</span>
            </div>
          ))}
        </Reveal>
        <p className="status-note">
          {t('uptimeValue')} · {t('uptimeDays')} · {t('operational')}
        </p>
      </section>

      {/* INCIDENTS */}
      <section className="container" style={{ paddingTop: 0 }}>
        <p className="section-label">{t('incidentsLabel')}</p>
        <Reveal className="incident">
          <div className="incident-top">
            <h3 className="incident-title">{t('incident.title')}</h3>
            <span className="incident-date">{t('incident.date')}</span>
          </div>
          <p>{t('incident.body')}</p>
          <span className="incident-state">
            {t('incident.state')} · {t('incident.duration')}
          </span>
        </Reveal>
        <p className="status-note">{t('none')}</p>
      </section>
    </main>
  );
}

import { getTranslations, setRequestLocale } from 'next-intl/server';
import '@/styles/pages.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const t = await getTranslations({ locale, namespace: 'pages.status' });
  return { title: t('meta.title'), description: t('meta.description') };
}

const SERVICES = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const;

/**
 * Honest status page: the services that make up zerosoft.ai and a note that
 * live monitoring is not wired up yet. No uptime numbers or incidents until
 * there is real data behind them.
 */
export default async function StatusPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.status' });

  return (
    <main>
      {/* HERO */}
      <section className="doc-hero container">
        <h1 className="doc-title">{t('title')}</h1>
        <p className="doc-intro">{t('sub')}</p>
      </section>

      {/* SERVICES */}
      <section className="container" style={{ paddingTop: 0, paddingBottom: 90 }}>
        <div className="status-rows">
          {SERVICES.map((s) => (
            <div className="status-row" key={s}>
              <span className="status-name">{t(`${s}.name`)}</span>
              <span className="status-note" style={{ marginTop: 0 }}>
                {t(`${s}.desc`)}
              </span>
              <span className="status-val" style={{ color: 'var(--dim)' }}>
                {t('noData')}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* MONITORING */}
      <section className="container" style={{ paddingTop: 0 }}>
        <div className="incident">
          <div className="incident-top">
            <h3 className="incident-title">{t('monitoringTitle')}</h3>
          </div>
          <p>{t('monitoringBody')}</p>
        </div>
        <p className="status-note">{t('contact')}</p>
      </section>
    </main>
  );
}

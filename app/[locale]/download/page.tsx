import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import DownloadButtons from '@/components/site/DownloadButtons';
import { desktopDownloads, latestDesktopRelease } from '@/lib/desktop-release';
import { GITHUB_URL } from '@/components/site/catalog';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'pages.download' });
  return { title: t('meta.title'), description: t('meta.description') };
}

// Se arma en cada pedido: el release sale del data cache (10 min, lib/desktop-release.ts), no del build.
export const dynamic = 'force-dynamic';

const FEATURES = ['f1', 'f2', 'f3', 'f4'] as const;

/**
 * /download: la app de escritorio (desktop/, Electron) para Mac y Windows.
 * Los links salen del último release desktop-v* de GitHub; el botón grande
 * es el del sistema de quien mira (DownloadButtons). Mientras no haya firma
 * ni notarización, la página lo dice y explica cómo abrirla.
 */
export default async function DownloadPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.download' });
  const release = await latestDesktopRelease();
  const dl = release ? desktopDownloads(release) : null;
  const date = dl?.publishedAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(dl.publishedAt)) : null;

  return (
    <main className="container">
      <header className="read-hero">
        <h1 className="read-title">{t('title')}</h1>
        <p className="read-intro">{t('sub')}</p>
        {dl ? (
          <>
            <DownloadButtons
              links={{ macArm64: dl.macArm64, macX64: dl.macX64, win: dl.win }}
              labels={{ macArm: t('macArm'), macIntel: t('macIntel'), win: t('win'), otherMac: t('otherMac'), otherArm: t('otherArm') }}
            />
            <p className="read-meta">
              {date ? t('versionLine', { version: dl.version, date }) : null}{' '}
              <a href={dl.pageUrl} target="_blank" rel="noreferrer">
                {t('allFiles', { version: dl.version })}
              </a>
            </p>
          </>
        ) : (
          <>
            <p className="read-meta dl-empty" data-testid="download-empty">
              {t('noRelease')}
            </p>
            <div className="read-actions">
              <a className="btn btn-primary" href={`${GITHUB_URL}/tree/main/desktop`} target="_blank" rel="noreferrer">
                {t('source')}
              </a>
              <Link className="btn btn-secondary" href="/app">
                {t('openApp')}
              </Link>
            </div>
          </>
        )}
      </header>

      <div className="read-body dl-body">
        <section className="status-note-block dl-unsigned" aria-labelledby="dl-unsigned">
          <h2 id="dl-unsigned">{t('unsignedTitle')}</h2>
          <p>{t('unsignedMac')}</p>
          <p>{t('unsignedWin')}</p>
          <p>{t('unsignedUpdates')}</p>
        </section>

        <section className="dl-section" aria-labelledby="dl-features">
          <h2 id="dl-features" className="dl-h2">
            {t('featuresTitle')}
          </h2>
          <ul className="status-rows">
            {FEATURES.map((k) => (
              <li className="dl-row" key={k}>
                <span className="status-name">{t(`${k}t`)}</span>
                <span className="status-desc">{t(`${k}d`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dl-section" aria-labelledby="dl-req">
          <h2 id="dl-req" className="dl-h2">
            {t('reqTitle')}
          </h2>
          <ul className="status-rows">
            <li className="dl-row">
              <span className="status-name">macOS</span>
              <span className="status-desc">{t('reqMac')}</span>
            </li>
            <li className="dl-row">
              <span className="status-name">Windows</span>
              <span className="status-desc">{t('reqWin')}</span>
            </li>
          </ul>
        </section>

        <section className="dl-section" aria-labelledby="dl-mobile">
          <h2 id="dl-mobile" className="dl-h2">
            {t('mobileTitle')}
          </h2>
          <p className="status-desc dl-p">{t('mobileBody')}</p>
        </section>
      </div>
    </main>
  );
}

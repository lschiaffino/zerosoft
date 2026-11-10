import { getTranslations, setRequestLocale } from 'next-intl/server';
import { staticPageMetadata } from '@/lib/seo-pages';
import { Link } from '@/i18n/navigation';
import DesktopDownload from '@/components/desktop/DesktopDownload';
import { desktopReleaseForClient } from '@/lib/desktop-release';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return staticPageMetadata('download', locale);
}

// Se arma en cada pedido: el release sale del data cache (10 min, lib/desktop-release.ts), no del build.
export const dynamic = 'force-dynamic';

const FEATURES = ['f1', 'f5', 'f2', 'f3', 'f4'] as const;
/** Apps que andan sin conexión (nombre propio, o null: el título sale de `${key}T`). */
const OFFLINE_APPS = [
  ['CRM', 'offCrm'],
  ['Docs', 'offDocs'],
  ['Notes', 'offNotes'],
  ['Track', 'offTrack'],
  [null, 'offOther'],
  [null, 'offPrivacy'],
] as const;

/**
 * /download: la app de escritorio (desktop/, Tauri) para Mac y Windows.
 * El instalador sale del último release desktop-v* de GitHub (resuelto en el
 * servidor, con caché); DesktopDownload detecta sistema y chip, deja elegir a
 * mano y explica cómo abrir una build sin firmar. Lo mismo se ve en
 * /app/download y en el onboarding.
 */
export default async function DownloadPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.download' });
  const release = await desktopReleaseForClient();

  return (
    <main className="container">
      <header className="read-hero">
        <h1 className="read-title">{t('title')}</h1>
        <p className="read-intro">{t('sub')}</p>
        <div className="dl-widget">
          <DesktopDownload release={release} variant="page" from="download" />
        </div>
        {!release && (
          <div className="read-actions">
            <Link className="btn btn-secondary" href="/app">
              {t('openApp')}
            </Link>
          </div>
        )}
      </header>

      <div className="read-body dl-body">
        <section className="status-note-block dl-unsigned" aria-labelledby="dl-unsigned">
          <h2 id="dl-unsigned">{t('unsignedTitle')}</h2>
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
            <li className="dl-row" data-testid="download-linux">
              <span className="status-name">Linux</span>
              <span className="status-desc">{t('reqLinux')}</span>
            </li>
          </ul>
        </section>

        <section className="dl-section" aria-labelledby="dl-mobile">
          <h2 id="dl-mobile" className="dl-h2">
            {t('mobileTitle')}
          </h2>
          <p className="status-desc dl-p">{t('mobileBody')}</p>
        </section>

        {/* Qué anda sin red (lo enlaza la barra de estado de la app: components/app/OfflineStatus.tsx). */}
        <section className="dl-section" id="offline" aria-labelledby="dl-offline">
          <h2 id="dl-offline" className="dl-h2">
            {t('offlineTitle')}
          </h2>
          <p className="status-desc dl-p">{t('offlineLead')}</p>
          <ul className="status-rows">
            {OFFLINE_APPS.map(([name, key]) => (
              <li className="dl-row" key={key}>
                <span className="status-name">{name ?? t(`${key}T`)}</span>
                <span className="status-desc">{t(key)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

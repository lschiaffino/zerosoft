import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { desktopDownloads, latestDesktopRelease } from '@/lib/desktop-release';
import { isDesktopOs, type DesktopOs } from '@/lib/desktop-os';
import AutoDownload from '@/components/site/AutoDownload';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'pages.download.start' });
  return { title: t('metaTitle'), robots: { index: false, follow: true } };
}

const STEPS: Record<DesktopOs, readonly string[]> = {
  'mac-arm': ['macOpen', 'macGatekeeper', 'signIn', 'macDictate'],
  'mac-intel': ['macOpen', 'macGatekeeper', 'signIn', 'macDictate'],
  win: ['winOpen', 'winSmartScreen', 'signIn', 'winDictate'],
};

/**
 * /download/start?os=…: a donde llevan los botones de descarga (después de
 * contar el clic en /api/desktop/download). Arranca la descarga del instalador
 * de ese sistema y muestra cómo instalarlo y abrirlo la primera vez.
 */
export default async function DownloadStartPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.download.start' });
  const rawOs = (await props.searchParams).os;
  const os: DesktopOs | null = isDesktopOs(rawOs) ? rawOs : null;
  const release = os ? await latestDesktopRelease() : null;
  const dl = release ? desktopDownloads(release) : null;
  const file = os && dl ? (os === 'win' ? dl.win : os === 'mac-intel' ? dl.macX64 : dl.macArm64) : null;

  if (!os || !file || !dl) {
    return (
      <main className="container">
        <header className="read-hero">
          <h1 className="read-title">{t('missingTitle')}</h1>
          <p className="read-intro">{t('missingBody')}</p>
          <div className="read-actions">
            <Link className="btn btn-primary" href="/download">
              {t('allDownloads')}
            </Link>
          </div>
        </header>
      </main>
    );
  }

  const fileName = decodeURIComponent(file.split('/').pop() ?? '');
  const system = t(`system.${os}`);
  // En los e2e el release es falso (DESKTOP_RELEASES_FAKE): la descarga no arranca sola para no salir a GitHub.
  const autoStart = process.env.DESKTOP_RELEASES_FAKE !== '1';

  return (
    <main className="container">
      <header className="read-hero dl-start-hero">
        <p className="dl-start-kicker">{t('kicker', { version: dl.version })}</p>
        <h1 className="read-title">{t('title', { system })}</h1>
        <p className="read-intro">
          {t.rich('sub', {
            file: () => <span className="data">{fileName}</span>,
            again: (chunks) => (
              <a href={file} data-testid="download-again">
                {chunks}
              </a>
            ),
          })}
        </p>
        <AutoDownload href={file} enabled={autoStart} />
      </header>

      <div className="read-body dl-body">
        <section className="dl-section" aria-labelledby="dl-steps">
          <h2 id="dl-steps" className="dl-h2">
            {t('stepsTitle')}
          </h2>
          <ol className="dl-steps" data-testid="install-steps">
            {STEPS[os].map((k, i) => (
              <li key={k} className="dl-step">
                <span className="dl-step-n data" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="dl-step-body">
                  <span className="status-name">{t(`steps.${k}.t`)}</span>
                  <span className="status-desc">{t(`steps.${k}.d`, { file: fileName })}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <p className="status-desc dl-p">
          {os.startsWith('mac') && (
            <>
              <a href={(os === 'mac-arm' ? dl.macX64 : dl.macArm64) ?? '/download'}>{t(os === 'mac-arm' ? 'otherIntel' : 'otherArm')}</a>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <Link href="/download">{t('allDownloads')}</Link>
        </p>
      </div>
    </main>
  );
}

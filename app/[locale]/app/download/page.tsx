import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getProfile } from '@/lib/onboarding';
import { desktopReleaseForClient } from '@/lib/desktop-release';
import PageHeader from '@/components/ui/PageHeader';
import DesktopDownload, { DesktopFeatures } from '@/components/desktop/DesktopDownload';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings.welcome.desktop' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * /app/download: la app de escritorio sin salir de la app (menú de la cuenta y
 * "Primeros pasos"). Igual que /download, más la espera a que la app avise que
 * se abrió con esta cuenta.
 */
export default async function AppDownloadPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const real = user.actingUser ?? user;
  const [t, release, profile] = await Promise.all([
    getTranslations({ locale, namespace: 'settings.welcome.desktop' }),
    desktopReleaseForClient(),
    getProfile(real.id),
  ]);
  return (
    <div className="app-page app-download">
      <PageHeader title={t('title')} description={t('sub')} />
      <div className="app-download-body">
        <DesktopDownload release={release} variant="page" track watch seen={Boolean(profile.desktopSeenAt)} />
        <DesktopFeatures />
      </div>
    </div>
  );
}

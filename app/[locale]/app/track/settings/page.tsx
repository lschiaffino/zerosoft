import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { GithubSettings, LabelsSettings } from '@/components/track/TrackSettingsClient';

export const dynamic = 'force-dynamic';

export default async function TrackSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const admin = isWorkspaceAdmin(user);

  return (
    <div className="app-page track-page track-settings-page">
      <div className="track-page-header">
        <div>
          <h1>{t('settingsPage.title')}</h1>
          <p>{t('settingsPage.subtitle')}</p>
        </div>
      </div>
      <LabelsSettings isAdmin={admin} />
      <GithubSettings isAdmin={admin} locale={locale} />
    </div>
  );
}

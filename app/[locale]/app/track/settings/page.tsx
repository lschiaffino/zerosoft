import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { GithubSettings, LabelsSettings } from '@/components/track/TrackSettingsClient';

export const dynamic = 'force-dynamic';

export default async function TrackSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { locale } = await props.params;
  const tab = (await props.searchParams)?.tab === 'github' ? 'github' : 'labels';
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const admin = isWorkspaceAdmin(user);

  return (
    <div className="app-page track-page ui-page ui-page-narrow">
      <PageHeader title={t('settingsPage.title')} description={t('settingsPage.subtitle')} />
      <SettingsTabs
        mode="query"
        layout="top"
        label={t('settingsPage.title')}
        items={[
          { key: 'labels', label: t('labelsSettings.title') },
          { key: 'github', label: t('github.title') },
        ]}
      >
        {tab === 'labels' ? <LabelsSettings isAdmin={admin} /> : <GithubSettings isAdmin={admin} locale={locale} />}
      </SettingsTabs>
    </div>
  );
}

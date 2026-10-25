import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { GithubSettings, LabelsSettings } from '@/components/track/TrackSettingsClient';
import NotifySettings from '@/components/track/NotifySettings';
import TrackImportPanel from '@/components/track/TrackImportPanel';
import AutomationSettings from '@/components/track/planning/AutomationSettings';
import { listProjects } from '@/lib/track-data';

export const dynamic = 'force-dynamic';

export default async function TrackSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { locale } = await props.params;
  const rawTab = (await props.searchParams)?.tab;
  const tab = rawTab === 'github' || rawTab === 'notifications' || rawTab === 'import' || rawTab === 'automations' ? rawTab : 'labels';
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const tp = await getTranslations({ locale, namespace: 'trackPlanning' });
  const admin = isWorkspaceAdmin(user);
  // Ejemplo de identificador con el prefijo de un proyecto real (WEB-123).
  const example =
    tab === 'github'
      ? `${((await listProjects(user.team?.id ?? null, user.id, { pageSize: 1 })).rows[0]?.slug ?? 'web').toUpperCase()}-123`
      : '';

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
          { key: 'notifications', label: t('notifySettings.title') },
          { key: 'import', label: t('importer.tab') },
          { key: 'automations', label: tp('automation.tab') },
        ]}
      >
        {tab === 'labels' ? (
          <LabelsSettings isAdmin={admin} />
        ) : tab === 'notifications' ? (
          <NotifySettings locale={locale} />
        ) : tab === 'import' ? (
          <TrackImportPanel isAdmin={admin} />
        ) : tab === 'automations' ? (
          <AutomationSettings isAdmin={admin} />
        ) : (
          <GithubSettings isAdmin={admin} locale={locale} example={example} />
        )}
      </SettingsTabs>
    </div>
  );
}

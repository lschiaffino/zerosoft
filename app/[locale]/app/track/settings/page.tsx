import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import PlatformSettingsLink from '@/components/app/PlatformSettingsLink';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { GithubSettings, LabelsSettings } from '@/components/track/TrackSettingsClient';
import NotifySettings from '@/components/track/NotifySettings';
import TrackImportPanel from '@/components/track/TrackImportPanel';
import AutomationSettings from '@/components/track/planning/AutomationSettings';
import AgentAppsSettings from '@/components/track/triage/AgentAppsSettings';
import { AccessSettings, ApiSettings, AuditLogSettings, GithubExtras, IntegrationsSettings } from '@/components/track/TrackIntegrationsSettings';
import { listProjects } from '@/lib/track-data';

export const dynamic = 'force-dynamic';

export default async function TrackSettingsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { locale } = await props.params;
  const rawTab = (await props.searchParams)?.tab;
  const TABS = ['github', 'integrations', 'api', 'access', 'audit', 'notifications', 'import', 'automations', 'agents'] as const;
  const tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as (typeof TABS)[number]) : 'labels';
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const tp = await getTranslations({ locale, namespace: 'trackPlanning' });
  const tTriage = await getTranslations({ locale, namespace: 'trackTriage' });
  const admin = isWorkspaceAdmin(user);
  // Ejemplo de identificador con el prefijo de un proyecto real (WEB-123).
  const example =
    tab === 'github'
      ? `${((await listProjects(user.team?.id ?? null, user.id, { pageSize: 1 })).rows[0]?.slug ?? 'web').toUpperCase()}-123`
      : '';

  return (
    <div className="app-page track-page ui-page ui-page-narrow">
      <PageHeader title={t('settingsPage.title')} description={t('settingsPage.subtitle')} actions={<PlatformSettingsLink locale={locale} />} />
      <SettingsTabs
        mode="query"
        layout="top"
        label={t('settingsPage.title')}
        items={[
          { key: 'labels', label: t('labelsSettings.title') },
          { key: 'github', label: t('github.title') },
          { key: 'integrations', label: t('integrations.tab') },
          { key: 'api', label: t('apiSettings.tab') },
          { key: 'access', label: t('access.tab') },
          { key: 'audit', label: t('audit.tab') },
          { key: 'notifications', label: t('notifySettings.title') },
          { key: 'import', label: t('importer.tab') },
          { key: 'automations', label: tp('automation.tab') },
          { key: 'agents', label: tTriage('agents.tab') },
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
        ) : tab === 'agents' ? (
          <AgentAppsSettings isAdmin={admin} />
        ) : tab === 'integrations' ? (
          <IntegrationsSettings locale={locale} />
        ) : tab === 'api' ? (
          <ApiSettings />
        ) : tab === 'access' ? (
          <AccessSettings isAdmin={admin} />
        ) : tab === 'audit' ? (
          <AuditLogSettings isAdmin={admin} locale={locale} />
        ) : (
          <>
            <GithubSettings isAdmin={admin} locale={locale} example={example} />
            <GithubExtras isAdmin={admin} />
          </>
        )}
      </SettingsTabs>
    </div>
  );
}

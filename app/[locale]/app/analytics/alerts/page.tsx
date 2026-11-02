import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import CollectionPage from '@/components/analytics/CollectionPage';
import { analyticsPage } from '@/lib/analytics/page';
import { listAlerts } from '@/lib/analytics/alerts';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.alerts')} · Analytics` };
}

/** Alertas del proyecto: se crean desde un insight de tendencias y se ven todas acá. */
export default async function AnalyticsAlertsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.alerts' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const alerts = await listAlerts(ctx.project.id);
  return (
    <CollectionPage
      kind="alerts"
      projectId={ctx.project.id}
      canCreate={false}
      canEdit
      items={alerts.map((a) => ({
        id: a.id,
        name: a.name,
        meta: `${t(a.enabled ? `states.${a.state}` : 'states.off')} · ${a.insightName}`,
        href: `/app/analytics/insights/${a.insightId}`,
      }))}
    />
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import CollectionPage from '@/components/analytics/CollectionPage';
import { analyticsPage } from '@/lib/analytics/page';
import { listDashboards } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.dashboards')} · Analytics` };
}

/** Tableros del proyecto. */
export default async function AnalyticsDashboardsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.dashboards' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const dashboards = await listDashboards(ctx.project.id);
  return (
    <CollectionPage
      kind="dashboards"
      projectId={ctx.project.id}
      canCreate
      canEdit
      items={dashboards.map((d) => ({ id: d.id, name: d.name, meta: t('insightsCount', { count: d.insightIds.length }), href: `/app/analytics/dashboards/${d.id}` }))}
    />
  );
}

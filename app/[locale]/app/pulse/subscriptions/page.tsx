import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import { SubscriptionsPage } from '@/components/analytics/Subscriptions';
import { analyticsPage } from '@/lib/analytics/page';
import { listDashboards, listInsights } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.subscriptions')} · Pulse` };
}

export default async function AnalyticsSubscriptionsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.subscriptions' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const [insights, dashboards] = await Promise.all([listInsights(ctx.project.id), listDashboards(ctx.project.id)]);
  return (
    <SubscriptionsPage
      projectId={ctx.project.id}
      canManage={ctx.canManage}
      insights={insights.map((i) => ({ id: i.id, name: i.name }))}
      dashboards={dashboards.map((d) => ({ id: d.id, name: d.name, insightIds: d.insightIds }))}
    />
  );
}

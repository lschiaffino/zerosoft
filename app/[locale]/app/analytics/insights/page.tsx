import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import CollectionPage from '@/components/analytics/CollectionPage';
import { analyticsPage } from '@/lib/analytics/page';
import { listInsights } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.insights')} · Analytics` };
}

/** Insights guardados del proyecto. */
export default async function AnalyticsInsightsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t, te] = await Promise.all([
    analyticsPage(locale),
    getTranslations({ locale, namespace: 'analytics.insights' }),
    getTranslations({ locale, namespace: 'analytics.editor.kinds' }),
  ]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const insights = await listInsights(ctx.project.id);
  return (
    <CollectionPage
      kind="insights"
      projectId={ctx.project.id}
      canCreate
      canEdit
      items={insights.map((i) => ({ id: i.id, name: i.name, meta: te(i.kind), href: `/app/analytics/insights/${i.id}` }))}
    />
  );
}

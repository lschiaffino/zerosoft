import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import CollectionPage from '@/components/analytics/CollectionPage';
import { analyticsPage } from '@/lib/analytics/page';
import { listExperiments } from '@/lib/analytics/experiments';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.experiments')} · Analytics` };
}

/** Experimentos A/B del proyecto. */
export default async function AnalyticsExperimentsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.experiments' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const experiments = await listExperiments(ctx.project.id);
  return (
    <CollectionPage
      kind="experiments"
      projectId={ctx.project.id}
      canCreate
      canEdit
      items={experiments.map((x) => ({ id: x.id, name: x.name, meta: `${t(`status.${x.status}`)} · ${x.flagKey}`, href: `/app/analytics/experiments/${x.id}` }))}
    />
  );
}

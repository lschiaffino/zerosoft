import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import NoProject from '@/components/analytics/NoProject';
import Heatmaps from '@/components/analytics/replay/Heatmaps';
import { rangeStart } from '@/lib/analytics/heatmap-core';
import { heatmapPaths } from '@/lib/analytics/heatmaps';
import { analyticsPage } from '@/lib/analytics/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsReplay' });
  return { title: `${t('heatmaps.title')} · Analytics` };
}

/** Mapas de calor del proyecto. */
export default async function AnalyticsHeatmapsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analyticsReplay.heatmaps' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const off = ctx.project.heatmaps_enabled !== 1;
  const now = Date.now();
  const paths = await heatmapPaths(ctx.project, rangeStart('-7d', now) ?? now);
  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={t('description')} />
      {off ? (
        <EmptyState
          product="analytics"
          title={t('offTitle')}
          body={ctx.canManage ? t('offBody') : t('offBodyMember')}
          action={ctx.canManage ? { label: t('openSettings'), href: '/app/analytics/settings#replay' } : undefined}
        />
      ) : (
        <Heatmaps key={ctx.project.id} projectId={ctx.project.id} initialPaths={paths} />
      )}
    </div>
  );
}

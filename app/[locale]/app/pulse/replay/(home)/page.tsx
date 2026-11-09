import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import NoProject from '@/components/analytics/NoProject';
import EmptyState from '@/components/ui/EmptyState';
import RecordingsList from '@/components/analytics/replay/RecordingsList';
import { rangeStart } from '@/lib/analytics/heatmap-core';
import { analyticsPage } from '@/lib/analytics/page';
import { listRecordings } from '@/lib/analytics/replay';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsReplay' });
  return { title: `${t('recordings.title')} · Pulse` };
}

/** Grabaciones de sesiones del proyecto. */
export default async function AnalyticsRecordingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analyticsReplay.recordings' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  if (!ctx.canManage) {
    return (
      <div className="app-page ui-page an-page">
        <PageHeader title={t('title')} description={t('description')} />
        <EmptyState product="pulse" title={t('adminsOnlyTitle')} body={t('adminsOnlyBody')} />
      </div>
    );
  }
  const now = Date.now();
  const { recordings, hasMore } = await listRecordings(ctx.project, { from: rangeStart('-30d', now) }, now);
  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={t('description')} />
      <RecordingsList key={ctx.project.id} projectId={ctx.project.id} initial={recordings} initialHasMore={hasMore} enabled={ctx.project.replay_enabled === 1} canManage={ctx.canManage} />
    </div>
  );
}

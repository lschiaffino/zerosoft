import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import NoProject from '@/components/analytics/NoProject';
import LiveEvents from '@/components/analytics/LiveEvents';
import { analyticsPage } from '@/lib/analytics/page';
import { liveEvents } from '@/lib/analytics/query';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.events')} · Analytics` };
}

/** Eventos en vivo del proyecto. */
export default async function AnalyticsEventsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.events' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const initial = await liveEvents(ctx.project, { limit: 100 });
  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={t('description')} />
      <LiveEvents key={ctx.project.id} projectId={ctx.project.id} initial={initial} />
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import InsightEditor from '@/components/analytics/InsightEditor';
import SyncProject from '@/components/analytics/SyncProject';
import { analyticsPage } from '@/lib/analytics/page';
import { recordProjectId } from '@/lib/analytics/guard';
import { requireUser } from '@/lib/session';
import { getInsight, listCohorts, listDashboards } from '@/lib/analytics/records';
import { INSIGHT_KINDS, type InsightKind } from '@/lib/analytics/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.insights')} · Analytics` };
}

/** Un insight guardado o uno nuevo (/insights/new?kind=funnel). */
export default async function AnalyticsInsightPage(props: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { locale, id } = await props.params;
  const { kind } = await props.searchParams;
  // El insight puede ser de otro proyecto del workspace: ese pasa a ser el que se mira.
  const user = await requireUser(locale);
  const ownerProject = id === 'new' ? null : await recordProjectId('insights', id, user.id);
  if (id !== 'new' && !ownerProject) notFound();
  const [ctx, t] = await Promise.all([analyticsPage(locale, ownerProject), getTranslations({ locale, namespace: 'analytics.insights' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const insight = id === 'new' ? null : await getInsight(ctx.project.id, id);
  if (id !== 'new' && !insight) notFound();
  const [dashboards, cohorts] = await Promise.all([listDashboards(ctx.project.id), listCohorts(ctx.project.id)]);
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <InsightEditor
        key={insight?.id ?? 'new'}
        projectId={ctx.project.id}
        insight={insight}
        initialKind={INSIGHT_KINDS.includes(kind as InsightKind) ? (kind as InsightKind) : undefined}
        dashboards={dashboards.map((d) => ({ id: d.id, name: d.name, insightIds: d.insightIds }))}
        cohorts={cohorts.map((c) => ({ id: c.id, name: c.name }))}
      />
    </>
  );
}

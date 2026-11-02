import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { hasActiveShare, listAnnotations } from '@/lib/analytics/records-more';
import DashboardView from '@/components/analytics/DashboardView';
import SyncProject from '@/components/analytics/SyncProject';
import { analyticsPage } from '@/lib/analytics/page';
import { recordProjectId } from '@/lib/analytics/guard';
import { requireUser } from '@/lib/session';
import { getDashboard, listCohorts, listDashboards, listInsights } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.dashboards')} · Analytics` };
}

/** Un tablero con sus insights. */
export default async function AnalyticsDashboardPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const ownerProject = await recordProjectId('dashboards', id, (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const dashboard = await getDashboard(ctx.project.id, id);
  if (!dashboard) notFound();
  const all = await listInsights(ctx.project.id);
  const insights = dashboard.insightIds.map((i) => all.find((x) => x.id === i)).filter((x): x is (typeof all)[number] => Boolean(x));
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <DashboardView
        projectId={ctx.project.id}
        dashboard={dashboard}
        insights={insights}
        allInsights={all.map((i) => ({ id: i.id, name: i.name }))}
        canShare={ctx.canManage}
        annotations={(await listAnnotations(ctx.project.id)).map((a) => ({ date: a.date, content: a.content }))}
        cohorts={(await listCohorts(ctx.project.id)).map((c) => ({ id: c.id, name: c.name }))}
        locked={!ctx.canManage && (await hasActiveShare(ctx.project.id, { dashboardId: dashboard.id }))}
        otherDashboards={(await listDashboards(ctx.project.id)).filter((d) => d.id !== dashboard.id).map((d) => ({ id: d.id, name: d.name }))}
      />
    </>
  );
}

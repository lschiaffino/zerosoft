import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import DashboardView from '@/components/analytics/DashboardView';
import SyncProject from '@/components/analytics/SyncProject';
import { analyticsPage } from '@/lib/analytics/page';
import { getDb } from '@/lib/db';
import { getDashboard, listInsights } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.dashboards')} · Analytics` };
}

/** Un tablero con sus insights. */
export default async function AnalyticsDashboardPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const owner = (await getDb().prepare('SELECT project_id FROM analytics_dashboards WHERE id = ?').get(id)) as { project_id: string } | undefined;
  if (!owner) notFound();
  const ctx = await analyticsPage(locale, owner.project_id);
  if (!ctx.project || ctx.project.id !== owner.project_id) notFound();
  const dashboard = await getDashboard(ctx.project.id, id);
  if (!dashboard) notFound();
  const all = await listInsights(ctx.project.id);
  const insights = dashboard.insightIds.map((i) => all.find((x) => x.id === i)).filter((x): x is (typeof all)[number] => Boolean(x));
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <DashboardView projectId={ctx.project.id} dashboard={dashboard} insights={insights} allInsights={all.map((i) => ({ id: i.id, name: i.name }))} />
    </>
  );
}

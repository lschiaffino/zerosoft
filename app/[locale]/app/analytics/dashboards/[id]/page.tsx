import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import DashboardView from '@/components/bi/DashboardView';
import { biPage } from '@/lib/bi/page';
import { getDashboard } from '@/lib/bi/store';
import { getDb } from '@/lib/db';

export async function generateMetadata(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const { viewer } = await biPage(locale);
  const d = await getDashboard(viewer, id);
  return { title: d ? `${d.name} · Analytics` : 'Analytics' };
}

export default async function Page(props: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { locale, id } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const { viewer, isAdmin } = await biPage(locale);
  const dashboard = await getDashboard(viewer, id);
  if (!dashboard) {
    // Links viejos a tableros de Pulse (cuando se llamaba Analytics): /app/analytics/dashboards/<id de Pulse>.
    const pulse = await getDb()
      .prepare('SELECT d.id FROM analytics_dashboards d JOIN analytics_projects p ON p.id = d.project_id WHERE d.id = ? AND p.workspace_id = ?')
      .get(id, viewer.workspaceId)
      .catch(() => undefined);
    if (pulse) redirect(`/${locale}/app/pulse/dashboards/${id}`);
    notFound();
  }
  return <DashboardView key={dashboard.id} initial={dashboard} isAdmin={isAdmin} startEdit={sp.edit === '1'} />;
}

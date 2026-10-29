import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import NoProject from '@/components/analytics/NoProject';
import ProjectSettings from '@/components/analytics/ProjectSettings';
import SyncProject from '@/components/analytics/SyncProject';
import { analyticsPage } from '@/lib/analytics/page';
import { toProjectDto } from '@/lib/analytics/projects';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('settings.title')} · Analytics` };
}

/** Instalar y ajustar el proyecto que se mira (?project= para otro del workspace). */
export default async function AnalyticsSettingsPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ project?: string }> }) {
  const { locale } = await props.params;
  const { project: wanted } = await props.searchParams;
  const [ctx, t] = await Promise.all([analyticsPage(locale, wanted ?? null), getTranslations({ locale, namespace: 'analytics.settings' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const cookieProject = wanted ? ((await analyticsPage(locale)).project?.id ?? null) : ctx.project.id;
  return (
    <div className="app-page ui-page an-page">
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <PageHeader title={t('title')} description={t('description', { project: ctx.project.name })} />
      <ProjectSettings project={toProjectDto(ctx.project)} canManage={ctx.canManage} />
    </div>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import NoProject from '@/components/analytics/NoProject';
import WebOverview from '@/components/analytics/WebOverview';
import { analyticsPage } from '@/lib/analytics/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.web')} · Analytics` };
}

/** Inicio de Analytics: web analytics del proyecto (visitantes, páginas, fuentes, dispositivos). */
export default async function AnalyticsHome(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.web' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={t('description', { project: ctx.project.name })} />
      <WebOverview projectId={ctx.project.id} />
    </div>
  );
}

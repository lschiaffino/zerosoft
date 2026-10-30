import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import SqlConsole from '@/components/analytics/SqlConsole';
import { analyticsPage } from '@/lib/analytics/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.sql')} · Analytics` };
}

/** Editor SQL de solo lectura sobre el proyecto. */
export default async function AnalyticsSqlPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.sql' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  return <SqlConsole key={ctx.project.id} projectId={ctx.project.id} />;
}

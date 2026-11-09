import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import ErrorsList from '@/components/analytics/ErrorsList';
import NoProject from '@/components/analytics/NoProject';
import { analyticsPage } from '@/lib/analytics/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsMore' });
  return { title: `${t('sidebar.errors')} · Pulse` };
}

/** Errores del proyecto, agrupados. */
export default async function AnalyticsErrorsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analyticsMore.errors' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  return <ErrorsList key={ctx.project.id} projectId={ctx.project.id} captureOn={ctx.project.capture_exceptions === 1} canManage={ctx.canManage} />;
}

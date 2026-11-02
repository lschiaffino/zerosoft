import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import { AnnotationsPage } from '@/components/analytics/DataPages';
import { analyticsPage } from '@/lib/analytics/page';
import { listAnnotations } from '@/lib/analytics/records-more';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.annotations')} · Analytics` };
}

export default async function AnalyticsAnnotationsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analytics.annotations' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  return <AnnotationsPage key={ctx.project.id} projectId={ctx.project.id} initial={await listAnnotations(ctx.project.id)} />;
}

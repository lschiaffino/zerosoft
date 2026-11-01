import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import NoProject from '@/components/analytics/NoProject';
import SurveysPage from '@/components/analytics/SurveysPage';
import { analyticsPage } from '@/lib/analytics/page';
import { listSurveys } from '@/lib/analytics/surveys';
import { surveyDisplayStatus } from '@/lib/analytics/surveys-core';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsMore' });
  return { title: `${t('sidebar.surveys')} · Analytics` };
}

/** Encuestas del proyecto. */
export default async function AnalyticsSurveysPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const [ctx, t] = await Promise.all([analyticsPage(locale), getTranslations({ locale, namespace: 'analyticsMore.surveys' })]);
  if (!ctx.project) return <NoProject title={t('title')} canManage={ctx.canManage} />;
  const surveys = await listSurveys(ctx.project.id);
  const now = Date.now();
  return (
    <SurveysPage
      projectId={ctx.project.id}
      items={surveys.map((s) => ({ id: s.id, name: s.name, status: surveyDisplayStatus(s, now), responses: s.responses, questions: s.questions.length }))}
    />
  );
}

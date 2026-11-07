import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import SurveyResultsView from '@/components/analytics/SurveyResultsView';
import SyncProject from '@/components/analytics/SyncProject';
import { recordProjectId } from '@/lib/analytics/guard';
import { analyticsPage } from '@/lib/analytics/page';
import { getSurvey } from '@/lib/analytics/surveys';
import { surveyDisplayStatus } from '@/lib/analytics/surveys-core';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsMore' });
  return { title: `${t('sidebar.surveys')} · Analytics` };
}

/** Resultados de una encuesta. */
export default async function AnalyticsSurveyResultsPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const ownerProject = await recordProjectId('surveys', id, (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const [survey, cookieCtx] = await Promise.all([getSurvey(ctx.project.id, id), analyticsPage(locale)]);
  if (!survey) notFound();
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieCtx.project?.id ?? null} />
      <SurveyResultsView id={survey.id} name={survey.name} status={surveyDisplayStatus(survey, Date.now())} />
    </>
  );
}

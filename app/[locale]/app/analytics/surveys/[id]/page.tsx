import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import SurveyEditor from '@/components/analytics/SurveyEditor';
import SyncProject from '@/components/analytics/SyncProject';
import { recordProjectId } from '@/lib/analytics/guard';
import { analyticsPage } from '@/lib/analytics/page';
import { listFlags } from '@/lib/analytics/records';
import { getSurvey } from '@/lib/analytics/surveys';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsMore' });
  return { title: `${t('sidebar.surveys')} · Analytics` };
}

/** Una encuesta: el editor con la vista previa. */
export default async function AnalyticsSurveyPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const ownerProject = await recordProjectId('surveys', id, (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const [survey, flags, cookieCtx] = await Promise.all([getSurvey(ctx.project.id, id), listFlags(ctx.project.id), analyticsPage(locale)]);
  if (!survey) notFound();
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieCtx.project?.id ?? null} />
      <SurveyEditor key={survey.id} survey={survey} flagKeys={flags.map((f) => f.key)} publicKey={ctx.project.public_key} tzOffsetMin={Number(ctx.project.tz_offset_min)} now={Date.now()} />
    </>
  );
}

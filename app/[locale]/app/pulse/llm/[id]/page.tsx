import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import LlmGenerationView from '@/components/analytics/LlmGenerationView';
import SyncProject from '@/components/analytics/SyncProject';
import { generationProjectId, llmGeneration } from '@/lib/analytics/llm';
import { analyticsPage } from '@/lib/analytics/page';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsMore' });
  return { title: `${t('sidebar.llm')} · Pulse` };
}

/** Una generación. */
export default async function AnalyticsLlmGenerationPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  const ownerProject = await generationProjectId(Number(id), (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const [generation, cookieCtx] = await Promise.all([llmGeneration(ctx.project.id, Number(id)), analyticsPage(locale)]);
  if (!generation) notFound();
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieCtx.project?.id ?? null} />
      <LlmGenerationView g={generation} />
    </>
  );
}

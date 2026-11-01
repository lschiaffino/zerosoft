import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import ExperimentView from '@/components/analytics/ExperimentView';
import SyncProject from '@/components/analytics/SyncProject';
import { recordProjectId } from '@/lib/analytics/guard';
import { analyticsPage } from '@/lib/analytics/page';
import { getExperiment } from '@/lib/analytics/experiments';
import { listFlags } from '@/lib/analytics/records';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.experiments')} · Analytics` };
}

export default async function AnalyticsExperimentPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const ownerProject = await recordProjectId('experiments', id, (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const [experiment, flags] = await Promise.all([getExperiment(ctx.project.id, id), listFlags(ctx.project.id)]);
  if (!experiment) notFound();
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <ExperimentView key={`${experiment.id}:${experiment.status}`} projectId={ctx.project.id} experiment={experiment} flags={flags.map((f) => ({ id: f.id, key: f.key, variants: f.variants.length }))} />
    </>
  );
}

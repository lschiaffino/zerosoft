import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionEditor } from '@/components/analytics/DataPages';
import { sharesUsing } from '@/lib/analytics/records-more';
import SyncProject from '@/components/analytics/SyncProject';
import { recordProjectId } from '@/lib/analytics/guard';
import { analyticsPage } from '@/lib/analytics/page';
import { getAction } from '@/lib/analytics/records-more';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.actions')} · Pulse` };
}

export default async function AnalyticsActionPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const ownerProject = await recordProjectId('actions', id, (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const action = await getAction(ctx.project.id, id);
  if (!action) notFound();
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <ActionEditor key={action.id} projectId={ctx.project.id} action={action} publicLinks={await sharesUsing(ctx.project.id, { actionId: action.id })} />
    </>
  );
}

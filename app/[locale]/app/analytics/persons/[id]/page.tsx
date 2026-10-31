import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import PersonDetail from '@/components/analytics/PersonDetail';
import SyncProject from '@/components/analytics/SyncProject';
import { analyticsPage } from '@/lib/analytics/page';
import { recordProjectId } from '@/lib/analytics/guard';
import { requireUser } from '@/lib/session';
import { getPerson, personEvents } from '@/lib/analytics/persons';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.persons')} · Analytics` };
}

/** Una persona con su línea de tiempo. */
export default async function AnalyticsPersonPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const ownerProject = await recordProjectId('persons', id, (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const [person, events] = await Promise.all([getPerson(ctx.project.id, id), personEvents(ctx.project.id, id)]);
  if (!person) notFound();
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <PersonDetail person={person} events={events} canDelete={ctx.canManage} />
    </>
  );
}

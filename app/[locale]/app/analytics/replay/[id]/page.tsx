import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import Player from '@/components/analytics/replay/Player';
import SyncProject from '@/components/analytics/SyncProject';
import { recordProjectId } from '@/lib/analytics/guard';
import { analyticsPage } from '@/lib/analytics/page';
import { getRecording, recordingEvents } from '@/lib/analytics/replay';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsReplay' });
  return { title: `${t('recordings.title')} · Analytics` };
}

/** Una grabación: reproductor y eventos de la sesión. */
export default async function AnalyticsRecordingPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const ownerProject = await recordProjectId('recordings', id, (await requireUser(locale)).id);
  if (!ownerProject) notFound();
  const ctx = await analyticsPage(locale, ownerProject);
  if (!ctx.project || ctx.project.id !== ownerProject) notFound();
  const recording = await getRecording(ctx.project, id);
  if (!recording) notFound();
  const events = await recordingEvents(ctx.project, recording);
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <Player key={recording.id} recording={recording} events={events} canDelete={ctx.canManage} />
    </>
  );
}

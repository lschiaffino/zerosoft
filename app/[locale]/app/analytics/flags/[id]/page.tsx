import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import FlagEditor from '@/components/analytics/FlagEditor';
import SyncProject from '@/components/analytics/SyncProject';
import { analyticsPage } from '@/lib/analytics/page';
import { getDb } from '@/lib/db';
import { getFlag } from '@/lib/analytics/records';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: `${t('sidebar.flags')} · Analytics` };
}

/** Un feature flag. */
export default async function AnalyticsFlagPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const owner = (await getDb().prepare('SELECT project_id FROM analytics_flags WHERE id = ?').get(id)) as { project_id: string } | undefined;
  if (!owner) notFound();
  const ctx = await analyticsPage(locale, owner.project_id);
  if (!ctx.project || ctx.project.id !== owner.project_id) notFound();
  const flag = await getFlag(ctx.project.id, id);
  if (!flag) notFound();
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <FlagEditor key={flag.id} projectId={ctx.project.id} flag={flag} publicKey={ctx.project.public_key} />
    </>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import ErrorDetail from '@/components/analytics/ErrorDetail';
import SyncProject from '@/components/analytics/SyncProject';
import { issueRef, parseIssueRef } from '@/lib/analytics/more-types';
import { analyticsPage } from '@/lib/analytics/page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'analyticsMore' });
  return { title: `${t('sidebar.errors')} · Analytics` };
}

/** Un error agrupado. */
export default async function AnalyticsErrorPage(props: { params: Promise<{ locale: string; ref: string }> }) {
  const { locale, ref } = await props.params;
  const parsed = parseIssueRef(ref);
  if (!parsed) notFound();
  const ctx = await analyticsPage(locale, parsed.projectId);
  if (!ctx.project || ctx.project.id !== parsed.projectId) notFound();
  const cookieProject = (await analyticsPage(locale)).project?.id ?? null;
  return (
    <>
      <SyncProject projectId={ctx.project.id} currentId={cookieProject} />
      <ErrorDetail refId={issueRef(parsed.projectId, parsed.fingerprint)} canEdit />
    </>
  );
}

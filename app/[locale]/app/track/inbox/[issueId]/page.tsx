import IssueDetailView from '@/components/track/IssueDetailView';

export const dynamic = 'force-dynamic';

/** El issue de un aviso, en el panel de la bandeja (al lado de la lista). */
export default async function TrackInboxIssuePage(props: { params: Promise<{ locale: string; issueId: string }> }) {
  const { locale, issueId } = await props.params;
  return <IssueDetailView locale={locale} idParam={issueId} panel />;
}

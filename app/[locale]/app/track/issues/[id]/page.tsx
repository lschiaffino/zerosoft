import IssueDetailView from '@/components/track/IssueDetailView';

export const dynamic = 'force-dynamic';

export default async function IssueDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  return <IssueDetailView locale={locale} idParam={id} />;
}

import IssueDetailPage from '../../../issues/[id]/page';

export const dynamic = 'force-dynamic';

/**
 * URL del issue como en Linear: /app/track/issue/WEB-12/titulo-del-issue. El
 * identificador (o el ID viejo de un issue que se movió de team) resuelve al
 * issue; el slug del título es decorativo.
 */
export default async function IssueByRefPage(props: { params: Promise<{ locale: string; ref: string; slug?: string[] }> }) {
  const { locale, ref } = await props.params;
  return IssueDetailPage({ params: Promise.resolve({ locale, id: ref }) });
}

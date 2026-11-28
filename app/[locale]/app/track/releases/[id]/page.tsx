import { notFound } from 'next/navigation';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getAccessibleRelease, listReleaseIssues } from '@/lib/track-releases';
import ReleasePage from '@/components/track/ReleasePage';

export const dynamic = 'force-dynamic';

/** Un release: avance, issues por estado y notas (solo si la persona ve su team). */
export default async function Page(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const found = await getAccessibleRelease(id, user.team?.id ?? null, user.id);
  if (!found) notFound();
  const issues = await listReleaseIssues(found.release.id);
  return <ReleasePage locale={locale} initialRelease={found.release} initialIssues={issues} canDelete={isWorkspaceAdmin(user)} />;
}

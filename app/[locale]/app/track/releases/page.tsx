import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { listProjects } from '@/lib/track-data';
import { listReleases } from '@/lib/track-releases';
import ReleasesPage from '@/components/track/ReleasesPage';

export const dynamic = 'force-dynamic';

/** Releases (como Linear): los de los teams que la persona ve, por estado. */
export default async function Page(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ new?: string; team?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const [releases, teams] = await Promise.all([
    listReleases(user.team?.id ?? null, user.id),
    listProjects(user.team?.id ?? null, user.id, { pageSize: 100 }),
  ]);
  const t = await getTranslations({ locale, namespace: 'track.releases' });
  return (
    <ReleasesPage
      locale={locale}
      initialReleases={releases}
      teams={teams.rows.filter((p) => p.status === 'active').map((p) => ({ id: p.id, name: p.name, key: p.slug.toUpperCase() }))}
      openNew={sp.new === '1'}
      defaultTeam={sp.team}
      title={t('title')}
      canDelete={isWorkspaceAdmin(user)}
    />
  );
}

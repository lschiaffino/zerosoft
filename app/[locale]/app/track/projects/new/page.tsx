import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getProjectBySlug, getProject, canAccessTrackProject } from '@/lib/track-data';

export const dynamic = 'force-dynamic';

/**
 * Nuevo project (de Linear): abre el alta sobre la lista de projects. Con
 * ?team=<clave o id> (desde un team: menú "+ Nuevo" del sidebar o ⌘K) el
 * project nace en ese team. Un team nuevo es /app/track/teams/new.
 */
export default async function Page(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ team?: string }> }) {
  const { locale } = await props.params;
  const { team } = await props.searchParams;
  const user = await requireUser(locale);
  let teamId: string | null = null;
  if (team) {
    const ws = user.team?.id ?? user.id;
    const row = (await getProjectBySlug(team.toLowerCase(), ws)) ?? (await getProject(team));
    if (row && (await canAccessTrackProject(row, user.team?.id ?? null, user.id))) teamId = row.id;
  }
  redirect(`/${locale}/app/track/projects?new=1${teamId ? `&team=${encodeURIComponent(teamId)}` : ''}`);
}

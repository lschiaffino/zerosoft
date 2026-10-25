import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { listProjects } from '@/lib/track-data';
import { teamPath } from '@/lib/track-routes';

export const dynamic = 'force-dynamic';

/**
 * G T (como Linear): el triage del team que se estaba mirando (?team=) o, si
 * no, el primero con issues esperando o con triage prendido.
 */
export default async function Page(props: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const wanted = (await props.searchParams)?.team;
  const { rows } = await listProjects(user.team?.id ?? null, user.id, { pageSize: 100 });
  const active = rows.filter((p) => p.status === 'active');
  const team =
    active.find((p) => p.id === wanted) ??
    active.find((p) => (p.triage_count ?? 0) > 0) ??
    active.find((p) => p.triage_enabled) ??
    active[0];
  if (!team) redirect(`/${locale}/app/track/teams`);
  redirect(`/${locale}${teamPath(team)}?tab=triage`);
}

import { notFound, redirect } from 'next/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getProject, getProjectBySlug, canAccessTrackProject, listProjectMembers, listStatuses } from '@/lib/track-data';
import { listProjectViews } from '@/lib/track-ux';
import ProjectPageClient from '@/components/track/ProjectPageClient';

export const dynamic = 'force-dynamic';

/** Página de un team (proyecto de Track) por su clave (/app/track/team/WEB) o su id. */
export default async function TeamPage(
  props: {
    params: Promise<{ locale: string; key: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const { locale, key } = await props.params;
  const param = decodeURIComponent(key);

  const user = await requireUser(locale);
  const project = (await getProject(param)) ?? (await getProjectBySlug(param.toLowerCase(), user.team?.id ?? user.id));
  if (!project || !(await canAccessTrackProject(project, user.team?.id ?? null, user.id))) notFound();
  // URL canónica con la clave (como Linear): /team/<id> → /team/WEB, con la query.
  const canonical = project.slug.toUpperCase();
  if (param !== canonical) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries((await props.searchParams) ?? {})) if (typeof v === 'string') sp.set(k, v);
    redirect(`/${locale}/app/track/team/${encodeURIComponent(canonical)}${sp.size ? `?${sp}` : ''}`);
  }

  // Lo que la lista necesita para dibujarse sin esperar: status, miembros y vistas del team.
  const me = realUserId(user);
  const [statuses, members, views] = await Promise.all([
    listStatuses(project.id),
    listProjectMembers(project.id, user.id),
    listProjectViews(project.id, me),
  ]);

  return (
    <ProjectPageClient
      project={project}
      teamKey={canonical}
      userId={me}
      isAdmin={isWorkspaceAdmin(user)}
      initialStatuses={statuses}
      initialMembers={members}
      initialViews={views}
    />
  );
}

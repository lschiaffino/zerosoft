import { notFound, redirect } from 'next/navigation';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getProject, getProjectBySlug, canAccessTrackProject, listProjectMembers, listStatuses } from '@/lib/track-data';
import { listProjectViews } from '@/lib/track-ux';
import { listCyclesWithProgress } from '@/lib/track-data';
import { listMilestones } from '@/lib/track-milestones';
import { listTemplates } from '@/lib/track-templates';
import { listRecurring } from '@/lib/track-recurring';
import { listTriageIssues } from '@/lib/track-bulk';
import ProjectPageClient from '@/components/track/ProjectPageClient';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Casi siempre llega la clave (WEB): se busca por slug primero; solo un uuid se busca por id.
  const ws = user.team?.id ?? user.id;
  const project = UUID_RE.test(param) ? ((await getProject(param)) ?? (await getProjectBySlug(param.toLowerCase(), ws))) : ((await getProjectBySlug(param.toLowerCase(), ws)) ?? (await getProject(param)));
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
  // Todo lo del team en el servidor y en paralelo: la página no hace una docena de pedidos al abrir.
  const [statuses, members, views, cycles, milestones, templates, recurring, triage] = await Promise.all([
    listStatuses(project.id),
    listProjectMembers(project.id, user.id),
    listProjectViews(project.id, me),
    listCyclesWithProgress(project.id),
    listMilestones(project.id),
    listTemplates(project.id),
    listRecurring(project.id),
    listTriageIssues(project.id, { snoozed: false }),
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
      initialCycles={cycles}
      initialMilestones={milestones}
      initialTemplates={templates}
      initialRecurring={recurring}
      initialTriage={triage}
    />
  );
}

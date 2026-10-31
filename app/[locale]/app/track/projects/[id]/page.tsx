import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getAccessiblePlan } from '@/lib/track-plans';
import { canAccessTrackProject, getProject } from '@/lib/track-data';
import { teamPath } from '@/lib/track-routes';
import PlanPage from '@/components/track/planning/PlanPage';

export const dynamic = 'force-dynamic';

/**
 * Project (como en Linear; en el código, plan). Los links viejos a
 * /app/track/projects/<id de un team> llevan a la página del team.
 */
export default async function Page(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  // Con el filtro de workspace: un id de otro workspace responde igual que uno inventado.
  const plan = await getAccessiblePlan(id, { teamId: user.team?.id ?? null, ownerId: user.id });
  if (!plan) {
    const team = await getProject(id);
    if (team && (await canAccessTrackProject(team, user.team?.id ?? null, user.id))) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries((await props.searchParams) ?? {})) {
        if (typeof v === 'string') sp.set(k, v);
      }
      redirect(`/${locale}${teamPath(team)}${sp.size ? `?${sp}` : ''}`);
    }
    notFound();
  }
  return (
    <div className="app-page track-page ui-page tp-page">
      <Suspense fallback={null}>
        <PlanPage planId={id} />
      </Suspense>
    </div>
  );
}

import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
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
  await requireUser(locale);
  const db = getDb();
  const plan = await db.prepare('SELECT id FROM track_plans WHERE id = ?').get(id);
  if (!plan) {
    const team = (await db.prepare('SELECT id, slug FROM track_projects WHERE id = ?').get(id)) as
      | { id: string; slug: string }
      | undefined;
    if (team) {
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

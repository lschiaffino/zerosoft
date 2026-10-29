import { NextRequest, NextResponse } from 'next/server';
import { listPersons } from '@/lib/analytics/persons';
import { getCohort } from '@/lib/analytics/records';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Personas del proyecto (?q=, ?cohort=, ?ids=a,b para las que abandonaron un embudo, ?offset=). */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  let cohort = null;
  const cohortId = sp.get('cohort');
  if (cohortId) {
    const c = await getCohort(project.id, cohortId);
    if (!c) return aError(404, 'cohort_not_found');
    cohort = c.definition;
  }
  const idsRaw = sp.get('ids');
  const ids = idsRaw ? idsRaw.split(',').filter(Boolean).slice(0, 200) : null;
  const res = await listPersons(project.id, { q: sp.get('q'), cohort, ids, offset: Number(sp.get('offset')) || 0 });
  return NextResponse.json(res);
}

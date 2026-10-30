import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cohortDefinitionSchema } from '@/lib/analytics/types';
import { createCohort, listCohorts } from '@/lib/analytics/records';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  return NextResponse.json({ cohorts: await listCohorts(project.id, req.nextUrl.searchParams.get('q') ?? undefined) });
}

const createSchema = z.object({ projectId: z.string().max(64), name: z.string().trim().min(1).max(200), definition: cohortDefinitionSchema });

export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  return NextResponse.json({ cohort: await createCohort(project.id, actor.personId, parsed.data) }, { status: 201 });
}

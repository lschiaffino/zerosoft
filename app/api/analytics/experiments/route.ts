import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { experimentInputSchema } from '@/lib/analytics/types';
import { createExperiment, listExperiments } from '@/lib/analytics/experiments';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  return NextResponse.json({ experiments: await listExperiments(project.id) });
}

export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const parsed = experimentInputSchema.extend({ projectId: z.string().max(64) }).safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  const experiment = await createExperiment(project.id, actor.personId, parsed.data);
  if (typeof experiment === 'string') return aError(400, experiment);
  return NextResponse.json({ experiment }, { status: 201 });
}

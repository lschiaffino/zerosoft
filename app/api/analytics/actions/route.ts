import { NextRequest, NextResponse } from 'next/server';
import { actionInputSchema } from '@/lib/analytics/types';
import { createAction, listActions } from '@/lib/analytics/records-more';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  return NextResponse.json({ actions: await listActions(project.id) });
}

const createSchema = actionInputSchema.extend({ projectId: z.string().max(64) });

export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  return NextResponse.json({ action: await createAction(project.id, actor.personId, parsed.data) }, { status: 201 });
}

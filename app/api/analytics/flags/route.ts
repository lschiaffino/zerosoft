import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { flagInputSchema } from '@/lib/analytics/types';
import { variantsValid } from '@/lib/analytics/flags-core';
import { createFlag, listFlags } from '@/lib/analytics/records';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  return NextResponse.json({ flags: await listFlags(project.id, req.nextUrl.searchParams.get('q') ?? undefined) });
}

const createSchema = flagInputSchema.extend({ projectId: z.string().max(64) });

export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  if (!variantsValid(parsed.data.variants)) return aError(400, 'variants_must_sum_100');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  const flag = await createFlag(project.id, actor.personId, parsed.data);
  if (flag === 'duplicate_key') return aError(409, 'duplicate_key');
  return NextResponse.json({ flag }, { status: 201 });
}

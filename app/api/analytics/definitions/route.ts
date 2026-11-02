import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eventNameSchema } from '@/lib/analytics/types';
import { listEventDefinitions, saveEventDefinition } from '@/lib/analytics/records-more';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  return NextResponse.json({ events: await listEventDefinitions(project.id) });
}

const schema = z.object({ projectId: z.string().max(64), event: eventNameSchema, description: z.string().max(500).default(''), verified: z.boolean().default(false), hidden: z.boolean().default(false) });

export async function PUT(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  await saveEventDefinition(project.id, parsed.data.event, parsed.data);
  return NextResponse.json({ ok: true });
}

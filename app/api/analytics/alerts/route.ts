import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { alertInputSchema } from '@/lib/analytics/types';
import { createAlert, listAlerts } from '@/lib/analytics/alerts';
import { actorProject, aError, analyticsActor, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  return NextResponse.json({ alerts: await listAlerts(project.id, req.nextUrl.searchParams.get('insight') ?? undefined) });
}

export async function POST(req: NextRequest) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const parsed = alertInputSchema.extend({ projectId: z.string().max(64) }).safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const project = await actorProject(actor, parsed.data.projectId);
  if (isResponse(project)) return project;
  const alert = await createAlert(project.id, actor.personId, parsed.data);
  if (alert === 'too_many') return aError(409, 'too_many_alerts');
  if (alert === 'insight_not_found') return aError(400, 'insight_not_trends');
  return NextResponse.json({ alert }, { status: 201 });
}

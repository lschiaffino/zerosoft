import { NextRequest, NextResponse } from 'next/server';
import { aError, analyticsActor, canManageAnalytics, isResponse, recordProject } from '@/lib/analytics/http';
import { deleteRecording, getRecording, recordingEvents } from '@/lib/analytics/replay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Una grabación con los eventos de su sesión. De otro workspace responde 404. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_replay_recordings', id);
  if (isResponse(project)) return project;
  const recording = await getRecording(project, id);
  if (!recording) return aError(404, 'not_found');
  return NextResponse.json({ recording, events: await recordingEvents(project, recording) });
}

/** Borra la grabación (admins: es lo mismo que borrar datos de una persona). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_replay_recordings', id);
  if (isResponse(project)) return project;
  if (!(await deleteRecording(project.id, id))) return aError(404, 'not_found');
  return NextResponse.json({ ok: true });
}

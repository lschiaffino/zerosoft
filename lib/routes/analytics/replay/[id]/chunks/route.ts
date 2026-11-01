import { NextRequest, NextResponse } from 'next/server';
import { analyticsActor, aError, isResponse, recordProject } from '@/lib/analytics/http';
import { getRecording, recordingChunks } from '@/lib/analytics/replay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Los eventos de la grabación, en gzip y base64, por tandas (?after=<seq>). El navegador los infla. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_replay_recordings', id);
  if (isResponse(project)) return project;
  if (!(await getRecording(project, id))) return aError(404, 'not_found');
  const raw = req.nextUrl.searchParams.get('after');
  const after = raw === null ? -1 : Number(raw);
  return NextResponse.json(await recordingChunks(id, Number.isInteger(after) ? after : -1), { headers: { 'cache-control': 'no-store' } });
}

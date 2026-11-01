import { NextRequest, NextResponse } from 'next/server';
import { actorProject, analyticsActor, isResponse } from '@/lib/analytics/http';
import { rangeStart } from '@/lib/analytics/heatmap-core';
import { listRecordings } from '@/lib/analytics/replay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Grabaciones del proyecto con filtros: persona, fechas, duración mínima y URL. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const now = Date.now();
  const result = await listRecordings(
    project,
    {
      person: sp.get('person')?.slice(0, 200),
      personId: sp.get('personId')?.slice(0, 100),
      from: rangeStart(sp.get('range'), now),
      minDurationMs: Math.max(0, Number(sp.get('minSeconds')) || 0) * 1000,
      url: sp.get('url')?.slice(0, 500),
      limit: Number(sp.get('limit')) || 50,
      offset: Number(sp.get('offset')) || 0,
    },
    now,
  );
  return NextResponse.json(result);
}

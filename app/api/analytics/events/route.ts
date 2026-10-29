import { NextRequest, NextResponse } from 'next/server';
import { eventNames, liveEvents } from '@/lib/analytics/query';
import { actorProject, analyticsActor, isResponse } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const num = (v: string | null) => (v && /^\d{1,15}$/.test(v) ? Number(v) : null);

/** Eventos en vivo del proyecto (?after= para lo nuevo, ?before= para lo anterior, ?event= para filtrar). */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  if (sp.get('names') === '1') return NextResponse.json({ names: await eventNames(project) });
  const events = await liveEvents(project, {
    after: num(sp.get('after')),
    before: num(sp.get('before')),
    event: sp.get('event')?.slice(0, 200) || null,
    distinctId: sp.get('distinct_id')?.slice(0, 200) || null,
    limit: num(sp.get('limit')) ?? 100,
  });
  return NextResponse.json({ events });
}

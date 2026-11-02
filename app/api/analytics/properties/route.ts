import { NextRequest, NextResponse } from 'next/server';
import { eventNames, propertyKeys } from '@/lib/analytics/query';
import { hiddenEvents, listActions } from '@/lib/analytics/records-more';
import { actorProject, analyticsActor, isResponse } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nombres de eventos y claves de propiedades vistas (para los selectores de las consultas). */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  const [names, keys, actions, hidden] = await Promise.all([eventNames(project), propertyKeys(project), listActions(project.id), hiddenEvents(project.id)]);
  return NextResponse.json({
    events: names.map((n) => n.event).filter((e) => !hidden.has(e)),
    eventProperties: keys.event,
    personProperties: keys.person,
    actions: actions.map((a) => ({ id: a.id, name: a.name })),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { eventNames, propertyKeys } from '@/lib/analytics/query';
import { actorProject, analyticsActor, isResponse } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Nombres de eventos y claves de propiedades vistas (para los selectores de las consultas). */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const project = await actorProject(actor, req.nextUrl.searchParams.get('project'));
  if (isResponse(project)) return project;
  const [names, keys] = await Promise.all([eventNames(project), propertyKeys(project)]);
  return NextResponse.json({ events: names.map((n) => n.event), eventProperties: keys.event, personProperties: keys.person });
}

import { NextRequest, NextResponse } from 'next/server';
import { deletePerson, getPerson, personEvents } from '@/lib/analytics/persons';
import { aError, analyticsActor, canManageAnalytics, isResponse, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** La persona con sus propiedades y sus últimos eventos (?before= para paginar). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_persons', id);
  if (isResponse(project)) return project;
  const before = Number(req.nextUrl.searchParams.get('before')) || null;
  const [person, events] = await Promise.all([getPerson(project.id, id), personEvents(project.id, id, { before })]);
  return NextResponse.json({ person, events });
}

/** Borra la persona con todos sus eventos (privacidad). Admins. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_persons', id);
  if (isResponse(project)) return project;
  return NextResponse.json(await deletePerson(project.id, id));
}

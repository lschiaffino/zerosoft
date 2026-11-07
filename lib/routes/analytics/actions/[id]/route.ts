import { NextRequest, NextResponse } from 'next/server';
import { actionInputSchema } from '@/lib/analytics/types';
import { deleteAction, getAction, updateAction } from '@/lib/analytics/records-more';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_actions', id);
  if (isResponse(project)) return project;
  return NextResponse.json({ action: await getAction(project.id, id) });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_actions', id);
  if (isResponse(project)) return project;
  const parsed = actionInputSchema.partial().safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  return NextResponse.json({ action: await updateAction(project.id, id, parsed.data) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_actions', id);
  if (isResponse(project)) return project;
  await deleteAction(project.id, id);
  return NextResponse.json({ ok: true });
}

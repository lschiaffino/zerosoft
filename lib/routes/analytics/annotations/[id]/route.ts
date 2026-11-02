import { NextRequest, NextResponse } from 'next/server';
import { annotationInputSchema } from '@/lib/analytics/types';
import { deleteAnnotation, updateAnnotation } from '@/lib/analytics/records-more';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_annotations', id);
  if (isResponse(project)) return project;
  const parsed = annotationInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  await updateAnnotation(project.id, id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_annotations', id);
  if (isResponse(project)) return project;
  await deleteAnnotation(project.id, id);
  return NextResponse.json({ ok: true });
}

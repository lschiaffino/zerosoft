import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { insightQuerySchema } from '@/lib/analytics/types';
import { deleteInsight, getInsight, updateInsight } from '@/lib/analytics/records';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';
import { toProjectDto } from '@/lib/analytics/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_insights', id);
  if (isResponse(project)) return project;
  return NextResponse.json({ insight: await getInsight(project.id, id), project: toProjectDto(project) });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  query: insightQuerySchema.optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_insights', id);
  if (isResponse(project)) return project;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  return NextResponse.json({ insight: await updateInsight(project.id, id, parsed.data) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_insights', id);
  if (isResponse(project)) return project;
  await deleteInsight(project.id, id);
  return NextResponse.json({ ok: true });
}

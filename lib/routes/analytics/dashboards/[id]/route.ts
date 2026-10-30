import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteDashboard, getDashboard, listInsights, updateDashboard } from '@/lib/analytics/records';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';
import { toProjectDto } from '@/lib/analytics/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** El tablero con sus insights (en orden). */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_dashboards', id);
  if (isResponse(project)) return project;
  const dashboard = await getDashboard(project.id, id);
  const all = await listInsights(project.id);
  const insights = (dashboard?.insightIds ?? []).map((i) => all.find((x) => x.id === i)).filter(Boolean);
  return NextResponse.json({ dashboard, insights, project: toProjectDto(project) });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  insightIds: z.array(z.string().max(64)).max(50).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_dashboards', id);
  if (isResponse(project)) return project;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  return NextResponse.json({ dashboard: await updateDashboard(project.id, id, parsed.data) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_dashboards', id);
  if (isResponse(project)) return project;
  await deleteDashboard(project.id, id);
  return NextResponse.json({ ok: true });
}

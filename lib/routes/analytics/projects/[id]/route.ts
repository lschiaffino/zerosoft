import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteProject, toProjectDto, updateProject } from '@/lib/analytics/projects';
import { actorProject, aError, analyticsActor, canManageAnalytics, isResponse, readJson } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  allowedDomains: z.array(z.string().max(255)).max(50).optional(),
  respectDnt: z.boolean().optional(),
  anonymizeIp: z.boolean().optional(),
  autocapture: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  tzOffsetMin: z.number().int().min(-720).max(840).optional(),
});

export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const p = await actorProject(actor, (await ctx.params).id);
  if (isResponse(p)) return p;
  return NextResponse.json({ project: toProjectDto(p) });
}

/** Renombra o cambia los ajustes (admins). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const p = await updateProject(actor.workspaceId, (await ctx.params).id, parsed.data);
  if (!p) return aError(404, 'project_not_found');
  return NextResponse.json({ project: toProjectDto(p) });
}

/** Borra el proyecto (los datos los purga el cron). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  if (!canManageAnalytics(actor)) return aError(403, 'forbidden');
  const ok = await deleteProject(actor.workspaceId, (await ctx.params).id);
  if (!ok) return aError(404, 'project_not_found');
  return NextResponse.json({ ok: true });
}

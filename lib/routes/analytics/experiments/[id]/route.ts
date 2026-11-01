import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { experimentMetricSchema } from '@/lib/analytics/types';
import { deleteExperiment, experimentResults, getExperiment, setExperimentFlag, setExperimentStatus, shipVariant, updateExperiment } from '@/lib/analytics/experiments';
import { getFlag } from '@/lib/analytics/records';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_experiments', id);
  if (isResponse(project)) return project;
  const experiment = await getExperiment(project.id, id);
  if (!experiment) return aError(404, 'not_found');
  return NextResponse.json({ experiment, results: await experimentResults(project.id, experiment) });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  hypothesis: z.string().max(2000).optional(),
  metrics: z.array(experimentMetricSchema).min(1).max(3).optional(),
  action: z.enum(['start', 'stop']).optional(),
  ship: z.string().max(64).optional(),
  flagId: z.string().max(64).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_experiments', id);
  if (isResponse(project)) return project;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const { action, ship, flagId, ...patch } = parsed.data;
  if (flagId) {
    const cur = await getExperiment(project.id, id);
    if (cur?.status !== 'draft') return aError(409, 'invalid_state');
    const flag = await getFlag(project.id, flagId);
    if (!flag) return aError(404, 'flag_not_found');
    if (flag.variants.length < 2) return aError(400, 'flag_not_multivariate');
    await setExperimentFlag(project.id, id, flagId);
  }
  if (action) {
    const res = await setExperimentStatus(project.id, id, action);
    if (res === 'invalid_state') return aError(409, res);
  }
  if (ship) {
    const res = await shipVariant(project.id, id, ship);
    if (res === 'invalid_variant') return aError(400, res);
  }
  return NextResponse.json({ experiment: await updateExperiment(project.id, id, patch) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_experiments', id);
  if (isResponse(project)) return project;
  await deleteExperiment(project.id, id);
  return NextResponse.json({ ok: true });
}

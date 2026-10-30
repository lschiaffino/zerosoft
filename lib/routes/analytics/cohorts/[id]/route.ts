import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cohortDefinitionSchema } from '@/lib/analytics/types';
import { deleteCohort, getCohort, updateCohort } from '@/lib/analytics/records';
import { countPersons } from '@/lib/analytics/persons';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** La cohorte con cuántas personas tiene hoy. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_cohorts', id);
  if (isResponse(project)) return project;
  const cohort = await getCohort(project.id, id);
  return NextResponse.json({ cohort, count: cohort ? await countPersons(project.id, cohort.definition) : 0 });
}

const patchSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), definition: cohortDefinitionSchema.optional() });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_cohorts', id);
  if (isResponse(project)) return project;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  return NextResponse.json({ cohort: await updateCohort(project.id, id, parsed.data) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_cohorts', id);
  if (isResponse(project)) return project;
  await deleteCohort(project.id, id);
  return NextResponse.json({ ok: true });
}

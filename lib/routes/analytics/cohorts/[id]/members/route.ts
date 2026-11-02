import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addCohortMembers, parseMemberList, STATIC_COHORT_MAX } from '@/lib/analytics/records-more';
import { getCohort } from '@/lib/analytics/records';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ text: z.string().max(2_000_000).optional(), ids: z.array(z.string().max(200)).max(STATIC_COHORT_MAX).optional() });

/** Suma personas a una cohorte estática (texto o CSV con ids, distinct_ids o emails). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_cohorts', id);
  if (isResponse(project)) return project;
  const cohort = await getCohort(project.id, id);
  if (!cohort || cohort.definition.type !== 'static') return aError(400, 'not_static');
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input');
  const values = [...(parsed.data.ids ?? []), ...(parsed.data.text ? parseMemberList(parsed.data.text) : [])];
  return NextResponse.json(await addCohortMembers(project.id, id, values));
}

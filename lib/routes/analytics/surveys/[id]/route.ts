import { NextRequest, NextResponse } from 'next/server';
import { surveyPatchSchema } from '@/lib/analytics/more-types';
import { deleteSurvey, getSurvey, updateSurvey } from '@/lib/analytics/surveys';
import { aError, analyticsActor, isResponse, readJson, recordProject } from '@/lib/analytics/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_surveys', id);
  if (isResponse(project)) return project;
  return NextResponse.json({ survey: await getSurvey(project.id, id) });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_surveys', id);
  if (isResponse(project)) return project;
  const parsed = surveyPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return aError(400, 'invalid_input', { issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
  const { startAt, endAt } = parsed.data;
  if (startAt != null && endAt != null && endAt <= startAt) return aError(400, 'invalid_dates');
  return NextResponse.json({ survey: await updateSurvey(project.id, id, parsed.data) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'write');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_surveys', id);
  if (isResponse(project)) return project;
  await deleteSurvey(project.id, id);
  return NextResponse.json({ ok: true });
}

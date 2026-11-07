import { NextRequest, NextResponse } from 'next/server';
import { dateRangeSchema } from '@/lib/analytics/types';
import { getSurvey, surveyResults } from '@/lib/analytics/surveys';
import { aError, analyticsActor, isResponse, recordProject } from '@/lib/analytics/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Resultados de una encuesta en un rango (?from=-30d), calculados de analytics_events. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const { id } = await ctx.params;
  const project = await recordProject(actor, 'analytics_surveys', id);
  if (isResponse(project)) return project;
  const range = dateRangeSchema.safeParse({ from: req.nextUrl.searchParams.get('from') ?? '-30d' });
  if (!range.success) return aError(400, 'invalid_range');
  const limit = await rateLimit(`aquery:${actor.workspaceId}`, 240, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  const survey = await getSurvey(project.id, id);
  if (!survey) return aError(404, 'not_found');
  return NextResponse.json({ results: await surveyResults(project, survey, { from: range.data.from }) });
}

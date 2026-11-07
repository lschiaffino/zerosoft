import { NextRequest, NextResponse } from 'next/server';
import { llmOverview, llmTraces } from '@/lib/analytics/llm';
import { dateRangeSchema } from '@/lib/analytics/types';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Totales, por modelo, por día y trazas de $ai_generation: ?project=&from=-30d. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const range = dateRangeSchema.safeParse({ from: sp.get('from') ?? '-30d' });
  if (!range.success) return aError(400, 'invalid_range');
  const limit = await rateLimit(`aquery:${actor.workspaceId}`, 240, 60);
  if (!limit.ok && process.env.RATE_LIMIT_DISABLED !== 'true') return aError(429, 'rate_limited');
  const [overview, traces] = await Promise.all([llmOverview(project, { from: range.data.from }), llmTraces(project, { from: range.data.from })]);
  return NextResponse.json({ overview, traces });
}

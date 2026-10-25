import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { getAccessiblePlan, listPlanIssues, searchIssuesForPlan, setIssuePlanMilestone, setPlanIssues } from '@/lib/track-plans';
import { planIssueMilestoneSchema, planIssuesSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Issues del plan; con ?q= busca issues del workspace para sumar. */
export async function GET(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const plan = await getAccessiblePlan(id, ctx.scope);
  if (!plan) return notFound();
  const q = req.nextUrl.searchParams.get('q');
  if (q !== null) return NextResponse.json({ rows: q.trim() ? await searchIssuesForPlan(ctx.scope, id, q) : [] });
  return NextResponse.json({ rows: await listPlanIssues(id) });
}

/** Sumar o sacar issues: { action: 'add' | 'remove', issueIds, milestoneId? }. */
export async function POST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const plan = await getAccessiblePlan(id, ctx.scope);
  if (!plan) return notFound();
  const parsed = planIssuesSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const changed = await setPlanIssues(plan, ctx.scope, parsed.data.action, parsed.data.issueIds, parsed.data.milestoneId);
  return NextResponse.json({ changed, rows: await listPlanIssues(id) });
}

/** Milestone del plan para un issue: { issueId, milestoneId | null }. */
export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const plan = await getAccessiblePlan(id, ctx.scope);
  if (!plan) return notFound();
  const parsed = planIssueMilestoneSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const ok = await setIssuePlanMilestone(id, parsed.data.issueId, parsed.data.milestoneId);
  if (!ok) return trackError(400, 'invalid_milestone');
  return NextResponse.json({ ok: true });
}

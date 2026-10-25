import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { deletePlan, getAccessiblePlan, getPlanSummary, isFollowingPlan, listPlanMilestones, updatePlan } from '@/lib/track-plans';
import { planUpdateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const plan = await getPlanSummary(id, ctx.scope);
  if (!plan) return notFound();
  const [milestones, following] = await Promise.all([listPlanMilestones(id), isFollowingPlan(id, ctx.actorId)]);
  return NextResponse.json({ plan, milestones, following });
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const plan = await getAccessiblePlan(id, ctx.scope);
  if (!plan) return notFound();
  const parsed = planUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await updatePlan(plan, ctx.scope, ctx.actorId, parsed.data);
  if (!res.ok) return trackError(400, res.error);
  return NextResponse.json(await getPlanSummary(id, ctx.scope));
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const plan = await getAccessiblePlan(id, ctx.scope);
  if (!plan) return notFound();
  await deletePlan(id);
  return NextResponse.json({ ok: true });
}

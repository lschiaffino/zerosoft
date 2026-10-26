import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { deletePlanMilestone, getAccessiblePlan, getPlanMilestone, listPlanMilestones, updatePlanMilestone } from '@/lib/track-plans';
import { planMilestoneUpdateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  const ctx = await planningContext();
  if (!ctx) return { error: unauthorized() } as const;
  const ms = await getPlanMilestone(id);
  if (!ms || !(await getAccessiblePlan(ms.plan_id, ctx.scope))) return { error: notFound() } as const;
  return { ctx, ms } as const;
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  const parsed = planMilestoneUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  await updatePlanMilestone(id, parsed.data);
  return NextResponse.json({ rows: await listPlanMilestones(r.ms.plan_id) });
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await load(id);
  if ('error' in r) return r.error;
  await deletePlanMilestone(id);
  return NextResponse.json({ rows: await listPlanMilestones(r.ms.plan_id) });
}

import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { createPlanMilestone, getAccessiblePlan, listPlanMilestones } from '@/lib/track-plans';
import { planMilestoneCreateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  if (!(await getAccessiblePlan(id, ctx.scope))) return notFound();
  return NextResponse.json({ rows: await listPlanMilestones(id) });
}

export async function POST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  if (!(await getAccessiblePlan(id, ctx.scope))) return notFound();
  const parsed = planMilestoneCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const milestoneId = await createPlanMilestone(id, ctx.actorId, parsed.data);
  return NextResponse.json({ id: milestoneId, rows: await listPlanMilestones(id) }, { status: 201 });
}

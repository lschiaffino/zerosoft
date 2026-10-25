import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { getAccessiblePlan, listPlanEvents } from '@/lib/track-plans';
import { createPlanUpdate, listPlanUpdates } from '@/lib/track-plan-updates';
import { planUpdateCreateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Updates del plan (el más nuevo primero) y el historial de cambios del plan. */
export async function GET(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  if (!(await getAccessiblePlan(id, ctx.scope))) return notFound();
  const [rows, events] = await Promise.all([listPlanUpdates(id), listPlanEvents(id)]);
  return NextResponse.json({ rows, events, me: ctx.actorId });
}

export async function POST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const plan = await getAccessiblePlan(id, ctx.scope);
  if (!plan) return notFound();
  const parsed = planUpdateCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await createPlanUpdate(plan, ctx.actorId, parsed.data), { status: 201 });
}

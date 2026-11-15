import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { getAccessiblePlan } from '@/lib/track-plans';
import { createPlanTemplateFromPlan, listPlanTemplates } from '@/lib/track-plan-templates';
import { planTemplateCreateSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Templates de projects del workspace (con cuántos milestones e issues trae cada uno). */
export async function GET() {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  return NextResponse.json({ rows: await listPlanTemplates(ctx.scope) });
}

/** Guarda un project como template. */
export async function POST(req: NextRequest) {
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  const parsed = planTemplateCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  const plan = await getAccessiblePlan(parsed.data.planId, ctx.scope);
  if (!plan) return notFound();
  const row = await createPlanTemplateFromPlan(plan, ctx.scope, ctx.actorId, parsed.data);
  return NextResponse.json((await listPlanTemplates(ctx.scope)).find((t) => t.id === row.id), { status: 201 });
}

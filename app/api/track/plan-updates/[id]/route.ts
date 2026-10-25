import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { inScope } from '@/lib/track-plans';
import { deletePlanUpdate, editPlanUpdate, getPlanUpdate } from '@/lib/track-plan-updates';
import { planUpdateEditSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, trackError, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Solo el autor edita o borra su update (como en Linear). */
async function own(id: string) {
  const ctx = await planningContext();
  if (!ctx) return { error: unauthorized() } as const;
  const update = await getPlanUpdate(id);
  if (!update || !inScope(update.plan, ctx.scope)) return { error: notFound() } as const;
  if (update.user_id !== ctx.actorId) return { error: trackError(403, 'forbidden') } as const;
  return { ctx, update } as const;
}

export async function PATCH(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await own(id);
  if ('error' in r) return r.error;
  const parsed = planUpdateEditSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  await editPlanUpdate(id, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, props: Props) {
  const { id } = await props.params;
  const r = await own(id);
  if ('error' in r) return r.error;
  await deletePlanUpdate(id);
  return NextResponse.json({ ok: true });
}

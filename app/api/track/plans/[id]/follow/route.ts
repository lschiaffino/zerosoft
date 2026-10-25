import { NextRequest, NextResponse } from 'next/server';
import { planningContext, readJson } from '@/lib/track-planning-http';
import { getAccessiblePlan, isFollowingPlan, setPlanFollow } from '@/lib/track-plans';
import { planFollowSchema } from '@/lib/track-planning-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/track-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/** Seguir o dejar de seguir un plan (recibir sus updates en el Inbox). */
export async function PUT(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const ctx = await planningContext();
  if (!ctx) return unauthorized();
  if (!(await getAccessiblePlan(id, ctx.scope))) return notFound();
  const parsed = planFollowSchema.safeParse(await readJson(req));
  if (!parsed.success) return invalidBody(parsed.error);
  await setPlanFollow(id, ctx.actorId, parsed.data.following);
  return NextResponse.json({ following: await isFollowingPlan(id, ctx.actorId) });
}

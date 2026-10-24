import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteScore, getScore, recalcWorkspaceScores, updateScore } from '@/lib/crm-scoring';
import { scoreDefSchema } from '@/lib/crm-scoring-schema';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Renombrar, umbrales y decaimiento. Si cambia el decaimiento, recalcula. */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = scoreDefSchema.partial().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const before = await getScore(user.id, id);
  if (!before) return notFound();
  const res = await updateScore(user.id, id, parsed.data);
  if (!res.ok) return notFound();
  if (before.decayDays !== res.score.decayDays || before.decayPct !== res.score.decayPct) {
    await recalcWorkspaceScores(user.id, { limit: 2000 });
  }
  return NextResponse.json(res.score);
}

/** Borra un score adicional (el principal no se borra). */
export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const score = await getScore(user.id, id);
  if (!score) return notFound();
  if (score.isPrimary) return crmError(400, 'primary_score');
  await deleteScore(user.id, id);
  return new NextResponse(null, { status: 204 });
}

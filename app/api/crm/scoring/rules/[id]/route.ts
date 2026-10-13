import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteScoreRule, recalcWorkspaceScores, updateScoreRule } from '@/lib/crm-scoring';
import { scoreRuleCreateSchema } from '@/lib/crm-scoring-schema';
import { crmError, forbidden, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = scoreRuleCreateSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');
  const rule = await updateScoreRule(user.id, id, parsed.data);
  if (!rule) return notFound();
  await recalcWorkspaceScores(user.id, { limit: 2000 });
  return NextResponse.json(rule);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  if (!(await deleteScoreRule(user.id, id))) return notFound();
  await recalcWorkspaceScores(user.id, { limit: 2000 });
  return new NextResponse(null, { status: 204 });
}

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { createScoreRule, listScoreRules, recalcWorkspaceScores } from '@/lib/crm-scoring';
import { scoreRuleCreateSchema } from '@/lib/crm-scoring-schema';
import { crmError, forbidden, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rules: await listScoreRules(user.id) });
}

/** Nueva regla (solo admins). Recalcula el workspace para que se vea el efecto. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = scoreRuleCreateSchema.safeParse(body);
  if (!parsed.success) return crmError(400, 'invalid_input');
  const rule = await createScoreRule(user.id, parsed.data);
  if (!rule) return crmError(400, 'invalid_score');
  await recalcWorkspaceScores(user.id, { limit: 2000 });
  return NextResponse.json(rule, { status: 201 });
}

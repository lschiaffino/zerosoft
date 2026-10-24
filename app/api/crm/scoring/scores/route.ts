import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { createScore, listScores } from '@/lib/crm-scoring';
import { scoreDefSchema } from '@/lib/crm-scoring-schema';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lead scores del workspace (el principal primero). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ scores: await listScores(user.id) });
}

/** Nuevo score (solo admins; hasta MAX_SCORES). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = scoreDefSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await createScore(user.id, parsed.data);
  if (!res.ok) return crmError(400, 'score_limit');
  return NextResponse.json(res.score, { status: 201 });
}

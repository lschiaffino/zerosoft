import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { recalcWorkspaceScores } from '@/lib/crm-scoring';
import { forbidden, limitAction, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recalcula el score de todos los contactos del workspace (solo admins, acotado). */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const limited = await limitAction(realUserId(user), 'score-recalc', 5, 3600);
  if (limited) return limited;
  return NextResponse.json(await recalcWorkspaceScores(user.id, { limit: 20000 }));
}

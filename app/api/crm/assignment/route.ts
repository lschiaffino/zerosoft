import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getAssignmentRule, listAssignmentHistory, saveAssignmentRule, unavailablePeople } from '@/lib/crm-assignment';
import { assignmentRuleSchema } from '@/lib/crm-schema';
import { forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const [rule, away, history] = await Promise.all([
    getAssignmentRule(user.id),
    unavailablePeople(user.id),
    listAssignmentHistory(user.id, 50),
  ]);
  return NextResponse.json({ rule, unavailable: [...away], history });
}

/** Regla round-robin de leads nuevos (solo admins). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const body: unknown = await req.json().catch(() => null);
  const parsed = assignmentRuleSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json({ rule: await saveAssignmentRule(user.id, parsed.data) });
}

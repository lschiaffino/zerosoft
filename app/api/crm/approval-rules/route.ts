import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { approvalRuleSchema, createApprovalRule, listApprovalRules } from '@/lib/crm-approvals';
import { crmError, forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ rules: await listApprovalRules(user.id) });
}

/** Nueva regla de aprobación (solo admins). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = approvalRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await createApprovalRule(user.id, parsed.data);
  if (!res.ok) return crmError(400, res.reason);
  return NextResponse.json(res.rule, { status: 201 });
}

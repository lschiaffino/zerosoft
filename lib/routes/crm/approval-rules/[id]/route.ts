import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { approvalRuleSchema, deleteApprovalRule, updateApprovalRule } from '@/lib/crm-approvals';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = approvalRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const res = await updateApprovalRule(user.id, id, parsed.data);
  if (!res.ok) return res.reason === 'not_found' ? notFound() : crmError(400, res.reason);
  return NextResponse.json(res.rule);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  return (await deleteApprovalRule(user.id, id)) ? new NextResponse(null, { status: 204 }) : notFound();
}

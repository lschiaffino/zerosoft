import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { deleteLeadStage, updateLeadStage } from '@/lib/crm-leads';
import { leadStageUpdateSchema } from '@/lib/crm-schema';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = leadStageUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const stage = await updateLeadStage(user.id, id, parsed.data);
  return stage ? NextResponse.json(stage) : notFound();
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const res = await deleteLeadStage(user.id, id);
  if (res.ok) return new NextResponse(null, { status: 204 });
  if (res.reason === 'not_found') return notFound();
  return crmError(409, res.reason === 'not_empty' ? 'stage_not_empty' : 'last_stage');
}

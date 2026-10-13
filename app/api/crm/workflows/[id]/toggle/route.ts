import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { toggleWorkflow } from '@/lib/crm-workflows';
import { workflowToggleSchema } from '@/lib/crm-workflows-schema';
import { invalidBody, notFound, unauthorized, forbidden } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();

  const body: unknown = await req.json().catch(() => null);
  const parsed = workflowToggleSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const workflow = await toggleWorkflow(user.id, params.id, parsed.data.enabled);
  if (!workflow) return notFound();
  return NextResponse.json(workflow);
}

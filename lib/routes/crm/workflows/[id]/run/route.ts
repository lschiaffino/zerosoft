import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { getWorkflow, runWorkflowManually } from '@/lib/crm-workflows';
import { notFound, unauthorized, forbidden, limitAction } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const limited = await limitAction(realUserId(user), 'workflow_run', 30, 3600);
  if (limited) return limited;

  const workflow = await getWorkflow(user.id, params.id);
  if (!workflow) return notFound();

  await runWorkflowManually(user.id, workflow);

  return NextResponse.json({ ok: true });
}

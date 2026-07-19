import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getWorkflow, runWorkflowsForEvent } from '@/lib/crm-workflows';
import { notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const workflow = await getWorkflow(user.id, params.id);
  if (!workflow) return notFound();

  await runWorkflowsForEvent(user.id, {
    type: 'manual',
    entity: 'deal',
    entityId: workflow.id,
  });

  return NextResponse.json({ ok: true });
}
